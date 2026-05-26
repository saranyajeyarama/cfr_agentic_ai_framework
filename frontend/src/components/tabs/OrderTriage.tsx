/**
 * Order Triage — v2.3 (Phase 2.1).
 *
 * Hero screen. Wired to the live v2.3 backend:
 *   • Queue            → GET  /v23/orders             (fetchOrders)
 *   • Agent evaluation → POST /v23/triage/{id}        (triageOrder, 30-180s blocking)
 *   • Approve / Reject → POST /sessions/{sid}/approve | /reject  (approveSession / rejectSession)
 *
 * UX states (in order):
 *   1. idle        — empty right panel, "select an order to begin"
 *   2. selected    — order header visible, "Evaluate Agents" CTA
 *   3. evaluating  — 4 agent cards with streaming dots + wall-clock + cancel
 *   4. result      — agent signals + conflict + recommendation card + approve/reject
 *   5. decided     — read-only result + approved/rejected banner
 *   6. error       — validation / backend / network / timeout error with retry CTA
 *
 * Errors per the spec:
 *   • 422   → show response.detail with a "try another order" CTA
 *   • 5xx   → "agent flow failed" + session_id if available
 *   • >180s → "agents still running" + session_id if available
 *
 * On approve / reject the queue is refetched so the just-decided order
 * is removed (the backend filters out approved orders from /v23/orders).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Loader2, RefreshCw, X, Zap } from 'lucide-react';
import {
  C, MONO, AGENT_KEYS, AGENT_LABELS,
  dispColor, actColor, sevColor, flagColor,
} from '../../lib/constants';
import { Pill, Blinker } from '../primitives';
import {
  fetchOrders, triageOrder, approveSession, rejectSession,
  invalidateDashboard,
  AbortError, ValidationError, BackendError, NetworkError,
} from '../../lib/api';
import type { Order, TriageResponse, AgentKey } from '../../lib/types';

// =============================================================================
// Types
// =============================================================================

type TriageError =
  | { kind: 'validation'; message: string; detail: unknown }
  | { kind: 'backend';    message: string; status: number; sessionId?: string }
  | { kind: 'network';    message: string }
  | { kind: 'timeout';    message: string; sessionId?: string };

type Phase = 'idle' | 'evaluating' | 'result' | 'decided' | 'error';

type DecisionKind = 'approved' | 'rejected';

// Hardcoded planner identity — replace with auth context when available.
const USER_ID = 'planner.ops@mars.com';

// Triage timeout per the spec.
const TIMEOUT_MS = 180_000;

// =============================================================================
// Helpers
// =============================================================================

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function classifyError(e: unknown, sessionId?: string): TriageError {
  if (e instanceof ValidationError) {
    return { kind: 'validation', message: e.message, detail: e.detail };
  }
  if (e instanceof BackendError) {
    return { kind: 'backend', message: e.message, status: e.status, sessionId };
  }
  if (e instanceof NetworkError) {
    return { kind: 'network', message: e.message };
  }
  return { kind: 'backend', message: String((e as Error)?.message ?? e), status: 0 };
}

// =============================================================================
// Sub-components — kept inline to keep the file self-contained
// =============================================================================

/** Render fn (NOT a component) to sidestep the React 19 / TS 5.8
 *  key-in-props strict check when used inside `.map()`. */
function renderOrderRow(
  order: Order,
  selected: boolean,
  decided: DecisionKind | null,
  onClick: () => void,
) {
  const fc = flagColor(order.flag_type);
  return (
    <div key={order.id} onClick={onClick} style={{
      padding: '12px 14px', borderRadius: 8, marginBottom: 8, cursor: 'pointer',
      border: selected ? `2px solid ${C.red}` : `1px solid ${C.border}`,
      background: selected ? 'rgba(219,3,59,0.04)' : '#fff',
      borderLeft: selected ? `4px solid ${C.red}` : `4px solid ${fc}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.charcoal }}>{order.customer}</span>
        <Pill label={`P${order.priority}`}
              color={order.priority === 1 ? C.red : order.priority === 2 ? C.orange : C.muted}
              size={9} />
      </div>
      <div style={{ fontSize: 11, color: C.charcoal, marginBottom: 3, lineHeight: 1.35 }}>
        {order.desc || order.sku}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 7 }}>
        {order.qty.toLocaleString()} cs · {order.id} · {order.mabd ?? '—'}
      </div>
      <div style={{
        fontSize: 10, background: `${fc}16`, color: fc, borderRadius: 4,
        padding: '2px 7px', display: 'inline-block', fontWeight: 600,
      }}>{order.flag}</div>
      {decided && (
        <div style={{
          marginTop: 6, fontSize: 11,
          color: decided === 'approved' ? C.green : C.red, fontWeight: 700,
        }}>{decided === 'approved' ? 'Approved' : 'Rejected'}</div>
      )}
    </div>
  );
}

type SignalLike = { disposition: string; confidence: number; hard_block: boolean; summary: string } | null | undefined;

/** Render fn (NOT a component) — see renderOrderRow note. */
function renderAgentCard(
  agentKey: AgentKey,
  signal: SignalLike,
  evaluating: boolean,
) {
  const meta = AGENT_LABELS[agentKey];
  return (
    <div key={agentKey} style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 14,
      borderTop: `3px solid ${meta.color}`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.label}</div>
        {signal
          ? <Pill label={signal.disposition} color={dispColor(signal.disposition)} size={10} />
          : evaluating
            ? <span style={{ fontSize: 10, color: C.muted }}>Evaluating<Blinker /></span>
            : <span style={{ fontSize: 10, color: C.muted }}>Waiting</span>}
      </div>

      {/* Placeholder terminal while evaluating */}
      {evaluating && !signal && (
        <div style={{
          height: 64, background: '#1a1a1a', borderRadius: 4,
          padding: '5px 8px', fontFamily: MONO, fontSize: 10, color: '#666',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 4,
        }}>
          <span style={{ color: meta.color }}>▸ Running tools…</span>
          <span style={{ color: '#444', fontSize: 9 }}>(streaming not exposed in /v23/triage yet)</span>
        </div>
      )}

      {/* Filled signal */}
      {signal && (
        <>
          <div style={{
            fontSize: 11, color: C.charcoal, lineHeight: 1.45, fontStyle: 'italic',
          }}>{signal.summary}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>Confidence</span>
            <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
              <div style={{
                width: `${signal.confidence * 100}%`, height: '100%',
                background: meta.color, borderRadius: 2,
              }} />
            </div>
            <span style={{ color: meta.color, fontWeight: 700, fontSize: 11 }}>
              {Math.round(signal.confidence * 100)}%
            </span>
          </div>
          {signal.hard_block && (
            <div style={{
              display: 'inline-block', background: C.red, color: '#fff',
              borderRadius: 4, padding: '3px 10px', fontSize: 11, fontWeight: 700,
            }}>HARD BLOCK RAISED</div>
          )}
        </>
      )}
    </div>
  );
}

function ConflictBanner({ conflict }: { conflict: TriageResponse['synthesis']['conflicts'][number] }) {
  return (
    <div style={{
      background: '#fff', border: `2px solid ${C.orange}`,
      borderRadius: 8, padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Pill label="CONFLICT DETECTED" color={C.orange} />
        <span style={{ fontSize: 13, fontWeight: 600, color: C.charcoal }}>
          {conflict.type.replace(/_/g, ' ')}
        </span>
      </div>
      <div style={{ fontSize: 12, color: C.charcoal, marginBottom: 5 }}>
        <strong>Disputants: </strong>
        {conflict.disputants
          .map(d => AGENT_LABELS[d as AgentKey]?.label ?? d)
          .join(' vs. ')}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{conflict.summary}</div>
      <div style={{ fontSize: 11, color: C.muted }}>
        {conflict.debate_rounds > 0 ? `Resolved after ${conflict.debate_rounds} debate round(s) — ${conflict.resolution}` : conflict.resolution}
      </div>
    </div>
  );
}

function RecommendationCard({
  syn, decided, onApprove, onReject,
}: {
  syn: TriageResponse['synthesis'];
  decided: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const r = syn.rec;
  const escKeys = Object.keys(syn.escalations || {});
  return (
    <div style={{
      border: `2px solid ${actColor(r.action)}`, borderRadius: 10,
      overflow: 'hidden', background: '#fff',
    }}>
      <div style={{
        background: actColor(r.action), padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ color: '#fff' }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.8,
          }}>CUSTOMER SUPPLY · RECOMMENDATION</div>
          <div style={{
            fontSize: 22, fontWeight: 900, letterSpacing: '0.04em', marginTop: 3,
          }}>{r.action.replace(/_/g, ' ')}</div>
        </div>
        <div style={{ textAlign: 'right', color: '#fff' }}>
          <div style={{ fontSize: 11, opacity: 0.8 }}>Confidence</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{Math.round(r.confidence * 100)}%</div>
        </div>
      </div>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {r.qty > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {([
              ['Fulfill Qty',  `${r.qty.toLocaleString()} cs`],
              ['Fill Rate',    `${r.fill_pct}%`],
              ['Action',       r.action.replace(/_/g, ' ')],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} style={{
                background: C.off, borderRadius: 6, padding: '10px 12px', textAlign: 'center',
              }}>
                <div style={{
                  fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>{l}</div>
                <div style={{
                  fontSize: 15, fontWeight: 700, color: C.charcoal, marginTop: 4,
                }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: C.off, borderRadius: 6, padding: '10px 14px' }}>
          <div style={{
            fontSize: 10, color: C.muted, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
          }}>Expected Outcome</div>
          <div style={{
            fontSize: 12, color: C.charcoal, lineHeight: 1.55,
          }}>{r.outcome || '—'}</div>
        </div>

        {syn.chain.tradeoffs.length > 0 && (
          <div>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>Key Trade-offs</div>
            {syn.chain.tradeoffs.map((t, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8, marginBottom: 5, fontSize: 12, color: C.charcoal,
              }}>
                <span style={{ color: C.red, fontWeight: 700, flexShrink: 0 }}>++</span>{t}
              </div>
            ))}
            {syn.chain.flip && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
                <strong style={{ color: C.charcoal, fontStyle: 'normal' }}>Would flip if: </strong>
                {syn.chain.flip}
              </div>
            )}
          </div>
        )}

        {r.alternatives.length > 0 && (
          <div>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>Alternatives Considered</div>
            {r.alternatives.map((a, i) => (
              <div key={i} style={{
                background: C.off, borderRadius: 6, padding: '8px 12px',
                marginBottom: 5, fontSize: 12,
              }}>
                <strong>{a.label}</strong> — {a.outcome}
                {a.qty > 0 && <span style={{ color: C.muted }}> · {a.qty.toLocaleString()} cs</span>}
              </div>
            ))}
          </div>
        )}

        {escKeys.length > 0 && (
          <div>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>Escalations</div>
            {escKeys.map(k => {
              const e = syn.escalations[k];
              return (
                <div key={k} style={{
                  border: `1px solid ${sevColor(e.severity)}`, borderRadius: 6,
                  padding: '8px 12px', background: C.off, marginBottom: 6,
                }}>
                  <div style={{
                    display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4,
                  }}>
                    <Pill label={e.severity} color={sevColor(e.severity)} size={10} />
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: C.charcoal,
                    }}>{k.replace(/_/g, ' ')}</span>
                  </div>
                  <div style={{
                    fontSize: 11, color: C.charcoal, marginBottom: 3,
                  }}>{e.summary}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>Action: {e.action}</div>
                </div>
              );
            })}
          </div>
        )}

        {!decided && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button onClick={onApprove} style={{
              flex: 1, padding: '11px 0', background: C.green, color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Approve</button>
            <button onClick={onReject} style={{
              flex: 1, padding: '11px 0', background: 'transparent', color: C.red,
              border: `2px solid ${C.red}`, borderRadius: 6, fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Reject</button>
          </div>
        )}
      </div>
    </div>
  );
}

function RejectModal({
  onCancel, onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: 22, width: 480, maxWidth: '92%',
        boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.charcoal }}>Reject AI recommendation</div>
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 2,
          }}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Explain why you are overriding the AI recommendation. This is logged in the
          decision telemetry for audit and feeds back into future agent training.
        </div>
        <textarea value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. customer has critical promo dependency we cannot defer…"
          style={{
            width: '100%', minHeight: 96, padding: 10, border: `1px solid ${C.border}`,
            borderRadius: 6, fontFamily: 'inherit', fontSize: 12, resize: 'vertical',
            boxSizing: 'border-box',
          }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={() => onSubmit(trimmed)} disabled={trimmed.length === 0} style={{
            flex: 1, padding: 10, background: C.red, color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
            cursor: trimmed.length === 0 ? 'not-allowed' : 'pointer',
            opacity: trimmed.length === 0 ? 0.4 : 1, fontFamily: 'inherit',
          }}>Confirm reject</button>
          <button onClick={onCancel} style={{
            padding: '10px 16px', background: '#fff', border: `1px solid ${C.border}`,
            borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ErrorPanel({
  err, onTryAnother, onRetry,
}: {
  err: TriageError;
  onTryAnother: () => void;
  onRetry: () => void;
}) {
  const isTimeout = err.kind === 'timeout';
  const isValidation = err.kind === 'validation';
  const heading = {
    validation: 'Backend rejected the order',
    backend:    'Agent flow failed',
    network:    'Could not reach the backend',
    timeout:    'Agents still running',
  }[err.kind];

  const detailText = isValidation
    ? typeof err.detail === 'string'
      ? err.detail
      : JSON.stringify(err.detail, null, 2)
    : err.message;

  const sessionId = 'sessionId' in err ? err.sessionId : undefined;

  return (
    <div style={{
      background: '#fff', border: `2px solid ${isTimeout ? C.orange : C.red}`,
      borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <AlertTriangle size={26} color={isTimeout ? C.orange : C.red} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.charcoal }}>{heading}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {err.kind === 'backend' && `HTTP ${err.status}`}
            {err.kind === 'timeout' && `Exceeded ${TIMEOUT_MS / 1000}s`}
            {err.kind === 'network' && 'Network error'}
            {err.kind === 'validation' && 'HTTP 422 — invalid payload'}
          </div>
        </div>
      </div>

      <pre style={{
        margin: 0, padding: '10px 14px', background: C.off, border: `1px solid ${C.border}`,
        borderRadius: 6, fontSize: 11, fontFamily: MONO, color: C.charcoal,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto',
      }}>{detailText}</pre>

      {sessionId && (
        <div style={{ fontSize: 11, color: C.muted }}>
          For debugging — <strong style={{ color: C.charcoal, fontFamily: MONO }}>session_id = {sessionId}</strong>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        {(err.kind === 'backend' || err.kind === 'network' || err.kind === 'timeout') && (
          <button onClick={onRetry} style={{
            padding: '9px 16px', background: C.red, color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit',
          }}>
            <RefreshCw size={13} /> Try again
          </button>
        )}
        <button onClick={onTryAnother} style={{
          padding: '9px 16px', background: '#fff', color: C.charcoal,
          border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Try another order</button>
      </div>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

export function OrderTriage({
  onDecisionSaved,
}: {
  /** Optional callback fired after a successful approve or reject.
   *  The Fulfillment Simulator listens on this to invalidate its
   *  incidents cache so the newly-approved order shows up. */
  onDecisionSaved?: () => void;
} = {}) {
  // Orders queue
  const [orders, setOrders]           = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState<boolean>(true);
  const [ordersErr, setOrdersErr]     = useState<string | null>(null);

  // Selection + triage
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [phase, setPhase]             = useState<Phase>('idle');
  const [result, setResult]           = useState<TriageResponse | null>(null);
  const [error, setError]             = useState<TriageError | null>(null);
  const [elapsedMs, setElapsedMs]     = useState<number>(0);

  // Local per-order decisions (so the row shows "Approved" / "Rejected" while
  // we wait for the queue to refetch).
  const [decisionByOrder, setDecisionByOrder] = useState<Record<string, DecisionKind>>({});
  const [rejectModalOpen, setRejectModalOpen] = useState<boolean>(false);

  const abortRef    = useRef<AbortController | null>(null);
  const timerRef    = useRef<number | null>(null);
  const startTsRef  = useRef<number>(0);

  // Load orders
  const loadOrders = useCallback(() => {
    setOrdersLoading(true);
    setOrdersErr(null);
    fetchOrders(20)
      .then(o => { setOrders(o); setOrdersLoading(false); })
      .catch(e => {
        setOrdersErr(e?.message || 'Could not load orders');
        setOrdersLoading(false);
      });
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Clean up timer on unmount
  useEffect(() => () => {
    if (timerRef.current != null) clearInterval(timerRef.current);
    abortRef.current?.abort();
  }, []);

  const selectedOrder = orders.find(o => o.id === selectedId) ?? null;

  function selectOrder(o: Order) {
    // Hard reset triage state when picking a new order.
    abortRef.current?.abort();
    if (timerRef.current != null) clearInterval(timerRef.current);
    setSelectedId(o.id);
    setPhase('idle');
    setResult(null);
    setError(null);
    setElapsedMs(0);
    setRejectModalOpen(false);
  }

  async function runTriage(order: Order) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    startTsRef.current = Date.now();
    setElapsedMs(0);
    setError(null);
    setResult(null);
    setPhase('evaluating');

    // Wall-clock tick
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startTsRef.current);
    }, 500);

    // Timeout — 180s
    const timeoutHandle = window.setTimeout(() => {
      ctrl.abort();
      if (timerRef.current != null) clearInterval(timerRef.current);
      setError({ kind: 'timeout', message: `No response in ${TIMEOUT_MS / 1000}s` });
      setPhase('error');
    }, TIMEOUT_MS);

    try {
      const r = await triageOrder(order.id, order._backend, ctrl.signal);
      window.clearTimeout(timeoutHandle);
      if (timerRef.current != null) clearInterval(timerRef.current);
      setResult(r);
      setPhase('result');
    } catch (e) {
      window.clearTimeout(timeoutHandle);
      if (timerRef.current != null) clearInterval(timerRef.current);
      if (e instanceof AbortError) {
        // Caused by either the user's Cancel button OR the timeout above.
        // Timeout path already set the error/phase — only handle the
        // user-cancel case here.
        if (phase !== 'error') {
          setPhase('idle');
        }
        return;
      }
      setError(classifyError(e));
      setPhase('error');
    }
  }

  function cancelTriage() {
    abortRef.current?.abort();
  }

  async function handleApprove() {
    if (!result || !selectedOrder) return;
    setDecisionByOrder(prev => ({ ...prev, [selectedOrder.id]: 'approved' }));
    setPhase('decided');
    try {
      await approveSession(result.session_id, USER_ID);
    } catch (e) {
      console.error('approveSession failed', e);
      // We still leave the decision flagged locally so the user sees the
      // intent — the next fetchOrders() refresh will reconcile.
    } finally {
      invalidateDashboard();
      onDecisionSaved?.();
      loadOrders();
    }
  }

  async function handleRejectSubmit(reason: string) {
    if (!result || !selectedOrder) return;
    setRejectModalOpen(false);
    setDecisionByOrder(prev => ({ ...prev, [selectedOrder.id]: 'rejected' }));
    setPhase('decided');
    try {
      await rejectSession(result.session_id, USER_ID, reason);
    } catch (e) {
      console.error('rejectSession failed', e);
    } finally {
      invalidateDashboard();
      onDecisionSaved?.();
      loadOrders();
    }
  }

  function backToQueue() {
    abortRef.current?.abort();
    if (timerRef.current != null) clearInterval(timerRef.current);
    setSelectedId(null);
    setPhase('idle');
    setResult(null);
    setError(null);
    setElapsedMs(0);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* ─── Left rail: orders queue ───────────────────────────────────── */}
      <div style={{
        width: 296, background: '#fff', borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.charcoal }}>Order Triage</div>
            <button onClick={loadOrders} disabled={ordersLoading} title="Refresh queue" style={{
              background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 2,
              display: 'flex', alignItems: 'center', opacity: ordersLoading ? 0.4 : 1,
            }}>
              <RefreshCw size={13} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
            {ordersLoading
              ? 'Loading queue…'
              : ordersErr
                ? 'Queue unavailable'
                : `${orders.length} order${orders.length === 1 ? '' : 's'} flagged for evaluation`}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {ordersLoading && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 40, color: C.muted, fontSize: 12, gap: 8,
            }}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {ordersErr && !ordersLoading && (
            <div style={{
              padding: '16px 12px', background: '#fde8ec', border: `1px solid ${C.red}40`,
              borderRadius: 6, fontSize: 12, color: C.red,
            }}>
              {ordersErr}
              <button onClick={loadOrders} style={{
                display: 'block', marginTop: 8, padding: '4px 10px', fontSize: 11,
                background: C.red, color: '#fff', border: 'none', borderRadius: 4,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Retry</button>
            </div>
          )}
          {!ordersLoading && !ordersErr && orders.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 12 }}>
              No orders currently flagged for AI evaluation.
            </div>
          )}
          {orders.map(o =>
            renderOrderRow(o, o.id === selectedId, decisionByOrder[o.id] ?? null, () => selectOrder(o)),
          )}
        </div>
      </div>

      {/* ─── Right panel: evaluation ───────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 20, background: C.off, position: 'relative',
      }}>
        {!selectedOrder && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '70%', color: C.muted,
            textAlign: 'center', gap: 14,
          }}>
            <Zap size={48} style={{ opacity: 0.18, color: C.charcoal }} />
            <div style={{ fontSize: 18, fontWeight: 600, color: C.charcoal }}>
              Select an order to begin AI evaluation
            </div>
            <div style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.65, color: C.muted }}>
              The 5-agent system will evaluate supply, demand, transportation and
              retail intelligence in parallel, then synthesize a single
              recommendation for your approval or rejection.
            </div>
          </div>
        )}

        {selectedOrder && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Order header */}
            <div style={{
              background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.charcoal }}>
                  {selectedOrder.customer} — {selectedOrder.desc || selectedOrder.sku}
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                  {selectedOrder.id} · {selectedOrder.qty.toLocaleString()} cs · MABD {selectedOrder.mabd ?? '—'} · {selectedOrder.ship_to}
                </div>
              </div>
              <Pill label={selectedOrder.flag} color={flagColor(selectedOrder.flag_type)} size={11} />
            </div>

            {/* IDLE — show Evaluate CTA */}
            {phase === 'idle' && (
              <div style={{
                background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
                padding: 22, display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 12,
              }}>
                <Bot size={28} color={C.red} />
                <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
                  Ready to evaluate this order with 5 agents
                </div>
                <div style={{
                  fontSize: 12, color: C.muted, maxWidth: 460, textAlign: 'center', lineHeight: 1.55,
                }}>
                  Triage takes 30 to 180 seconds. You can cancel mid-flight.
                </div>
                <button onClick={() => runTriage(selectedOrder)} style={{
                  marginTop: 4, padding: '10px 22px', background: C.red, color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  fontFamily: 'inherit',
                }}>
                  <Zap size={15} /> Evaluate Agents
                </button>
              </div>
            )}

            {/* EVALUATING — agent cards in pending state + timer + cancel */}
            {phase === 'evaluating' && (
              <>
                <div style={{
                  background: C.charcoal, borderRadius: 8, padding: '10px 16px',
                  color: '#fff', display: 'flex', alignItems: 'center', gap: 12,
                  justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Loader2 size={15} className="animate-spin" style={{ color: C.teal }} />
                    <span style={{ fontSize: 13, color: C.teal }}>
                      4 specialist agents running in parallel<Blinker />
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontFamily: MONO, fontSize: 13, color: '#fff' }}>
                      {fmtElapsed(elapsedMs)}
                    </span>
                    <button onClick={cancelTriage} style={{
                      padding: '4px 12px', background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4,
                      color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}>Cancel</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {AGENT_KEYS.map(k => renderAgentCard(k, null, true))}
                </div>
              </>
            )}

            {/* RESULT or DECIDED — render the synthesis */}
            {(phase === 'result' || phase === 'decided') && result && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {AGENT_KEYS.map(k => renderAgentCard(k, result.synthesis.signals[k] ?? null, false))}
                </div>

                {result.synthesis.conflicts.length > 0 && (
                  <ConflictBanner conflict={result.synthesis.conflicts[0]} />
                )}

                <RecommendationCard
                  syn={result.synthesis}
                  decided={phase === 'decided'}
                  onApprove={handleApprove}
                  onReject={() => setRejectModalOpen(true)} />

                {phase === 'decided' && selectedOrder && (
                  <div style={{
                    background: decisionByOrder[selectedOrder.id] === 'approved' ? C.green : C.red,
                    borderRadius: 8, padding: '14px 20px', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <CheckCircle2 size={20} />
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>
                          {decisionByOrder[selectedOrder.id] === 'approved'
                            ? 'Recommendation approved — executing'
                            : 'Recommendation rejected — logged'}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.9, marginTop: 2 }}>
                          session_id={result.session_id} · user={USER_ID}
                        </div>
                      </div>
                    </div>
                    <button onClick={backToQueue} style={{
                      padding: '8px 14px', background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6,
                      color: '#fff', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>Back to queue</button>
                  </div>
                )}
              </>
            )}

            {/* ERROR — show typed message + retry */}
            {phase === 'error' && error && (
              <ErrorPanel err={error}
                          onTryAnother={backToQueue}
                          onRetry={() => runTriage(selectedOrder)} />
            )}
          </div>
        )}

        {/* Reject modal */}
        {rejectModalOpen && (
          <RejectModal
            onCancel={() => setRejectModalOpen(false)}
            onSubmit={handleRejectSubmit} />
        )}
      </div>
    </div>
  );
}

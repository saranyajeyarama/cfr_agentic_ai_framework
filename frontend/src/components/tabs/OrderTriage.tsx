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
  fetchOrders, triageOrder, getTriageCached, approveSession, rejectSession, simulateFulfillment,
  invalidateDashboard, appendSessionDecision,
  AbortError, ValidationError, BackendError, NetworkError,
} from '../../lib/api';
import type { Order, TriageResponse, AgentKey, SimulateResponse } from '../../lib/types';

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

// Per-order decisions persist for the browser session so each row keeps its
// "Approved" / "Rejected" state when the user leaves Order Triage and comes
// back. The tab switch unmounts this component, which would otherwise reset
// the in-memory map and make a decided order look un-actioned again.
const TRIAGE_DECISIONS_KEY = 'tiger:triage:decisions:v1';

function loadTriageDecisions(): Record<string, DecisionKind> {
  try {
    const raw = sessionStorage.getItem(TRIAGE_DECISIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, DecisionKind>;
    }
  } catch { /* sessionStorage unavailable / bad JSON → start empty */ }
  return {};
}

function saveTriageDecisions(m: Record<string, DecisionKind>): void {
  try { sessionStorage.setItem(TRIAGE_DECISIONS_KEY, JSON.stringify(m)); } catch { /* ignore quota / privacy mode */ }
}

// Defensive display guard: a fill rate emitted as a 0–1 fraction (e.g. 1.0)
// must read as 100%, not "1%". Clamp to 0–100 and round. (The backend adapter
// now computes the true fill rate; this just hardens the UI.)
function normFillPct(v: number | undefined | null): number {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

// Hardcoded planner identity — replace with auth context when available.
const USER_ID = 'planner.ops@mars.com';

// Triage timeout. The 5-agent run + 2 debate rounds + synthesis regularly
// takes 200-260s in practice (measured: 202s on a 4-agent fan-out with a
// HARD_BLOCK that triggered a 2-round debate). 180s was too tight — the
// frontend aborted before the synthesis arrived, dropping the user back at
// the "Ready to evaluate" screen with no visible error. 360s gives a real
// margin for the agent flow to complete.
const TIMEOUT_MS = 360_000;

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
              ['Fill Rate',    `${normFillPct(r.fill_pct)}%`],
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
// Rich per-agent detail (mockup: tool-call terminal + structured field rows)
// =============================================================================

type PlantInv = { ending: number; committed: number; available: number };

function humanizeKey(k: string): string {
  return k
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bUsd\b/g, 'USD').replace(/\bAtp\b/g, 'ATP')
    .replace(/\bOtif\b/g, 'OTIF').replace(/\bDc\b/g, 'DC')
    .replace(/\bPos\b/g, 'POS').replace(/\bFg\b/g, 'FG')
    .replace(/\bOhi\b/g, 'OHI').replace(/\bAcv\b/g, 'ACV')
    .replace(/\bWmape\b/gi, 'WMAPE').replace(/\bMabd\b/g, 'MABD');
}

function fmtSignalValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  return String(v);
}

/** A labeled value row. */
function detailRow(label: string, value: unknown, key: string) {
  return (
    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ color: C.charcoal, fontWeight: 600, fontFamily: MONO, textAlign: 'right', maxWidth: '60%' }}>
        {fmtSignalValue(value)}
      </span>
    </div>
  );
}

/** Generic structured renderer over a specialist's full_signal. Handles the
 *  Gemini-shaped nesting without assuming exact field names: scalars become
 *  rows, nested objects become labeled sub-sections, string arrays become
 *  bullet lists, object arrays become compact rows. */
function renderSignalDetail(full: Record<string, unknown>, accent: string) {
  const entries = Object.entries(full).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) {
    return <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No structured detail returned for this agent.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.map(([k, v]) => {
        // string[] → bullets (e.g. classification_basis)
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          return (
            <div key={k}>
              <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{humanizeKey(k)}</div>
              {(v as string[]).map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: C.charcoal, marginBottom: 4 }}>
                  <span style={{ color: accent, flexShrink: 0 }}>•</span>{s}
                </div>
              ))}
            </div>
          );
        }
        // object[] → compact rows (e.g. top_chargeback_types, evidence)
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
          return (
            <div key={k}>
              <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{humanizeKey(k)}</div>
              {(v as Record<string, unknown>[]).map((o, i) => (
                <div key={i} style={{ fontSize: 11, color: C.charcoal, marginBottom: 3 }}>
                  {Object.entries(o).map(([ok, ov]) => `${humanizeKey(ok)}: ${fmtSignalValue(ov)}`).join(' · ')}
                </div>
              ))}
            </div>
          );
        }
        // nested object → labeled sub-section of scalar rows
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const obj = v as Record<string, unknown>;
          const scalarRows = Object.entries(obj).filter(([, ov]) => ov === null || typeof ov !== 'object');
          const longText = Object.entries(obj).find(([ok]) => /summary|rationale|note|comment/i.test(ok));
          return (
            <div key={k} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{humanizeKey(k)}</div>
              {scalarRows
                .filter(([ok]) => !/summary|rationale|note|comment|evidence/i.test(ok))
                .map(([ok, ov]) => detailRow(humanizeKey(ok), ov, `${k}-${ok}`))}
              {longText && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{String(longText[1])}</div>
              )}
            </div>
          );
        }
        // scalar
        return detailRow(humanizeKey(k), v, k);
      })}
    </div>
  );
}

/** Rich agent panel: header + tool-call terminal (from evidence) + structured
 *  detail (from full_signal) + confidence bar. Replaces the simple card in the
 *  result view. */
function AgentDetailPanel({
  agentKey, signal,
}: {
  agentKey: AgentKey;
  signal: TriageResponse['synthesis']['signals'][AgentKey] | undefined;
  key?: string | number;
}) {
  const meta = AGENT_LABELS[agentKey];
  const disp = signal?.disposition ?? 'CAUTION';
  const conf = signal?.confidence ?? 0;
  const full = (signal?.full_signal ?? {}) as Record<string, unknown>;
  const evidence = signal?.evidence ?? [];

  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
      borderTop: `3px solid ${meta.color}`, display: 'flex', flexDirection: 'column',
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.label}</div>
        <Pill label={disp} color={dispColor(disp)} size={10} />
      </div>

      {/* tool-call terminal — lines derived from evidence */}
      <div style={{ margin: '10px 16px 0', background: '#161922', borderRadius: 6, padding: '8px 10px', fontFamily: MONO, fontSize: 10.5, lineHeight: 1.7, color: '#9aa4b2', maxHeight: 92, overflow: 'auto' }}>
        {evidence.length > 0
          ? evidence.slice(0, 4).map((e, i) => (
              <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ color: meta.color }}>▸ {e.tool || 'tool_call'}</span>
                {e.finding ? <span style={{ color: '#9aa4b2' }}> → {e.finding}</span> : null}
              </div>
            ))
          : <div style={{ color: '#5b6472' }}>▸ tool calls not reported by agent</div>}
        <div style={{ color: dispColor(disp), marginTop: 2 }}>
          ◆ {disp}{signal?.summary ? ` — ${signal.summary}` : ''}
        </div>
      </div>

      {/* structured detail */}
      <div style={{ padding: '12px 16px 4px' }}>
        {renderSignalDetail(full, meta.color)}
      </div>

      {/* confidence bar */}
      <div style={{ padding: '8px 16px 14px', marginTop: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: C.muted, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Confidence</span>
          <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
            <div style={{ width: `${Math.round(conf * 100)}%`, height: '100%', background: meta.color, borderRadius: 2 }} />
          </div>
          <span style={{ color: meta.color, fontWeight: 700, fontSize: 11, fontFamily: MONO }}>{Math.round(conf * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

/** Real-Time Inventory Snapshot — per-DC table + committed-vs-ATP panel,
 *  sourced from a /fulfillment/simulate run for the order. */
function InventorySnapshot({
  order, sim, status,
}: {
  order: Order;
  sim: SimulateResponse | null;
  status: 'loading' | 'done' | 'error' | 'idle';
}) {
  const orderedQty = order.qty;
  const meta = (sim?.meta ?? {}) as Record<string, unknown>;
  const inv = (meta.inventory_by_plant as Record<string, PlantInv> | undefined) ?? {};
  const freight = (meta.freight_costs_used as Record<string, number> | undefined) ?? {};
  const originPlant = (meta.origin_plant as string | undefined) ?? '';
  const rec = sim?.scenarios?.find((s) => s.isRecommended) ?? sim?.scenarios?.[0];
  const split: Record<string, number> = {};
  for (const p of (rec?.plantDetails ?? []) as Array<{ code: string; qty: number }>) {
    split[p.code] = (split[p.code] ?? 0) + (Number(p.qty) || 0);
  }
  const codes = Object.keys(inv).sort((a, b) => (inv[b].available || 0) - (inv[a].available || 0));
  const totalAvail = codes.reduce((s, c) => s + (inv[c].available || 0), 0);
  const totalEnding = codes.reduce((s, c) => s + (inv[c].ending || 0), 0);
  const totalCommitted = codes.reduce((s, c) => s + (inv[c].committed || 0), 0);
  const coveragePct = orderedQty > 0 ? Math.min(100, Math.round((totalAvail / orderedQty) * 100)) : 0;
  const shortfall = Math.max(0, orderedQty - totalAvail);

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.teal}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>Real-Time Inventory Snapshot — {order.sku}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Network availability vs. order of {orderedQty.toLocaleString()} cs</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Network Coverage</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: coveragePct >= 100 ? C.green : C.orange, fontFamily: MONO }}>{coveragePct}%</div>
          <div style={{ fontSize: 10, color: C.muted }}>{totalAvail.toLocaleString()} cs network-wide</div>
        </div>
      </div>

      {status === 'loading' && (
        <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Loader2 size={14} className="animate-spin" /> Pulling live network inventory…
        </div>
      )}
      {status === 'error' && (
        <div style={{ padding: 16, fontSize: 12, color: C.muted }}>Inventory snapshot unavailable for this order.</div>
      )}

      {status === 'done' && codes.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th style={{ textAlign: 'left', padding: '8px 18px', fontWeight: 700 }}>DC</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700 }}>Available</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700 }}>Coverage vs order</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700 }}>Allocated</th>
                <th style={{ textAlign: 'right', padding: '8px 18px', fontWeight: 700 }}>After Fill</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => {
                const a = inv[code];
                const allocated = split[code] ?? 0;
                const afterFill = (a.available || 0) - allocated;
                const cov = orderedQty > 0 ? Math.min(100, ((a.available || 0) / orderedQty) * 100) : 0;
                const ok = (a.available || 0) >= orderedQty;
                const barCol = ok ? C.green : cov >= 40 ? C.orange : C.red;
                return (
                  <tr key={code} style={{ borderTop: `1px solid ${C.border}`, background: allocated > 0 ? '#fff7f9' : '#fff' }}>
                    <td style={{ padding: '10px 18px' }}>
                      <div style={{ fontWeight: 700, color: code === originPlant ? C.blue : C.charcoal, fontFamily: MONO }}>{code}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>
                        {code === originPlant ? 'Primary DC' : 'Alternate'}{freight[code] != null ? ` · $${freight[code]}/cs` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: MONO }}>{(a.available || 0).toLocaleString()} cs</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${cov}%`, height: '100%', background: barCol, borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: 10, color: ok ? C.green : C.red, marginTop: 2, fontWeight: 600 }}>{ok ? 'OK' : 'BELOW SS'} · {Math.round(cov)}%</div>
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: MONO }}>
                      {allocated > 0 ? <span style={{ color: C.red, fontWeight: 700 }}>{allocated.toLocaleString()} cs</span> : <span style={{ color: C.border }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 18px', textAlign: 'right', fontFamily: MONO, color: afterFill <= 0 ? C.orange : C.charcoal }}>
                      {afterFill <= 0 ? 'Depleted' : `${afterFill.toLocaleString()} cs`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Committed vs Available to Promise */}
          <div style={{ margin: 18, borderRadius: 8, border: `1px solid ${shortfall > 0 ? C.red : C.border}`, padding: 16, background: C.off }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.charcoal, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Committed vs Available to Promise — Network
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
              {([
                ['On Hand (Total)', `${totalEnding.toLocaleString()} cs`, C.charcoal],
                ['Committed', `${totalCommitted.toLocaleString()} cs`, C.orange],
                ['Avail. to Promise', `${totalAvail.toLocaleString()} cs`, C.green],
                ['Order Requires', `${orderedQty.toLocaleString()} cs`, C.red],
              ] as [string, string, string][]).map(([l, v, col]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: MONO, color: col, marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: shortfall > 0 ? C.red : C.green }}>
              {shortfall > 0
                ? `⚠ ATP shortfall of ${shortfall.toLocaleString()} cs — partial fulfillment or split sourcing required`
                : '✓ Network ATP fully covers the order'}
              {rec && (rec.plantDetails?.length ?? 0) > 1 && (
                <span style={{ color: C.green, fontWeight: 600 }}> · Network can cover full order via split sourcing</span>
              )}
            </div>
          </div>
        </>
      )}
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
  // we wait for the queue to refetch). Seeded from sessionStorage so the state
  // survives a tab switch (component remount).
  const [decisionByOrder, setDecisionByOrder] = useState<Record<string, DecisionKind>>(loadTriageDecisions);
  const [rejectModalOpen, setRejectModalOpen] = useState<boolean>(false);

  // Persist decisions for the session whenever they change.
  useEffect(() => { saveTriageDecisions(decisionByOrder); }, [decisionByOrder]);

  // Real-Time Inventory Snapshot — a fast /fulfillment/simulate run for the
  // selected order (per-DC ATP). Keyed by order id so it doesn't refire.
  const [invSim, setInvSim] = useState<{
    orderId: string;
    status: 'loading' | 'done' | 'error';
    sim: SimulateResponse | null;
  } | null>(null);

  // True when the displayed result was replayed from the BigQuery cache
  // (not a fresh agent run this session).
  const [fromCache, setFromCache] = useState<boolean>(false);

  const abortRef    = useRef<AbortController | null>(null);
  const timerRef    = useRef<number | null>(null);
  const startTsRef  = useRef<number>(0);
  // Guards async cache-peeks against rapid order switching.
  const latestSelectRef = useRef<string | null>(null);

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
    latestSelectRef.current = o.id;
    setSelectedId(o.id);
    setPhase('idle');
    setResult(null);
    setError(null);
    setElapsedMs(0);
    setRejectModalOpen(false);
    setInvSim(null);
    setFromCache(false);
    // Replay a stored result instantly if this order was evaluated before.
    void peekCache(o);
  }

  /** Cache-only peek on select — replay a stored synthesis without re-running
   *  the 5-agent flow. Guarded so a slow peek for a previously-selected order
   *  doesn't clobber the current selection. */
  async function peekCache(o: Order) {
    try {
      const c = await getTriageCached(o.id);
      if (latestSelectRef.current !== o.id) return;        // selection moved on
      if (c.cached && c.synthesis) {
        setResult({
          order_id: o.id,
          session_id: c.session_id ?? '',
          synthesis: c.synthesis,
        } as TriageResponse);
        setFromCache(true);
        setPhase('result');
        void loadInventorySnapshot(o);
      }
    } catch {
      /* no cache / backend down — leave the Evaluate CTA in place */
    }
  }

  /** Fire a fast /fulfillment/simulate for the Real-Time Inventory Snapshot.
   *  Independent of the long triage call — populates per-DC ATP. */
  async function loadInventorySnapshot(order: Order) {
    setInvSim({ orderId: order.id, status: 'loading', sim: null });
    try {
      const sim = await simulateFulfillment({
        sold_to: order._backend.sold_to,
        material_number: order._backend.material_number,
        ordered_quantity_cases: order._backend.ordered_quantity_cases,
        requested_delivery_date: order._backend.requested_delivery_date,
      });
      setInvSim({ orderId: order.id, status: 'done', sim });
    } catch {
      setInvSim({ orderId: order.id, status: 'error', sim: null });
    }
  }

  async function runTriage(order: Order, force = false) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    startTsRef.current = Date.now();
    setElapsedMs(0);
    setError(null);
    setResult(null);
    setFromCache(false);
    setPhase('evaluating');

    // Wall-clock tick
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startTsRef.current);
    }, 500);

    // Timeout — the UI gives up after TIMEOUT_MS but the backend session keeps
    // running. If the agent flow eventually produces a synthesis you can read
    // it via GET /sessions/{sid} or it'll show up in the next /v23/orders list
    // refresh once approved.
    const timeoutHandle = window.setTimeout(() => {
      ctrl.abort();
      if (timerRef.current != null) clearInterval(timerRef.current);
      setError({
        kind: 'timeout',
        message: `Agents still running after ${TIMEOUT_MS / 1000}s — the backend session is unaffected. Click Retry to wait again or try a different order.`,
      });
      setPhase('error');
    }, TIMEOUT_MS);

    try {
      const r = await triageOrder(order.id, order._backend, ctrl.signal, force);
      window.clearTimeout(timeoutHandle);
      if (timerRef.current != null) clearInterval(timerRef.current);
      setResult(r);
      setFromCache(Boolean((r as { cached?: boolean }).cached));
      setPhase('result');
      // Pull the per-DC inventory snapshot once the synthesis is in.
      void loadInventorySnapshot(order);
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
    // Optimistic append so the decision shows in the Decision Log immediately
    // (and survives a backend outage). BQ reconciles on the next fetch.
    const recA = result.synthesis?.rec;
    // Mirror the backend's action-only SAP fallback so the type shows instantly.
    const recAAct = (recA?.action || '').toUpperCase();
    const recAExec = recAAct === 'ACCEPT' || recAAct === 'PARTIAL_FULFILL' || recAAct === 'PARTIAL' || recAAct === 'DEFER';
    appendSessionDecision({
      id: result.session_id || selectedOrder.id,
      timestamp: new Date().toISOString(),
      poNumber: selectedOrder.id || selectedOrder.po,
      customer: selectedOrder.customer,
      material: selectedOrder.sku,
      action: recA?.action || '',
      agentRecommendation: recA?.action || '',
      userDecision: 'approved',
      fulfillQty: recA?.qty ?? selectedOrder.qty ?? 0,
      fillRatePct: normFillPct(recA?.fill_pct),
      userId: USER_ID,
      rationale: recA?.outcome || '',
      sessionId: result.session_id || '',
      orchestratorVersion: '',
      overrideReason: null,
      outcome: 'Submitted — pending fulfillment',
      aligned: true,
      financialImpact: 0,
      wentWrong: false,
      decisionType: recAExec ? 'ORDER_ADJUSTMENT' : 'ESCALATION',
      sapTransactionTarget: recAExec ? 'VA02' : undefined,
      source: 'order_triage',
    });
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
    const recR = result.synthesis?.rec;
    const recRAct = (recR?.action || '').toUpperCase();
    const recRExec = recRAct === 'ACCEPT' || recRAct === 'PARTIAL_FULFILL' || recRAct === 'PARTIAL' || recRAct === 'DEFER';
    appendSessionDecision({
      id: result.session_id || selectedOrder.id,
      timestamp: new Date().toISOString(),
      poNumber: selectedOrder.id || selectedOrder.po,
      customer: selectedOrder.customer,
      material: selectedOrder.sku,
      action: recR?.action || '',
      agentRecommendation: recR?.action || '',
      userDecision: 'rejected',
      fulfillQty: 0,
      fillRatePct: 0,
      userId: USER_ID,
      rationale: recR?.outcome || '',
      sessionId: result.session_id || '',
      orchestratorVersion: '',
      overrideReason: reason,
      outcome: 'Rejected by user',
      aligned: false,
      financialImpact: 0,
      wentWrong: false,
      decisionType: recRExec ? 'ORDER_ADJUSTMENT' : 'ESCALATION',
      sapTransactionTarget: recRExec ? 'VA02' : undefined,
      source: 'order_triage',
    });
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
                  Triage typically takes 60 to 240 seconds (5 agents in parallel
                  plus debate-on-conflict). You can cancel mid-flight.
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
                {/* Cache banner — replayed stored result, with force re-run */}
                {fromCache && phase === 'result' && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, background: '#eef6ff', border: `1px solid ${C.blue}33`,
                    borderRadius: 8, padding: '10px 14px',
                  }}>
                    <div style={{ fontSize: 12, color: C.charcoal }}>
                      <strong style={{ color: C.blue }}>Stored result</strong> — replayed from the
                      decision cache (not re-run). Consistent across reloads.
                    </div>
                    <button onClick={() => runTriage(selectedOrder, true)} style={{
                      padding: '6px 14px', background: '#fff', color: C.red,
                      border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 12,
                      fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                    }}>
                      <RefreshCw size={13} /> Re-evaluate
                    </button>
                  </div>
                )}

                {/* 1 — Real-Time Inventory Snapshot (metrics first) */}
                <InventorySnapshot
                  order={selectedOrder}
                  sim={invSim && invSim.orderId === selectedOrder.id ? invSim.sim : null}
                  status={invSim && invSim.orderId === selectedOrder.id ? invSim.status : 'loading'} />

                {/* 2 — Each agent's detailed decision */}
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>
                  Specialist Agent Decisions
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {AGENT_KEYS.map(k => (
                    <AgentDetailPanel key={k} agentKey={k} signal={result.synthesis.signals[k]} />
                  ))}
                </div>

                {result.synthesis.conflicts.length > 0 && (
                  <ConflictBanner conflict={result.synthesis.conflicts[0]} />
                )}

                {/* 3 — Synthesized recommendation */}
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
                          {result.case_id ? `case_id=${result.case_id} · ` : ''}
                          {result.suggestion_id ? `suggestion_id=${result.suggestion_id.slice(0, 8)} · ` : ''}
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

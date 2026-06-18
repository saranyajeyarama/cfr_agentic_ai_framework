/**
 * Decision Log — durable, paginated audit trail of agentic decisions.
 *
 * Loads from GET /decision-log ({ total_count, filtered_count, decisions[] }),
 * read from tiger_decisions.fct_allocation_decisions. Approvals/rejections made
 * in Order Triage are appended to an in-memory session store so they appear
 * immediately and survive a backend outage (5xx → fall back to that store).
 */

import { useCallback, useEffect, useState } from 'react';
import { Clock, AlertTriangle, ChevronRight, ChevronDown, Loader2, Download } from 'lucide-react';
import {
  fetchDecisionLog, fetchSapPayload, readSessionDecisions,
  type DecisionLogRow, type DecisionLogResponse,
} from '../../lib/api';
import { DashboardSkeleton } from '../primitives';

const LIMIT = 200;

// Client-side export of ONE decision — the complete order + audit record for
// the expanded row (every field the Decision Log holds for that order).
function downloadDecisionJson(d: DecisionLogRow) {
  const payload = {
    exported_at: new Date().toISOString(),
    source: 'GET /decision-log · tiger_decisions.fct_allocation_decisions',
    decision: d,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const tag = String(d.poNumber || d.id || 'decision').replace(/[^\w.-]+/g, '_');
  a.download = `decision_${tag}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tsLabel(ts: string): string {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
      ' ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return ts;
  }
}

function outcomeColor(outcome: string): string {
  const o = (outcome || '').toLowerCase();
  if (o.includes('chargeback') || o.includes('rejection') || o.includes('short') || o.includes('fail'))
    return '#DB033B';
  if (o.includes('pending') || o.includes('tbd') || o.includes('transit') || o.includes('partial'))
    return '#d97706';
  if (o.includes('fulfilled') || o.includes('accepted') || o.includes('ok'))
    return '#059669';
  return '#94a3b8';
}

const fmtUsd = (v?: number) =>
  v == null || v === 0 ? '$0' : v < 0 ? `-$${Math.abs(v).toLocaleString()}` : `$${v.toLocaleString()}`;

// Agent recommendation verb, normalized for display (PARTIAL_FULFILL → PARTIAL).
const fmtRec = (a?: string) => ((a || '').toUpperCase().replace('PARTIAL_FULFILL', 'PARTIAL') || '—');

function StatTile({
  label, value, sub, status,
}: { label: string; value: string; sub: string; status: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    ok:      { bg: '#edf7ee', border: '#059669', text: '#059669' },
    warn:    { bg: '#fff8e6', border: '#d97706', text: '#d97706' },
    bad:     { bg: '#fde8ec', border: '#DB033B', text: '#DB033B' },
    neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#1e293b' },
  };
  const c = colors[status];
  return (
    <div style={{ background: c.bg, border: '1px solid #e2e8f0', borderBottom: `3px solid ${c.border}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: c.text, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div>
    </div>
  );
}

// ─── Detail panel (expanded row) ──────────────────────────────────────────────

function DetailPanel({ d }: { d: DecisionLogRow }) {
  const [sapBusy, setSapBusy] = useState(false);
  const [sapErr, setSapErr]   = useState<string | null>(null);
  const Field = ({ label, value }: { label: string; value: string }) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#1e293b', marginTop: 2, wordBreak: 'break-word' }}>{value || '—'}</div>
    </div>
  );

  // Generate the Section-7 Layer-2 SAP JSON for THIS decision (backend builds it,
  // looking up SAP master data from BigQuery), then download the envelope.
  async function handleSapDownload() {
    setSapBusy(true);
    setSapErr(null);
    try {
      const payload = await fetchSapPayload(d.id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const tag = String(d.poNumber || d.id || 'decision').replace(/[^\w.-]+/g, '_');
      a.download = `sap_payload_${tag}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setSapErr(e instanceof Error ? e.message : 'SAP payload generation failed');
    } finally {
      setSapBusy(false);
    }
  }

  return (
    <div style={{ gridColumn: '1 / -1', background: '#f8fafc', borderTop: '1px dashed #e2e8f0', padding: '14px 18px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '12px 24px' }}>
        <Field label="Agent Recommendation" value={d.agentRecommendation} />
        <Field label="User Decision" value={d.userDecision} />
        <Field label="Rejection / Override Reason" value={d.overrideReason || '—'} />
        <Field label="Outcome" value={d.outcome} />
        <Field label="SAP Transaction" value={d.sapTransactionTarget || '— (no SAP change)'} />
        <Field label="SAP Decision Type" value={d.decisionType || '—'} />
        <Field label="Session ID" value={d.sessionId} />
        <Field label="Orchestrator Version" value={d.orchestratorVersion} />
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Rationale</div>
        <div style={{ fontSize: 12, color: '#334155', marginTop: 3, lineHeight: 1.6 }}>{d.rationale || '— (no rationale recorded)'}</div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {sapErr && <span style={{ fontSize: 11, color: '#DB033B', fontWeight: 600 }}>{sapErr}</span>}
        <button
          onClick={handleSapDownload}
          disabled={sapBusy}
          title="Generate the Section-7 Layer-2 SAP JSON (BATP payload) for this decision and download it"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid #7c3aed', borderRadius: 6, background: sapBusy ? '#f5f3ff' : '#fff', color: '#7c3aed', cursor: sapBusy ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, opacity: sapBusy ? 0.6 : 1 }}
        >
          {sapBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download SAP JSON
        </button>
        <button
          onClick={() => downloadDecisionJson(d)}
          title="Download this order & decision record as JSON"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', color: '#1e293b', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
        >
          <Download className="w-3.5 h-3.5" /> Download JSON
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DecisionLog() {
  const [resp, setResp]       = useState<DecisionLogResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError]     = useState<string | null>(null);
  const [fellBack, setFellBack] = useState<boolean>(false);
  const [offset, setOffset]   = useState<number>(0);
  const [openId, setOpenId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchDecisionLog(LIMIT, offset);
      setResp(r);
      setFellBack(false);
    } catch (e) {
      // 5xx / backend down → muted message + in-memory current-session view.
      const sess = readSessionDecisions();
      setResp({ total_count: sess.length, filtered_count: sess.length, decisions: sess });
      setFellBack(true);
      setError(e instanceof Error ? e.message : 'Decision log unavailable');
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !resp) return <DashboardSkeleton title="Loading Decision Log…" />;

  const bqRows = resp?.decisions ?? [];
  // Merge fresh current-session decisions (not yet round-tripped from BQ) on page 1.
  const sessionRows = (!fellBack && offset === 0) ? readSessionDecisions() : [];
  const bqKeys = new Set(bqRows.map(r => r.sessionId || r.id));
  const freshSession = sessionRows.filter(r => !bqKeys.has(r.sessionId || r.id));
  const rows: DecisionLogRow[] = [...freshSession, ...bqRows];

  const total       = (resp?.total_count ?? 0) + freshSession.length;
  const pageCount   = rows.length;
  const alignedCount = rows.filter(d => d.aligned).length;
  const acceptRate  = pageCount > 0 ? Math.round((alignedCount / pageCount) * 100) : 0;
  const overridesGoneWrong = rows.filter(d => d.wentWrong).length;
  const overrideEntries = rows.filter(d => d.aligned === false);

  const colGrid = '72px 92px 112px 66px 74px 82px 70px 60px 42px 104px minmax(176px,1fr) 80px 48px';
  const TABLE_MIN = 1078;  // sum of column min-widths → table scrolls instead of collapsing
  const headers = ['Time', 'Order', 'Customer', 'Material', 'Agent Rec', 'Decision', 'SAP Txn', 'Fulfill', 'Fill %', 'User', 'Outcome', 'Financial', 'Aligned'];

  const hasPaging = total > LIMIT || offset > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Decision Log</h1>
          <p className="text-xs text-slate-500">
            Every order decision captured with outcomes — accountability and learning loop
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-500">
            GET <span className="font-mono text-slate-700">/decision-log</span> · tiger_decisions.fct_allocation_decisions
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50">

        {/* 5xx / offline fallback banner */}
        {fellBack && (
          <div style={{ background: '#fff8e6', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle className="w-4 h-4" />
            Historical audit log unavailable{error ? ` (${error})` : ''} — showing this session's decisions only.
          </div>
        )}

        {/* ── KPI tiles ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <StatTile label="Total Decisions" value={total.toString()} sub={fellBack ? 'this session (offline)' : 'all-time in BQ audit table'} status="neutral" />
          <StatTile label="Aligned with AI" value={`${alignedCount} of ${pageCount}`} sub="human agreed with agent" status={pageCount === 0 ? 'neutral' : alignedCount / pageCount >= 0.7 ? 'ok' : 'warn'} />
          <StatTile label="AI Acceptance Rate" value={`${acceptRate}%`} sub="agent rec accepted" status={acceptRate >= 80 ? 'ok' : acceptRate >= 60 ? 'warn' : pageCount === 0 ? 'neutral' : 'bad'} />
          <StatTile label="Overrides Gone Wrong" value={overridesGoneWrong.toString()} sub="override caused a shortfall" status={overridesGoneWrong === 0 ? 'ok' : 'bad'} />
        </div>

        {/* ── Override Outcomes — Where Human and AI Disagreed ───────────── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Override Outcomes — Where Human and AI Disagreed
          </div>
          {overrideEntries.length === 0 ? (
            <div style={{ padding: '20px 14px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
              No human–AI disagreements recorded — every logged decision aligned with the agent's recommendation.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {overrideEntries.map(d => (
                  <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '90px 110px 1.4fr 1.2fr 1fr 110px', gap: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 6, borderLeft: `4px solid ${d.wentWrong ? '#DB033B' : '#d97706'}`, fontSize: 11, alignItems: 'center' }}>
                    <span style={{ color: '#94a3b8', fontSize: 10 }}>{tsLabel(d.timestamp)}</span>
                    <span style={{ fontWeight: 700, color: '#1e293b', fontFamily: 'monospace', fontSize: 10 }}>{d.poNumber || '—'}</span>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{d.customer}{d.material ? ` — ${d.material}` : ''}</div>
                      <div style={{ color: '#94a3b8', marginTop: 2 }}>Agent said: {d.agentRecommendation}</div>
                    </div>
                    <div style={{ fontWeight: 600, color: '#d97706' }}>Override: "{d.overrideReason || '—'}"</div>
                    <div style={{ color: outcomeColor(d.outcome), fontWeight: 600 }}>{d.outcome}</div>
                    <div style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: (d.financialImpact ?? 0) < 0 ? '#DB033B' : '#64748b' }}>{fmtUsd(d.financialImpact)}</div>
                  </div>
                ))}
              </div>
              {overridesGoneWrong > 0 && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#fde8ec', borderRadius: 6, fontSize: 11, color: '#DB033B', fontWeight: 600 }}>
                  {overridesGoneWrong} override{overridesGoneWrong === 1 ? '' : 's'} resulted in a shortfall / chargeback exposure — the AI recommendation would have avoided these outcomes.
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Full audit table ───────────────────────────────────────────── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Complete Decision History</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                Newest first · click a row for full rationale &amp; audit detail
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {loading ? <Loader2 className="inline w-3 h-3 animate-spin" /> : `${pageCount} shown · ${total} total`}
            </span>
          </div>

          {/* Horizontally scrollable grid — header + rows scroll together and keep
              their column widths instead of collapsing on a narrow window. */}
          <div style={{ overflowX: 'auto' }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: colGrid, minWidth: TABLE_MIN, columnGap: 12, background: '#f8fafc', padding: '5px 12px', borderBottom: '1px solid #e2e8f0' }}>
            {headers.map(h => (
              <div key={h} style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
            ))}
          </div>

          {/* Empty state */}
          {pageCount === 0 && (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>No decisions recorded yet</div>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>Approve or reject an order in Order Triage and it will appear here.</div>
            </div>
          )}

          {/* Data rows */}
          {rows.map((d, i) => {
            const isOpen = openId === d.id;
            const dec = (d.userDecision || '').toLowerCase();
            const isAccept = dec === 'approved' || dec === 'accept' || dec === 'accepted';
            return (
              <div key={d.id || i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <div
                  onClick={() => setOpenId(isOpen ? null : d.id)}
                  style={{ display: 'grid', gridTemplateColumns: colGrid, minWidth: TABLE_MIN, columnGap: 12, padding: '9px 12px', background: d._session ? '#f0fdf4' : i % 2 === 0 ? '#fff' : '#f8fafc', fontSize: 11, alignItems: 'center', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 2 }}>
                    {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{tsLabel(d.timestamp)}
                  </span>
                  <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 10, fontFamily: 'monospace' }}>{d.poNumber || '—'}</span>
                  <span title={d.customer} style={{ color: '#1e293b', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.customer || '—'}</span>
                  <span style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace' }}>{d.material || '—'}</span>
                  <span style={{ color: '#334155', fontSize: 10, fontWeight: 700 }} title="What the AI agent recommended">{fmtRec(d.action)}</span>
                  <span style={{ color: dec ? (isAccept ? '#059669' : '#DB033B') : '#94a3b8', fontSize: 10, fontWeight: 700 }} title="What the planner submitted">{dec ? (isAccept ? 'APPROVED' : 'REJECTED') : '—'}</span>
                  <span style={{ color: '#7c3aed', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }} title={d.decisionType ? `Section-7 SAP transaction · ${d.decisionType}` : 'Section-7 SAP transaction'}>{d.sapTransactionTarget || '—'}</span>
                  <span style={{ fontFamily: 'monospace', color: '#1e293b' }}>{(d.fulfillQty ?? 0).toLocaleString()} cs</span>
                  <span style={{ fontFamily: 'monospace', color: '#475569' }}>{(d.fillRatePct ?? 0)}%</span>
                  <span title={d.userId} style={{ fontSize: 10, color: '#64748b', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.userId || '—'}</span>
                  <span title={d.outcome} style={{ color: outcomeColor(d.outcome), fontSize: 11, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.outcome || '—'}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600, color: (d.financialImpact ?? 0) < 0 ? '#DB033B' : '#64748b' }}>{fmtUsd(d.financialImpact)}</span>
                  <span style={{ color: d.aligned ? '#059669' : '#DB033B', fontSize: 10, fontWeight: 700 }}>{d.aligned ? 'Yes' : 'No'}</span>
                </div>
                {isOpen && <DetailPanel d={d} />}
              </div>
            );
          })}
          </div>

          {/* Pagination */}
          {hasPaging && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#64748b' }}>
              <span>
                Showing {total === 0 ? 0 : offset + 1}–{offset + pageCount} of {total}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0 || loading}
                  style={{ padding: '5px 12px', border: '1px solid #e2e8f0', borderRadius: 6, background: offset === 0 ? '#f8fafc' : '#fff', color: offset === 0 ? '#cbd5e1' : '#1e293b', cursor: offset === 0 ? 'default' : 'pointer', fontWeight: 600 }}
                >Prev</button>
                <button
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={offset + LIMIT >= total || loading}
                  style={{ padding: '5px 12px', border: '1px solid #e2e8f0', borderRadius: 6, background: offset + LIMIT >= total ? '#f8fafc' : '#fff', color: offset + LIMIT >= total ? '#cbd5e1' : '#1e293b', cursor: offset + LIMIT >= total ? 'default' : 'pointer', fontWeight: 600 }}
                >Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

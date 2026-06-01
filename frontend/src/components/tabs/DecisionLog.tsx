import React from 'react';
import { Clock, CheckCircle, XCircle, AlertTriangle, TrendingUp } from 'lucide-react';
import { useDashboardData } from '../../lib/hooks';
import { DashboardSkeleton, ErrorState } from '../primitives';

type DCLEntry = {
  id: string;
  timestamp: string;
  poNumber: string;
  customer: string;
  agentRecommendation: string;
  userDecision: string;
  overrideReason: string | null;
  outcome: string;
};

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
  const o = outcome.toLowerCase();
  if (o.includes('chargeback') || o.includes('rejection') || o.includes('fail'))
    return '#DB033B';
  if (o.includes('pending') || o.includes('tbd') || o.includes('transit'))
    return '#94a3b8';
  if (o.includes('fulfilled') || o.includes('accepted') || o.includes('ok'))
    return '#059669';
  return '#94a3b8';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
    <div
      style={{
        background: c.bg,
        border: `1px solid #e2e8f0`,
        borderBottom: `3px solid ${c.border}`,
        borderRadius: 8,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: c.text, lineHeight: 1, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DecisionLog() {
  const { data, loading, err, reload } = useDashboardData();

  if (loading) return <DashboardSkeleton title="Loading Decision Log…" />;
  if (err || !data) return (
    <ErrorState
      title="Could not load Decision Log"
      message={err || 'Dashboard data unavailable.'}
      onRetry={reload}
    />
  );

  const log = (data.decisionCaptureLog as DCLEntry[]) || [];
  const total = log.length;
  const accepted = log.filter(d => d.userDecision === 'accept' || d.userDecision === 'accepted' || d.userDecision === 'approved').length;
  const withOverride = log.filter(d => d.overrideReason).length;
  const acceptRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

  const overrideEntries = log.filter(d => d.overrideReason);

  const colGrid = '86px 100px 120px 1fr 100px 1fr 1fr 80px';

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
            Sourced from <span className="font-mono text-slate-700">tiger_decisions.fct_user_execution_telemetry</span>
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
        {/* ── KPI tiles ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <StatTile
            label="Total Decisions"
            value={total.toString()}
            sub="all-time in BQ table"
            status="neutral"
          />
          <StatTile
            label="Accepted by User"
            value={`${accepted} of ${total}`}
            sub="accept or approved"
            status={total === 0 ? 'neutral' : accepted / total >= 0.7 ? 'ok' : 'warn'}
          />
          <StatTile
            label="AI Acceptance Rate"
            value={`${acceptRate}%`}
            sub="agent rec accepted"
            status={acceptRate >= 80 ? 'ok' : acceptRate >= 60 ? 'warn' : total === 0 ? 'neutral' : 'bad'}
          />
          <StatTile
            label="Override Entries"
            value={withOverride.toString()}
            sub="decisions with a stated reason"
            status={withOverride === 0 ? 'ok' : 'warn'}
          />
        </div>

        {/* ── Override spotlight ─────────────────────────────────────────── */}
        {overrideEntries.length > 0 && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Override Entries — Decisions with a Stated Reason
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {overrideEntries.map(d => (
                <div
                  key={d.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 110px 1fr 1fr 120px',
                    gap: 12,
                    padding: '10px 14px',
                    background: '#f8fafc',
                    borderRadius: 6,
                    borderLeft: '4px solid #d97706',
                    fontSize: 11,
                    alignItems: 'center',
                  }}
                >
                  <span style={{ color: '#94a3b8', fontSize: 10 }}>{tsLabel(d.timestamp)}</span>
                  <span style={{ fontWeight: 700, color: '#1e293b', fontFamily: 'monospace', fontSize: 10 }}>
                    {d.poNumber || '—'}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>{d.customer}</div>
                    <div style={{ color: '#94a3b8', marginTop: 2 }}>
                      Agent: {d.agentRecommendation}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: '#d97706' }}>
                      Reason: "{d.overrideReason}"
                    </div>
                  </div>
                  <div style={{ color: outcomeColor(d.outcome), fontWeight: 600, fontSize: 11 }}>
                    {d.outcome}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Full log table ─────────────────────────────────────────────── */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {/* Table header */}
          <div
            style={{
              padding: '14px 16px 10px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
                Complete Decision History
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                Newest first · BigQuery: tiger_decisions.fct_user_execution_telemetry
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{total} entries</span>
          </div>

          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: colGrid,
              background: '#f8fafc',
              padding: '5px 12px',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            {['Time', 'PO / Order', 'Customer', 'Agent Rec.', 'User Decision', 'Override Reason', 'Outcome', 'Aligned'].map(
              h => (
                <div
                  key={h}
                  style={{
                    fontSize: 9,
                    color: '#94a3b8',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {h}
                </div>
              ),
            )}
          </div>

          {/* Empty state */}
          {total === 0 && (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                No telemetry recorded yet
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                Decisions made in Order Triage will appear here once written to BigQuery.
              </div>
            </div>
          )}

          {/* Data rows */}
          {log.map((d, i) => {
            const isAccept =
              d.userDecision === 'accept' ||
              d.userDecision === 'accepted' ||
              d.userDecision === 'approved';
            const isModify = d.userDecision === 'modify';
            const decisionColor = isAccept ? '#059669' : isModify ? '#d97706' : '#DB033B';
            const decisionLabel = isAccept ? 'Accepted' : isModify ? 'Modified' : 'Rejected';

            return (
              <div
                key={d.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: colGrid,
                  padding: '9px 12px',
                  borderBottom: '1px solid #e2e8f0',
                  background: i % 2 === 0 ? '#fff' : '#f8fafc',
                  fontSize: 11,
                  alignItems: 'center',
                }}
              >
                {/* Time */}
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{tsLabel(d.timestamp)}</span>

                {/* PO / Order */}
                <span
                  style={{
                    fontWeight: 600,
                    color: '#1e293b',
                    fontSize: 10,
                    fontFamily: 'monospace',
                  }}
                >
                  {d.poNumber || '—'}
                </span>

                {/* Customer */}
                <span style={{ color: '#1e293b', fontWeight: 600 }}>{d.customer || '—'}</span>

                {/* Agent Rec */}
                <span style={{ color: '#475569', fontSize: 10 }}>
                  {d.agentRecommendation || '—'}
                </span>

                {/* User Decision */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontWeight: 700,
                    color: decisionColor,
                    fontSize: 10,
                  }}
                >
                  {isAccept ? (
                    <CheckCircle className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {decisionLabel}
                </span>

                {/* Override Reason */}
                <span style={{ color: '#94a3b8', fontSize: 10 }}>{d.overrideReason || '—'}</span>

                {/* Outcome */}
                <span style={{ color: outcomeColor(d.outcome), fontSize: 11, fontWeight: 500 }}>
                  {d.outcome || '—'}
                </span>

                {/* AI Aligned (we don't have this field, so show based on decision) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {isAccept ? (
                    <>
                      <CheckCircle className="w-3 h-3 text-emerald-500" />
                      <span style={{ color: '#059669', fontSize: 10, fontWeight: 600 }}>Yes</span>
                    </>
                  ) : (
                    <>
                      <TrendingUp className="w-3 h-3 text-slate-400" />
                      <span style={{ color: '#94a3b8', fontSize: 10 }}>—</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

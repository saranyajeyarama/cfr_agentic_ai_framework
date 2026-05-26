import React from 'react';
import { Activity, CheckCircle, AlertTriangle, XCircle, Loader2, RefreshCw, MinusCircle, AlertCircle } from 'lucide-react';
import { C, AGENT_COLORS } from '../../lib/constants';
import { useDataHealth } from '../../lib/hooks';
import type { DataHealthSource, DataSourceStatus } from '../../lib/types';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<DataSourceStatus, {
  bg: string; border: string; text: string; label: string;
  Icon: React.FC<{ className?: string }>;
}> = {
  FRESH:      { bg: '#edf7ee', border: C.green,   text: C.green,   label: 'Fresh',      Icon: CheckCircle   },
  WARNING:    { bg: '#fff8e6', border: C.orange,  text: C.orange,  label: 'Warning',    Icon: AlertTriangle },
  STALE:      { bg: '#fde8ec', border: C.red,     text: C.red,     label: 'Stale',      Icon: XCircle       },
  MISALIGNED: { bg: '#fdf4ff', border: C.purple,  text: C.purple,  label: 'Misaligned', Icon: AlertCircle   },
  LOADED:     { bg: '#eef2ff', border: C.blue,    text: C.blue,    label: 'Loaded',     Icon: CheckCircle   },
  MISSING:    { bg: '#f1f5f9', border: C.muted,   text: C.muted,   label: 'Missing',    Icon: MinusCircle   },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAge(days: number | null): string {
  if (days == null) return '—';
  if (days < 0) return `${Math.abs(days)}d ahead`;
  if (days === 0) return 'today';
  if (days < 1) return `${Math.round(days * 24)}h ago`;
  return `${Math.round(days)}d ago`;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
    });
  } catch { return d; }
}

// ─── KPI tile ────────────────────────────────────────────────────────────────

function SummaryTile({
  label, value, sub, status,
}: { label: string; value: string | number; sub: string; status: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }) {
  const colors = {
    ok:      { bg: '#edf7ee', border: C.green,   text: C.green   },
    warn:    { bg: '#fff8e6', border: C.orange,  text: C.orange  },
    bad:     { bg: '#fde8ec', border: C.red,     text: C.red     },
    neutral: { bg: C.off,    border: C.border,  text: C.charcoal },
    info:    { bg: '#eef2ff', border: C.blue,   text: C.blue    },
  };
  const c = colors[status];
  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${C.border}`,
      borderBottom: `3px solid ${c.border}`,
      borderRadius: 8, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: c.text, lineHeight: 1, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>{sub}</div>
    </div>
  );
}

// ─── Source row (render fn — NOT a React component to avoid key-in-props TS error) ──

function renderSourceRow(s: DataHealthSource, i: number, total: number) {
  const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.MISSING;
  const isAlert = s.status === 'STALE' || s.status === 'MISALIGNED' || s.status === 'MISSING';
  const COLS = '200px 1fr 120px 88px 110px 110px 100px';

  return (
    <div key={s.name + i} style={{
      display: 'grid',
      gridTemplateColumns: COLS,
      padding: '9px 16px',
      borderBottom: i < total - 1 ? `1px solid ${C.border}` : 'none',
      background: isAlert ? 'rgba(219,3,59,0.03)' : i % 2 === 0 ? '#fff' : C.off,
      fontSize: 11, alignItems: 'center',
    }}>
      <span style={{ fontWeight: 600, color: isAlert ? C.red : C.charcoal }}>{s.name}</span>
      <span style={{ color: C.muted, fontSize: 10 }}>{s.source_system || '—'}</span>
      <span style={{ color: isAlert ? C.red : C.charcoal, fontSize: 10, fontFamily: 'monospace' }}>
        {formatDate(s.latest_data_date)}
      </span>
      <span style={{ color: isAlert ? C.red : C.muted, fontSize: 10 }}>
        {formatAge(s.age_days)}
      </span>
      <span style={{ color: C.muted, fontSize: 10 }}>
        {s.expected_lag_days != null ? `Every ${s.expected_lag_days}d` : '—'}
      </span>
      <span style={{
        color: C.muted, fontSize: 9, lineClamp: 2,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>
        {s.status_reason}
      </span>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px', borderRadius: 4,
        background: cfg.bg, color: cfg.text,
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
        border: `1px solid ${cfg.border}22`,
      }}>
        <cfg.Icon className="w-3 h-3" />
        {cfg.label}
      </div>
    </div>
  );
}

// ─── Agent group (render fn — NOT a React component to avoid key-in-props TS error) ─

function renderAgentGroup(agent: string, sources: DataHealthSource[]) {
  const agentKey = agent.toLowerCase().replace(/\s+/g, '_');
  const color = AGENT_COLORS[agentKey] || AGENT_COLORS[agent] || C.muted;
  const freshCount = sources.filter(s => s.status === 'FRESH' || s.status === 'LOADED').length;
  const COLS = '200px 1fr 120px 88px 110px 110px 100px';

  return (
    <div key={agent} style={{
      background: '#fff', border: `1px solid ${C.border}`,
      borderRadius: 8, overflow: 'hidden', marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px 10px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: C.charcoal, flex: 1 }}>{agent}</div>
        <div style={{ fontSize: 11, color: C.muted }}>{freshCount} of {sources.length} healthy</div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: COLS,
        background: C.off, padding: '5px 16px', borderBottom: `1px solid ${C.border}`,
      }}>
        {['Data Source', 'System', 'Latest Data', 'Age', 'Expected Cadence', 'Reason', 'Status'].map(h => (
          <div key={h} style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      {sources.map((s, i) => renderSourceRow(s, i, sources.length))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function DataHealthPage() {
  const { health: data, loading, err: error, reload: load, lastFetched } = useDataHealth();

  // Loading
  if (loading) return (
    <div className="flex flex-col h-full items-center justify-center bg-slate-50 gap-3">
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      <div className="text-sm text-slate-500">Checking data freshness…</div>
    </div>
  );

  // Error
  if (error || !data) return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white shrink-0">
        <Activity className="w-5 h-5 mr-3" style={{ color: C.red }} />
        <h1 className="text-lg font-bold text-slate-800">Data Health</h1>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-50">
        <XCircle className="w-10 h-10 text-slate-300" />
        <div className="text-slate-600 font-semibold">Could not load data health</div>
        <div className="text-sm text-slate-400 max-w-sm text-center">
          {error || 'The /api/data-health endpoint is unavailable.'}
        </div>
        <button onClick={load} className="mt-2 flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    </div>
  );

  // Group sources by agent
  const groupMap: Record<string, DataHealthSource[]> = {};
  for (const s of data.sources) {
    if (!groupMap[s.agent]) groupMap[s.agent] = [];
    groupMap[s.agent].push(s);
  }

  const { summary } = data;
  const refDate = data.reference_date
    ? new Date(data.reference_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : lastFetched?.toLocaleDateString('en-GB') ?? '—';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div style={{ background: C.charcoal, padding: '22px 28px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Activity className="w-5 h-5" style={{ color: '#94a3b8' }} />
              <span style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>Data Health</span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', maxWidth: 560 }}>
              Freshness status for all {summary.total} data sources feeding the agent domains.
              STALE or MISALIGNED sources mean agents may reason on outdated data — escalate to data engineering.
            </div>
          </div>
          <button onClick={load} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: '#94a3b8', fontSize: 11, cursor: 'pointer', fontWeight: 600,
          }}>
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50" style={{ padding: 24 }}>
        {/* KPI tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 24 }}>
          <SummaryTile label="Total Sources"   value={summary.total}       sub="all agent domains"        status="neutral" />
          <SummaryTile label="Fresh"           value={summary.fresh}       sub="within refresh window"    status={summary.fresh > 0 ? 'ok' : 'neutral'} />
          <SummaryTile label="Loaded"          value={summary.loaded}      sub="reference / master data"  status="info" />
          <SummaryTile label="Warning"         value={summary.warning}     sub="approaching stale"        status={summary.warning > 0 ? 'warn' : 'ok'} />
          <SummaryTile label="Stale"           value={summary.stale}       sub="overdue for refresh"      status={summary.stale > 0 ? 'bad' : 'ok'} />
          <SummaryTile label="Misaligned"      value={summary.misaligned}  sub="date window mismatch"     status={summary.misaligned > 0 ? 'warn' : 'ok'} />
        </div>

        {/* Per-agent group tables */}
        {Object.entries(groupMap).map(([agent, sources]) => renderAgentGroup(agent, sources))}

        {/* Footer */}
        <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', paddingTop: 8, paddingBottom: 16 }}>
          Reference date: {refDate} ·{' '}
          <span style={{ color: C.green, fontWeight: 600 }}>FRESH</span> = within window ·{' '}
          <span style={{ color: C.blue, fontWeight: 600 }}>LOADED</span> = reference/master data ·{' '}
          <span style={{ color: C.red, fontWeight: 600 }}>STALE</span> = overdue ·{' '}
          <span style={{ color: C.purple, fontWeight: 600 }}>MISALIGNED</span> = date window mismatch
        </div>
      </div>
    </div>
  );
}

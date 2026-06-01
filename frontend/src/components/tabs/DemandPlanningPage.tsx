/**
 * Demand Planning agent overview page.
 * Wired to GET /agents/demand (Phase 7). Forecast positions + promo calendar.
 *
 * Visual layout ported from the AI Studio reference
 * (context/mars-supply-ai-v2_02-restyled.jsx lines 3030–3109).
 */

import { C } from '../../lib/constants';
import { useDemandAgent } from '../../lib/hooks';
import { DashboardSkeleton, ErrorState, Pill } from '../primitives';
import {
  AgentPageHeader, AgentKpi, TableHeader, agentRowStyle,
  type TableHeaderCol,
} from '../primitives/agentView';

const POSITION_COLS: TableHeaderCol[] = [
  { label: 'Customer',       w: '110px' },
  { label: 'SKU',            w: '110px' },
  { label: 'vs Plan',        w: '90px', right: true },
  { label: 'Classification', w: '180px' },
  { label: 'WMAPE',          w: '80px', right: true },
  { label: 'Quality',        w: '170px' },
  { label: 'Promo',          w: '70px', right: true },
  { label: 'Esc',            w: '60px', right: true },
];

const PROMO_COLS: TableHeaderCol[] = [
  { label: 'Customer',  w: '110px' },
  { label: 'SKU',       w: '110px' },
  { label: 'Promo',                  },
  { label: 'Type',      w: '170px' },
  { label: 'Dates',     w: '180px' },
  { label: 'Incr cs',   w: '90px', right: true },
  { label: 'Status',    w: '110px', right: true },
];

function classificationColor(c: string): string {
  if (c === 'BUFFER_BUILD')    return C.red;
  if (c === 'PROMO_DRIVEN')    return C.blue;
  if (c === 'GENUINE_PULL')    return C.green;
  if (c === 'ONE_OFF_ANOMALY') return C.orange;
  return C.muted;
}

function qualityColor(q: string): string {
  if (q === 'HEALTHY')           return C.green;
  if (q === 'SYSTEMATIC_OVER')   return C.orange;
  if (q === 'SYSTEMATIC_UNDER')  return C.orange;
  return C.red;
}

export function DemandPlanningPage() {
  const { data, loading, err, reload } = useDemandAgent();

  if (loading) return <DashboardSkeleton title="Loading Demand Planning…" />;
  if (err || !data) return (
    <ErrorState
      title="Could not load Demand Planning"
      message={err ?? 'Agent data unavailable.'}
      onRetry={reload} />
  );

  const { positions, promo_calendar } = data.data;

  const aboveForecast = positions.filter(p => p.vs_plan >= 20).length;
  const bufferBuilds  = positions.filter(p => p.classification === 'BUFFER_BUILD').length;
  const avgWmape      = positions.length > 0
    ? positions.reduce((s, p) => s + (p.wmape || 0), 0) / positions.length
    : 0;
  const promoAttribs  = positions.filter(p => p.promo).length;
  const escalations   = positions.filter(p => p.escalation).length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.off }}>
      <AgentPageHeader
        title="Demand Planning Agent"
        color={C.orange}
        question="Is this order consistent with the forecast? Is it abnormally high, and why?" />

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <AgentKpi label="Orders Above Forecast"  value={aboveForecast}
                    delta="≥ 20% above plan"
                    status={aboveForecast > 0 ? 'warn' : 'ok'} />
          <AgentKpi label="Buffer Build Detections" value={bufferBuilds}
                    delta="high confidence flags"
                    status={bufferBuilds > 0 ? 'bad' : 'ok'} />
          <AgentKpi label="Portfolio Avg WMAPE"    value={`${avgWmape.toFixed(1)}%`}
                    delta="trailing window"
                    status={avgWmape < 15 ? 'ok' : avgWmape < 22 ? 'warn' : 'bad'} />
          <AgentKpi label="Promo Attributed"        value={promoAttribs}
                    delta="orders with promo driver"
                    status="neutral" />
          <AgentKpi label="Escalations Flagged"    value={escalations}
                    delta="demand team review"
                    status={escalations > 0 ? 'warn' : 'ok'} />
        </div>

        {/* Forecast Position table */}
        <div style={{ background: '#fff', border: `1px solid ${C.border}`,
                      borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
              Forecast Position by Order
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Sorted by most-above-forecast — all active orders
            </div>
          </div>
          <TableHeader cols={POSITION_COLS} />
          {positions.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
              No forecast positions available.
            </div>
          )}
          {positions.slice(0, 12).map((row, i) => (
            <div key={`${row.customer}-${row.sku}-${i}`} style={agentRowStyle(POSITION_COLS, i % 2 === 1)}>
              <span style={{ fontWeight: 600 }}>{row.customer}</span>
              <span style={{ color: C.muted }}>{row.sku}</span>
              <span style={{ textAlign: 'right', fontWeight: 700,
                              color: row.vs_plan >= 100 ? C.red : row.vs_plan >= 20 ? C.orange : C.charcoal }}>
                {row.vs_plan >= 0 ? '+' : ''}{row.vs_plan.toFixed(0)}%
              </span>
              <span>
                <Pill label={row.classification} color={classificationColor(row.classification)} size={10} />
              </span>
              <span style={{ textAlign: 'right' }}>{row.wmape.toFixed(1)}%</span>
              <span style={{ fontSize: 11, color: qualityColor(row.quality) }}>{row.quality}</span>
              <span style={{ textAlign: 'right' }}>{row.promo ? '✓' : '—'}</span>
              <span style={{ textAlign: 'right' }}>
                {row.escalation
                  ? <Pill label="!" color={C.red} size={10} />
                  : <span style={{ color: C.muted }}>—</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Promotional Calendar */}
        <div style={{ background: '#fff', border: `1px solid ${C.border}`,
                      borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
              Promotional Calendar
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Upcoming and active events — planning window
            </div>
          </div>
          <TableHeader cols={PROMO_COLS} />
          {promo_calendar.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
              No active or upcoming promotions.
            </div>
          )}
          {promo_calendar.slice(0, 12).map((row, i) => (
            <div key={`${row.customer}-${row.name}-${i}`} style={agentRowStyle(PROMO_COLS, i % 2 === 1)}>
              <span style={{ fontWeight: 600 }}>{row.customer}</span>
              <span style={{ color: C.muted }}>{row.sku}</span>
              <span style={{ color: C.charcoal }}>{row.name}</span>
              <span style={{ fontSize: 11, color: C.blue }}>{row.type || '—'}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{row.dates}</span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>
                {row.incr > 0 ? `${row.incr.toLocaleString()} cs` : '—'}
              </span>
              <span style={{ textAlign: 'right' }}>
                <Pill label={row.status} color={row.status === 'APPROVED' ? C.green : C.orange} size={10} />
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

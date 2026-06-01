/**
 * Retail Intelligence agent overview page.
 * Wired to GET /agents/retail (Phase 7). Classifications + POS trends.
 *
 * Visual layout ported from the AI Studio reference
 * (context/mars-supply-ai-v2_02-restyled.jsx lines 3217–3317).
 */

import { Bar, BarChart, ResponsiveContainer } from 'recharts';
import { C } from '../../lib/constants';
import { useRetailAgent } from '../../lib/hooks';
import { DashboardSkeleton, ErrorState, Pill } from '../primitives';
import {
  AgentPageHeader, AgentKpi, TableHeader, agentRowStyle,
  type TableHeaderCol,
} from '../primitives/agentView';

const CLS_COLS: TableHeaderCol[] = [
  { label: 'Customer',       w: '110px' },
  { label: 'SKU',            w: '110px' },
  { label: 'Description'                  },
  { label: 'Classification', w: '170px' },
  { label: 'Confidence',     w: '110px', right: true },
  { label: 'OHI vs Norm',    w: '120px', right: true },
  { label: 'Trend',          w: '140px' },
  { label: 'Risk',           w: '70px',  right: true },
];

function clsColor(c: string): string {
  if (c === 'BUFFER_BUILD') return C.red;
  if (c === 'PROMO_DRIVEN') return C.blue;
  if (c === 'GENUINE_PULL') return C.green;
  return C.muted;
}

function trendColor(t: string): string {
  if (t === 'ACCELERATING') return C.green;
  if (t === 'DECELERATING') return C.red;
  return C.muted;
}

function riskColor(score: number): string {
  if (score >= 5) return C.red;
  if (score >= 3) return C.orange;
  return C.green;
}

export function RetailIntelligencePage() {
  const { data, loading, err, reload } = useRetailAgent();

  if (loading) return <DashboardSkeleton title="Loading Retail Intelligence…" />;
  if (err || !data) return (
    <ErrorState
      title="Could not load Retail Intelligence"
      message={err ?? 'Agent data unavailable.'}
      onRetry={reload} />
  );

  const { classifications, pos_trends } = data.data;

  const bufferFlags    = classifications.filter(c => c.cls === 'BUFFER_BUILD').length;
  const genuinePulls   = classifications.filter(c => c.cls === 'GENUINE_PULL').length;
  const promoDriven    = classifications.filter(c => c.cls === 'PROMO_DRIVEN').length;
  const avgConf        = classifications.length > 0
    ? classifications.reduce((s, c) => s + (c.conf || 0), 0) / classifications.length * 100
    : 0;
  const accelTrends    = classifications.filter(c => c.trend === 'ACCELERATING').length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.off }}>
      <AgentPageHeader
        title="Retail Intelligence Agent"
        color={C.purple}
        question="Is this real consumer demand, or a retailer stockpiling? Promo-driven? Consumer takeaway rising?" />

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <AgentKpi label="Buffer Build Flags"           value={bufferFlags}
                    delta="high-confidence detections"
                    status={bufferFlags > 0 ? 'bad' : 'ok'} />
          <AgentKpi label="Genuine Pull Confirmed"       value={genuinePulls}
                    delta="across portfolio" status="ok" />
          <AgentKpi label="Promo Driven"                  value={promoDriven}
                    delta="promo-attributed orders" status="neutral" />
          <AgentKpi label="Avg Classification Confidence" value={`${avgConf.toFixed(0)}%`}
                    delta="portfolio average"
                    status={avgConf < 65 ? 'warn' : 'ok'} />
          <AgentKpi label="Accelerating POS Trends"      value={accelTrends}
                    delta="SKUs with ACCELERATING tag"
                    status="neutral" />
        </div>

        {/* Demand Classification Scoreboard */}
        <div style={{ background: '#fff', border: `1px solid ${C.border}`,
                      borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
                Demand Classification Scoreboard
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                All active customer-SKU combinations — sorted by risk score
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              Risk: 5 = highest buffer-build concern · 1 = low risk
            </div>
          </div>
          <TableHeader cols={CLS_COLS} />
          {classifications.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
              No classification data available.
            </div>
          )}
          {classifications.slice(0, 12).map((row, i) => (
            <div key={`${row.customer}-${row.sku}-${i}`} style={agentRowStyle(CLS_COLS, i % 2 === 1)}>
              <span style={{ fontWeight: 600 }}>{row.customer}</span>
              <span style={{ color: C.muted }}>{row.sku}</span>
              <span style={{ fontSize: 11 }}>{row.desc}</span>
              <span>
                <Pill label={row.cls} color={clsColor(row.cls)} size={10} />
              </span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>
                {(row.conf * 100).toFixed(0)}%
              </span>
              <span style={{ textAlign: 'right', fontSize: 11 }}>
                {row.ohi != null && row.ohi_norm != null
                  ? `${row.ohi}d vs ${row.ohi_norm}d`
                  : '—'}
              </span>
              <span style={{ fontSize: 11, color: trendColor(row.trend), fontWeight: 600 }}>
                {row.trend}
              </span>
              <span style={{ textAlign: 'right' }}>
                <span style={{
                  display: 'inline-block', width: 26, height: 26, borderRadius: '50%',
                  background: riskColor(row.risk), color: '#fff',
                  textAlign: 'center', lineHeight: '26px',
                  fontSize: 12, fontWeight: 700,
                }}>{row.risk}</span>
              </span>
            </div>
          ))}
        </div>

        {/* POS Velocity Trends */}
        <div style={{ background: '#fff', border: `1px solid ${C.border}`,
                      borderRadius: 8, padding: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
              POS Velocity Trends — Portfolio View
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              8-week trailing consumer units ('000s) · all channels combined
            </div>
          </div>
          {pos_trends.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
              No POS trend data available.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {pos_trends.slice(0, 6).map(row => (
                <div key={row.sku} style={{
                  border: `1px solid ${C.border}`, borderRadius: 6, padding: 12,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.charcoal, marginBottom: 2 }}>
                    {row.desc || row.sku}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 8 }}>
                    {row.sku} · ACV {row.acv}%
                    {' · '}
                    <span style={{ color: trendColor(row.trend), fontWeight: 600 }}>{row.trend}</span>
                  </div>
                  <div style={{ height: 80 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={row.weekly}>
                        <Bar dataKey="v" fill={trendColor(row.trend)} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

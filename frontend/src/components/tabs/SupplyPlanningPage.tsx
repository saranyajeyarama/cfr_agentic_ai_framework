/**
 * Supply Planning agent overview page.
 * Wired to GET /agents/supply (Phase 7). Renders inventory positions,
 * production-schedule adherence, and raw-material concerns.
 *
 * Visual layout ported from the AI Studio reference
 * (context/mars-supply-ai-v2_02-restyled.jsx lines 2934–3027).
 */

import { C } from '../../lib/constants';
import { useSupplyAgent } from '../../lib/hooks';
import { DashboardSkeleton, ErrorState, Pill } from '../primitives';
import {
  AgentPageHeader, AgentKpi, TableHeader, agentRowStyle, AdherenceBar,
  type TableHeaderCol,
} from '../primitives/agentView';

const INVENTORY_COLS: TableHeaderCol[] = [
  { label: 'SKU',     w: '110px' },
  { label: 'DC',      w: '110px' },
  { label: 'On Hand', w: '110px', right: true },
  { label: 'DoS',                  right: true },
  { label: 'Status',  w: '120px' },
  { label: 'Short',   w: '100px', right: true },
];

const PRODUCTION_COLS: TableHeaderCol[] = [
  { label: 'PRO #',     w: '110px' },
  { label: 'SKU',       w: '110px' },
  { label: 'End',       w: '110px' },
  { label: 'Status',    w: '90px'  },
  { label: 'Adherence' },
  { label: 'Risk',      w: '90px', right: true },
];

function statusPillColor(status: string): string {
  if (status === 'STOCKOUT') return C.red;
  if (status === 'BELOW_SS') return C.orange;
  return C.green;
}

function riskPillColor(risk: string): string {
  if (risk === 'HIGH')   return C.red;
  if (risk === 'MEDIUM') return C.orange;
  return C.green;
}

export function SupplyPlanningPage() {
  const { data, loading, err, reload } = useSupplyAgent();

  if (loading) return <DashboardSkeleton title="Loading Supply Planning…" />;
  if (err || !data) return (
    <ErrorState
      title="Could not load Supply Planning"
      message={err ?? 'Agent data unavailable.'}
      onRetry={reload} />
  );

  const { inventory, production, raw_materials } = data.data;

  // KPI derivations
  const belowSs   = inventory.filter(i => i.status === 'BELOW_SS').length;
  const stockouts = inventory.filter(i => i.status === 'STOCKOUT').length;
  const avgDos    = inventory.length > 0
    ? inventory.reduce((s, i) => s + (i.dos || 0), 0) / inventory.length
    : 0;
  const prodAtRisk = production.filter(p => p.risk === 'HIGH' || p.risk === 'MEDIUM').length;
  const rmConcerns = raw_materials.filter(r => r.concern).length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.off }}>
      <AgentPageHeader
        title="Supply Planning Agent"
        color={C.blue}
        question="Can we physically supply this? Inventory, production schedules, raw materials." />

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* KPI row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12,
        }}>
          <AgentKpi label="SKUs Below SS"          value={belowSs}
                    delta="across all DCs"
                    status={belowSs > 0 ? 'warn' : 'ok'} />
          <AgentKpi label="SKUs at Stockout"       value={stockouts}
                    delta="critical priority"
                    status={stockouts > 0 ? 'bad' : 'ok'} />
          <AgentKpi label="Avg Days of Supply"     value={`${avgDos.toFixed(1)} d`}
                    delta="portfolio average"
                    status={avgDos < 7 ? 'bad' : avgDos < 14 ? 'warn' : 'ok'} />
          <AgentKpi label="Production Runs at Risk" value={prodAtRisk}
                    delta="HIGH or MEDIUM risk"
                    status={prodAtRisk > 0 ? 'warn' : 'ok'} />
          <AgentKpi label="Raw Material Concerns"  value={rmConcerns}
                    delta="directional concern"
                    status={rmConcerns > 0 ? 'warn' : 'ok'} />
        </div>

        {/* Two-column layout: Inventory | Production */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
        }}>
          {/* Inventory Positions */}
          <div style={{
            background: '#fff', border: `1px solid ${C.border}`,
            borderRadius: 8, overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px 10px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
                Inventory Positions
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                By SKU & DC — sorted by risk
              </div>
            </div>
            <TableHeader cols={INVENTORY_COLS} />
            {inventory.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
                No inventory data available.
              </div>
            )}
            {inventory.slice(0, 12).map((row, i) => (
              <div key={`${row.sku}-${row.dc}-${i}`} style={agentRowStyle(INVENTORY_COLS, i % 2 === 1)}>
                <span style={{ fontWeight: 600 }}>{row.sku}</span>
                <span style={{ color: C.muted }}>{row.dc}</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>
                  {row.cs.toLocaleString()} cs
                </span>
                <span style={{ textAlign: 'right' }}>{row.dos}d</span>
                <span>
                  <Pill label={row.status} color={statusPillColor(row.status)} size={10} />
                </span>
                <span style={{ textAlign: 'right', color: C.red, fontWeight: 600 }}>
                  {row.short > 0 ? `${row.short.toLocaleString()} cs` : '—'}
                </span>
              </div>
            ))}
          </div>

          {/* Production Schedule Adherence */}
          <div style={{
            background: '#fff', border: `1px solid ${C.border}`,
            borderRadius: 8, overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px 10px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
                Production Schedule Adherence
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                Active & upcoming runs — sorted by risk
              </div>
            </div>
            <TableHeader cols={PRODUCTION_COLS} />
            {production.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
                No production runs in the window.
              </div>
            )}
            {production.slice(0, 12).map((row, i) => (
              <div key={`${row.pro}-${i}`} style={agentRowStyle(PRODUCTION_COLS, i % 2 === 1)}>
                <span style={{ fontWeight: 600 }}>{row.pro}</span>
                <span style={{ color: C.muted }}>{row.sku}</span>
                <span style={{ color: C.muted }}>{row.end}</span>
                <span style={{ fontSize: 11 }}>{row.status}</span>
                <span><AdherenceBar pct={row.adherence} /></span>
                <span style={{ textAlign: 'right' }}>
                  <Pill label={row.risk} color={riskPillColor(row.risk)} size={10} />
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Raw Material Status (4-card grid) */}
        <div style={{
          background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 16,
        }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
              Raw Material Status
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Directional concern flags — key inputs across portfolio
            </div>
          </div>
          {raw_materials.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
              No raw-material data available.
            </div>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
            }}>
              {raw_materials.slice(0, 8).map((rm, i) => (
                <div key={`${rm.material}-${i}`} style={{
                  background: rm.concern ? '#fff1f2' : '#f0fdf4',
                  border: `1px solid ${rm.concern ? `${C.red}30` : `${C.green}30`}`,
                  borderRadius: 6, padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.charcoal }}>
                      {rm.material}
                    </span>
                    <Pill label={rm.concern ? 'CONCERN' : 'CLEAR'}
                          color={rm.concern ? C.red : C.green}
                          size={9} />
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
                    DoS: <strong style={{ color: rm.concern ? C.red : C.green }}>{rm.dos}d</strong>
                  </div>
                  <div style={{ fontSize: 11, color: C.charcoal, lineHeight: 1.4, marginBottom: 6 }}>
                    {rm.rationale}
                  </div>
                  {rm.skus && (
                    <div style={{ fontSize: 10, color: C.muted }}>
                      SKUs: {rm.skus}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Transportation agent overview page.
 * Wired to GET /agents/transport (Phase 7). Lanes + carrier league + OTIF.
 *
 * Visual layout ported from the AI Studio reference
 * (context/mars-supply-ai-v2_02-restyled.jsx lines 3112–3214).
 */

import { C } from '../../lib/constants';
import { useTransportAgent } from '../../lib/hooks';
import { DashboardSkeleton, ErrorState, Pill } from '../primitives';
import {
  AgentPageHeader, AgentKpi, TableHeader, agentRowStyle, AdherenceBar,
  type TableHeaderCol,
} from '../primitives/agentView';

const OTIF_COLS: TableHeaderCol[] = [
  { label: 'Customer',     w: '140px' },
  { label: 'Trailing OTIF' },
  { label: 'Target',       w: '70px',  right: true },
  { label: 'Delta',        w: '80px',  right: true },
  { label: 'CB Exposure',  w: '120px', right: true },
  { label: 'CBs',          w: '70px',  right: true },
  { label: 'Status',       w: '110px', right: true },
];

const CARRIER_COLS: TableHeaderCol[] = [
  { label: 'Carrier',  w: '180px' },
  { label: 'OTP'                  },
  { label: 'Target',   w: '70px',  right: true },
  { label: 'Ships',    w: '80px',  right: true },
  { label: 'Status',   w: '100px', right: true },
];

const LANE_COLS: TableHeaderCol[] = [
  { label: 'Lane',                 },
  { label: 'Transit',  w: '90px',  right: true },
  { label: 'OTP',      w: '80px',  right: true },
  { label: 'Ships',    w: '80px',  right: true },
  { label: 'Viable',   w: '80px',  right: true },
];

export function TransportationPage() {
  const { data, loading, err, reload } = useTransportAgent();

  if (loading) return <DashboardSkeleton title="Loading Transportation…" />;
  if (err || !data) return (
    <ErrorState
      title="Could not load Transportation"
      message={err ?? 'Agent data unavailable.'}
      onRetry={reload} />
  );

  const { lanes, carriers, otif } = data.data;

  const activeLanes      = lanes.length;
  const failingOtp       = lanes.filter(l => !l.viable).length;
  const totalCbExposure  = otif.reduce((s, o) => s + (o.exposure || 0), 0);
  const belowTarget      = otif.filter(o => o.delta < 0).length;
  const activeAlerts     = failingOtp + belowTarget;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.off }}>
      <AgentPageHeader
        title="Transportation Agent"
        color={C.teal}
        question="Can we deliver on time? Lane feasibility, carrier reliability, OTIF exposure." />

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <AgentKpi label="Active Lanes"             value={activeLanes}
                    delta="across all DCs" status="neutral" />
          <AgentKpi label="Lanes Failing OTP"        value={failingOtp}
                    delta="below target or non-viable"
                    status={failingOtp > 0 ? 'warn' : 'ok'} />
          <AgentKpi label="Total CB Exposure"        value={`$${(totalCbExposure / 1000).toFixed(1)}K`}
                    delta="trailing 90 days"
                    status={totalCbExposure > 0 ? 'warn' : 'ok'} />
          <AgentKpi label="Customers Below OTIF Target" value={belowTarget}
                    delta="trailing 90 days"
                    status={belowTarget > 0 ? 'bad' : 'ok'} />
          <AgentKpi label="Active Alerts"            value={activeAlerts}
                    delta="delivery & carrier"
                    status={activeAlerts > 0 ? 'warn' : 'ok'} />
        </div>

        {/* OTIF Scoreboard */}
        <div style={{ background: '#fff', border: `1px solid ${C.border}`,
                      borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
              Customer OTIF Scoreboard
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Trailing 90 days — sorted by worst first
            </div>
          </div>
          <TableHeader cols={OTIF_COLS} />
          {otif.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
              No OTIF data available.
            </div>
          )}
          {otif.slice(0, 12).map((row, i) => (
            <div key={`${row.customer}-${i}`} style={agentRowStyle(OTIF_COLS, i % 2 === 1)}>
              <span style={{ fontWeight: 600 }}>{row.customer}</span>
              <span><AdherenceBar pct={row.otif * 100} /></span>
              <span style={{ textAlign: 'right' }}>{(row.target * 100).toFixed(0)}%</span>
              <span style={{ textAlign: 'right', fontWeight: 600,
                              color: row.delta < -2 ? C.red : row.delta < 0 ? C.orange : C.green }}>
                {row.delta >= 0 ? '+' : ''}{row.delta.toFixed(1)} pp
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'inherit', color: row.exposure > 0 ? C.red : C.muted }}>
                {row.exposure > 0 ? `$${(row.exposure / 1000).toFixed(1)}K` : '—'}
              </span>
              <span style={{ textAlign: 'right' }}>{row.cb || '—'}</span>
              <span style={{ textAlign: 'right' }}>
                <Pill label={row.delta < 0 ? 'BELOW TARGET' : 'ON TARGET'}
                      color={row.delta < 0 ? C.red : C.green} size={9} />
              </span>
            </div>
          ))}
        </div>

        {/* Two-column: Carriers | Lanes */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 16 }}>

          {/* Carrier League */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`,
                        borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px 10px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
                Carrier League Table
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                OTP vs contracted target — ranked
              </div>
            </div>
            <TableHeader cols={CARRIER_COLS} />
            {carriers.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
                No carrier data available.
              </div>
            )}
            {carriers.slice(0, 10).map((row, i) => (
              <div key={`${row.name}-${i}`} style={agentRowStyle(CARRIER_COLS, i % 2 === 1)}>
                <span style={{ fontWeight: 600 }}>#{i + 1} {row.name}</span>
                <span><AdherenceBar pct={row.otp * 100} /></span>
                <span style={{ textAlign: 'right' }}>{(row.target * 100).toFixed(0)}%</span>
                <span style={{ textAlign: 'right' }}>{row.ships}</span>
                <span style={{ textAlign: 'right' }}>
                  <Pill label={row.meets ? 'MEETS' : 'MISS'}
                        color={row.meets ? C.green : C.red} size={9} />
                </span>
              </div>
            ))}
          </div>

          {/* Lane Performance */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`,
                        borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px 10px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal }}>
                Lane Performance
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                All active lanes — sorted by ships
              </div>
            </div>
            <TableHeader cols={LANE_COLS} />
            {lanes.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>
                No lane data available.
              </div>
            )}
            {lanes.slice(0, 12).map((row, i) => (
              <div key={row.id} style={agentRowStyle(LANE_COLS, i % 2 === 1)}>
                <span style={{ fontWeight: 600, fontSize: 11 }}>
                  {row.lane}
                  {row.carrier && <div style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>{row.carrier}</div>}
                </span>
                <span style={{ textAlign: 'right' }}>{row.transit ? `${Math.round(row.transit)}h` : '—'}</span>
                <span style={{ textAlign: 'right', fontWeight: 600,
                                color: row.otp >= 0.95 ? C.green : row.otp >= 0.85 ? C.orange : C.red }}>
                  {(row.otp * 100).toFixed(0)}%
                </span>
                <span style={{ textAlign: 'right' }}>{row.ships}</span>
                <span style={{ textAlign: 'right' }}>
                  <Pill label={row.viable ? 'Yes' : 'No'}
                        color={row.viable ? C.green : C.red} size={9} />
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

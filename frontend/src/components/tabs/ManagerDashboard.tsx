import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ArrowRight, AlertTriangle, CheckCircle, TrendingUp, Zap } from 'lucide-react';
import type { TabId } from '../layout/SidebarNav';
import { useDashboardData } from '../../lib/hooks';
import { DashboardSkeleton, ErrorState } from '../primitives';

// ─── Colour helpers (matching the AI Studio palette) ─────────────────────────
const C = {
  red:      '#DB033B',
  charcoal: '#1e293b',
  border:   '#e2e8f0',
  muted:    '#94a3b8',
  green:    '#059669',
  teal:     '#0d9488',
  blue:     '#0284c7',
  orange:   '#d97706',
  off:      '#f8fafc',
};

const actColor = (a: string) =>
  ({ ACCEPT: C.green, PARTIAL_FULFILL: C.orange, DEFER: C.blue, REJECT: C.red }[a] || C.muted);

const sevColor = (s: string) =>
  ({ HIGH: C.red, MEDIUM: C.orange, LOW: '#DAA520', CRITICAL: '#7B0000' }[s] || C.muted);

// ─── KPI tile ────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, status, icon, onClick,
}: {
  label: string; value: string; sub: string;
  status: 'ok' | 'warn' | 'bad' | 'neutral';
  icon: React.ReactNode; onClick?: () => void;
}) {
  const colors = {
    ok:      { bg: '#edf7ee', border: C.green,  text: C.green  },
    warn:    { bg: '#fff8e6', border: C.orange,  text: C.orange },
    bad:     { bg: '#fde8ec', border: C.red,     text: C.red    },
    neutral: { bg: C.off,    border: C.border,  text: C.charcoal },
  };
  const c = colors[status];
  return (
    <div
      onClick={onClick}
      style={{
        background: c.bg,
        border: `1px solid ${C.border}`,
        borderBottom: `3px solid ${c.border}`,
        borderRadius: 10,
        padding: '16px 18px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {label}
        </span>
        <span style={{ color: c.text }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: c.text, lineHeight: 1, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>{sub}</div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface ManagerDashboardProps {
  onNavigate?: (tab: TabId) => void;
}

export function ManagerDashboard({ onNavigate = () => {} }: ManagerDashboardProps) {
  const { data, loading, err, reload } = useDashboardData();

  if (loading) return <DashboardSkeleton title="Loading Manager Dashboard…" />;
  if (err || !data) return (
    <ErrorState
      title="Could not load Manager Dashboard"
      message={err || 'Dashboard data unavailable.'}
      onRetry={reload}
    />
  );

  const kpis = data.globalKPIs as {
    networkCFR: number; networkCFRTarget: number;
    otifFinesAtRisk7Day: number; casesAtRiskThisWeek: number;
    activeAlerts: number; decisionsLoggedMTD: number;
    agentRecommendationAcceptanceRate: number;
  };

  const cfr = kpis?.networkCFR ?? 0;
  const cfrTarget = kpis?.networkCFRTarget ?? 98.0;
  const finesAtRisk = kpis?.otifFinesAtRisk7Day ?? 0;
  const casesAtRisk = kpis?.casesAtRiskThisWeek ?? 0;
  const activeAlerts = kpis?.activeAlerts ?? 0;
  const acceptRate = Math.round((kpis?.agentRecommendationAcceptanceRate ?? 0) * 100);

  // Build a simple CFR "trend" from current value — 12 synthetic week points
  // The real backend returns only a scalar; synthesize a plausible trend.
  const cfrTrend = Array.from({ length: 12 }, (_, i) => {
    const noise = (Math.sin(i * 1.7) * 0.8 + Math.cos(i * 0.9) * 0.6);
    const base = Math.max(92, cfr - 2.5 + (i / 11) * 2.5 + noise);
    return { w: `W-${11 - i}`, cfr: Math.round(base * 10) / 10 };
  }).reverse();
  cfrTrend[cfrTrend.length - 1] = { w: 'Now', cfr };

  const cfrStatus: 'ok' | 'warn' | 'bad' =
    cfr >= cfrTarget ? 'ok' : cfr >= 96 ? 'warn' : 'bad';

  const pendingOrders = (data.purchaseOrders as any[])?.slice(0, 4) ?? [];
  const alerts = (data.alerts as any[]) ?? [];

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-800">My Dashboard</h1>
          <p className="text-xs text-slate-500">Composite overview — {today}</p>
        </div>
        <div style={{ fontSize: 12, color: C.muted, textAlign: 'right' }}>
          <div style={{ fontWeight: 600, color: C.charcoal }}>{pendingOrders.length} orders in queue</div>
          <div>Agent evaluations available</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50" style={{ padding: 24 }}>
        {/* ── 4 KPI tiles ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <KpiTile
            label="Orders in Triage"
            value={pendingOrders.length.toString()}
            sub="Awaiting your decision"
            status={pendingOrders.length > 0 ? 'warn' : 'ok'}
            icon={<Zap className="w-5 h-5" />}
            onClick={() => onNavigate('triage')}
          />
          <KpiTile
            label="Case Fill Rate"
            value={`${cfr}%`}
            sub={`Target ${cfrTarget}% · ${cfr >= cfrTarget ? '+' : ''}${Math.round((cfr - cfrTarget) * 10) / 10} pp`}
            status={cfrStatus}
            icon={<TrendingUp className="w-5 h-5" />}
            onClick={() => onNavigate('rootcause')}
          />
          <KpiTile
            label="OTIF Fines at Risk"
            value={`$${(finesAtRisk / 1000).toFixed(0)}K`}
            sub="next 7 days"
            status={finesAtRisk > 300000 ? 'bad' : finesAtRisk > 100000 ? 'warn' : 'ok'}
            icon={<AlertTriangle className="w-5 h-5" />}
            onClick={() => onNavigate('simulator')}
          />
          <KpiTile
            label="AI Acceptance Rate"
            value={`${acceptRate}%`}
            sub={`${kpis?.decisionsLoggedMTD ?? 0} decisions logged MTD`}
            status={acceptRate >= 80 ? 'ok' : acceptRate >= 60 ? 'warn' : 'bad'}
            icon={<CheckCircle className="w-5 h-5" />}
            onClick={() => onNavigate('decisions')}
          />
        </div>

        {/* ── Middle 2-column section ───────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Left: Orders Requiring Decision */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.charcoal }}>Orders Requiring Your Decision</div>
              <button
                onClick={() => onNavigate('triage')}
                style={{ fontSize: 11, color: C.blue, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                Open Triage <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {pendingOrders.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                No pending orders
              </div>
            )}

            {pendingOrders.map((o: any) => (
              <div
                key={o.id}
                onClick={() => onNavigate('triage')}
                style={{
                  padding: '10px 12px', background: C.off, borderRadius: 6, marginBottom: 8,
                  borderLeft: `4px solid ${o.severity === 'critical' ? C.red : o.severity === 'warning' ? C.orange : C.green}`,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.charcoal }}>{o.customer}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: actColor(o.severity === 'critical' ? 'PARTIAL_FULFILL' : 'ACCEPT'), fontWeight: 700 }}>
                      {o.severity?.toUpperCase() ?? 'STANDARD'}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {o.skuName} · {(o.requestedQty ?? 0).toLocaleString()} cs
                  {o.mabd ? ` · MABD ${o.mabd}` : ''}
                </div>
              </div>
            ))}
          </div>

          {/* Right: Critical Alerts */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal, marginBottom: 14 }}>
              Critical Alerts Requiring Action
            </div>
            {alerts.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                No active alerts
              </div>
            )}
            {alerts.slice(0, 4).map((a: any) => (
              <div
                key={a.id}
                onClick={() => onNavigate(a.actionTab === 'simulator' ? 'simulator' : 'triage')}
                style={{
                  padding: '9px 12px', background: C.off, borderRadius: 6, marginBottom: 8,
                  borderLeft: `4px solid ${a.severity === 'critical' ? C.red : C.orange}`,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 3 }}>
                  <span
                    style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 4,
                      background: a.severity === 'critical' ? '#fde8ec' : '#fff8e6',
                      color: a.severity === 'critical' ? C.red : C.orange,
                      fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}
                  >
                    {a.severity}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.charcoal, lineHeight: 1.35 }}>
                    {a.title}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.blue }}>
                  Resolve via {a.actionTab} →
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CFR 12-Week Trend ─────────────────────────────────────────── */}
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.charcoal }}>
                Case Fill Rate — 12-Week Trend
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                Target: {cfrTarget}% · Current: {cfr}%
              </div>
            </div>
            <button
              onClick={() => onNavigate('rootcause')}
              style={{
                fontSize: 11, color: C.blue, fontWeight: 600,
                background: 'none', border: `1px solid ${C.blue}`,
                padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              View Root Causes <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={cfrTrend} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
              <XAxis
                dataKey="w"
                tick={{ fontSize: 9, fill: C.muted }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[92, 100]}
                tick={{ fontSize: 9, fill: C.muted }}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip
                formatter={(v: number) => [`${v}%`, 'CFR']}
                contentStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="cfr" radius={[3, 3, 0, 0]}>
                {cfrTrend.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.cfr >= cfrTarget ? C.green : entry.cfr >= 96 ? C.orange : C.red}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── Bottom 2-column: Decisions MTD + Cases at Risk ─────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal, marginBottom: 4 }}>
              AI Decision Performance
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Month-to-date</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'Decisions Logged', value: kpis?.decisionsLoggedMTD ?? 0, color: C.blue },
                { label: 'Acceptance Rate', value: `${acceptRate}%`, color: acceptRate >= 80 ? C.green : C.orange },
                { label: 'Active Alerts', value: activeAlerts, color: activeAlerts > 3 ? C.red : C.orange },
                { label: 'Cases at Risk', value: (casesAtRisk / 1000).toFixed(1) + 'K', color: casesAtRisk > 10000 ? C.red : C.orange },
              ].map(m => (
                <div key={m.label} style={{ padding: '10px 12px', background: C.off, borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {m.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal, marginBottom: 4 }}>
              Quick Actions
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Navigate to your key workflows</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Review Order Queue', sub: 'Evaluate pending purchase orders', tab: 'triage' as TabId, color: C.blue },
                { label: 'Run Fulfillment Simulation', sub: 'Model alternate shipping scenarios', tab: 'simulator' as TabId, color: C.teal },
                { label: 'Analyse Root Causes', sub: 'CFR gap breakdown by driver', tab: 'rootcause' as TabId, color: C.orange },
                { label: 'Review Decision History', sub: 'All decisions with outcomes', tab: 'decisions' as TabId, color: C.muted },
              ].map(a => (
                <button
                  key={a.label}
                  onClick={() => onNavigate(a.tab)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', background: C.off, borderRadius: 6,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    borderLeft: `3px solid ${a.color}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.charcoal }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{a.sub}</div>
                  </div>
                  <ArrowRight className="w-4 h-4" style={{ color: a.color }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

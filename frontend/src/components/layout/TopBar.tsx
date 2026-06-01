/**
 * TopBar — v2.3 visual identity.
 * Extracted from mars-supply-ai-v2_02-restyled.jsx (function TopBar).
 *
 * Inline-style aesthetic preserved verbatim from the reference. Live KPIs
 * come from /api/dashboard-data via App.tsx and degrade to '—' when the
 * field is absent.
 */

import { C, MONO } from '../../lib/constants';
import type { DashboardData } from '../../types/dashboard';

type KpiTile = { label: string; value: string; color: string };

function fmtPct(v: unknown): string {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtUsdK(v: unknown): string {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`;
  return `$${v.toFixed(0)}`;
}

export function TopBar({ data, isLive }: { data: DashboardData; isLive: boolean }) {
  const gk = (data?.globalKPIs ?? {}) as Record<string, unknown>;

  const tiles: KpiTile[] = [
    { label: 'Network CFR',         value: fmtPct(gk.networkCFR),                          color: C.green    },
    { label: 'Fines at Risk 7D',    value: fmtUsdK(gk.otifFinesAtRisk7Day),                color: C.red      },
    { label: 'Rev Preserved MTD',   value: fmtUsdK(gk.revenuePreservedMTD),                color: C.charcoal },
    { label: 'Agent Accept Rate',   value: fmtPct(gk.agentRecommendationAcceptanceRate),   color: C.blue     },
  ];

  return (
    <header style={{
      height: 56, borderBottom: `2px solid ${C.red}`, background: '#fff',
      display: 'flex', alignItems: 'center', padding: '0 20px 0 16px', flexShrink: 0,
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    }}>
      {/* Brand block */}
      <div style={{
        display: 'flex', flexDirection: 'column', marginRight: 20, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, color: C.red, fontSize: 14, lineHeight: 1.2 }}>
          Mars Pet Nutrition
        </span>
        <span style={{ color: C.muted, fontSize: 10, letterSpacing: '0.04em' }}>
          OpEx Tower — Customer Supply
        </span>
      </div>

      {/* Brand divider */}
      <div style={{ width: 1, height: 32, background: C.border, marginRight: 20, flexShrink: 0 }} />

      {/* KPI tiles */}
      <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 0 }}>
        {tiles.map((k, i, a) => (
          <div key={k.label} style={{
            display: 'flex', flexDirection: 'column',
            paddingRight: 18, marginRight: 18, flexShrink: 0,
            borderRight: i < a.length - 1 ? `1px solid ${C.border}` : 'none',
          }}>
            <span style={{
              fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: C.muted, fontWeight: 600, marginBottom: 1,
            }}>{k.label}</span>
            <span style={{
              fontSize: 17, fontWeight: 700, color: k.color,
              fontFamily: MONO, lineHeight: 1,
            }}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* Live / mock indicator + user avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
          borderRadius: 20,
          border: isLive ? '1px solid #6ee7b7' : '1px solid #fcd34d',
          fontSize: 9, fontWeight: 700,
          color: isLive ? '#065f46' : '#92400e',
          background: isLive ? '#ecfdf5' : '#fffbeb',
          textTransform: 'uppercase', letterSpacing: '0.07em',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: isLive ? '#10b981' : '#f59e0b',
            display: 'inline-block',
          }} />
          {isLive ? 'Live Data' : 'Mock Data'}
        </div>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: C.off,
          border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.charcoal,
        }}>
          SO
        </div>
      </div>
    </header>
  );
}

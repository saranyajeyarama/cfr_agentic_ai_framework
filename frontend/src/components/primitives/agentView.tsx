/**
 * Shared primitives for the 4 agent overview pages (Phase 7).
 * Ported verbatim from the AI Studio reference
 * (context/mars-supply-ai-v2_02-restyled.jsx lines 2869–2931).
 *
 * Inline-style aesthetic preserved per the Phase 0.2 rule. Each component
 * is small and pure — no data fetching here, just rendering helpers.
 */

import type { ReactNode, CSSProperties } from 'react';
import { C, MONO } from '../../lib/constants';

// ─── AgentPageHeader ─────────────────────────────────────────────────────────

export function AgentPageHeader({
  title, color, question,
}: {
  title: string;
  /** Background colour for the banner (per-agent: blue / orange / teal / purple). */
  color: string;
  /** The agent's framing question, e.g. "Can we physically supply this?" */
  question: string;
}) {
  return (
    <div style={{
      background: color, padding: '22px 28px 20px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Decorative circles */}
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 160, height: 160,
        borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -30, right: 80, width: 100, height: 100,
        borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.55)',
          textTransform: 'uppercase', letterSpacing: '0.2em',
          marginBottom: 8, fontWeight: 700,
        }}>Agent View</div>
        <div style={{
          fontSize: 28, fontWeight: 700, color: '#fff',
          marginBottom: 10, letterSpacing: '-0.02em', lineHeight: 1.1,
        }}>{title}</div>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 10,
        }}>
          <span style={{
            fontSize: 14, color: 'rgba(255,255,255,0.45)', flexShrink: 0, lineHeight: 1.5,
          }}>◈</span>
          <span style={{
            fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.6,
          }}>{question}</span>
        </div>
      </div>
    </div>
  );
}

// ─── AgentKpi ────────────────────────────────────────────────────────────────

type KpiStatus = 'ok' | 'warn' | 'bad' | 'neutral';

const KPI_COLORS: Record<KpiStatus, { v: string; bg: string; bar: string }> = {
  ok:      { v: C.green,    bg: '#f0fdf4', bar: C.green  },
  warn:    { v: C.orange,   bg: '#fffbeb', bar: C.orange },
  bad:     { v: C.red,      bg: '#fff1f2', bar: C.red    },
  neutral: { v: C.charcoal, bg: C.off,     bar: C.border },
};

export function AgentKpi({
  label, value, delta, status = 'neutral',
}: {
  label: string;
  value: string | number;
  delta?: ReactNode;
  status?: KpiStatus;
}) {
  const s = KPI_COLORS[status];
  return (
    <div style={{
      background: s.bg, borderRadius: 8,
      padding: '14px 16px 12px',
      border: `1px solid ${C.border}`,
      borderTop: `3px solid ${s.bar}`,
    }}>
      <div style={{
        fontSize: 11, color: C.muted,
        textTransform: 'uppercase', letterSpacing: '0.07em',
        marginBottom: 8, lineHeight: 1.3, fontWeight: 500,
      }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 700, color: s.v, lineHeight: 1,
        fontFamily: MONO, letterSpacing: '-0.02em',
      }}>{value}</div>
      {delta && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.3 }}>
          {delta}
        </div>
      )}
    </div>
  );
}

// ─── TableHeader ─────────────────────────────────────────────────────────────

export type TableHeaderCol = {
  label: string;
  /** Column width — `"160px"`, `"1fr"`, `"2fr"`, etc. Defaults to `"1fr"`. */
  w?: string;
  /** Right-align this column's header (and typically its cell content too). */
  right?: boolean;
};

export function TableHeader({ cols }: { cols: TableHeaderCol[] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols.map(c => c.w || '1fr').join(' '),
      gap: 0, background: '#f1f5f9',
      borderBottom: `1px solid ${C.border}`, padding: '7px 12px',
    }}>
      {cols.map(c => (
        <div key={c.label} style={{
          fontSize: 10, fontWeight: 700, color: '#64748b',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          textAlign: c.right ? 'right' : 'left',
        }}>{c.label}</div>
      ))}
    </div>
  );
}

// ─── AdherenceBar ────────────────────────────────────────────────────────────

export function AdherenceBar({ pct }: { pct: number }) {
  const c = pct >= 95 ? C.green : pct >= 85 ? C.orange : C.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 5, background: C.border, borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: '100%', background: c, borderRadius: 3,
        }} />
      </div>
      <span style={{
        fontSize: 12, fontWeight: 700, color: c,
        minWidth: 36, textAlign: 'right', fontFamily: MONO,
      }}>{Math.round(pct)}%</span>
    </div>
  );
}

// ─── agentRowStyle — call from .map() to build a grid-row style inline ────────
// Avoids the React 19 / TS 5.8 key-in-props issue that would hit a named
// `AgentTableRow` component used inside `.map()`. Callers do:
//   <div key={…} style={agentRowStyle(cols, i % 2 === 1)}>…</div>

export function agentRowStyle(cols: TableHeaderCol[], alt: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: cols.map(c => c.w || '1fr').join(' '),
    gap: 0,
    padding: '9px 12px',
    borderBottom: `1px solid ${C.border}`,
    background: alt ? '#fafafa' : '#fff',
    alignItems: 'center',
    fontSize: 12,
    color: C.charcoal,
  };
}

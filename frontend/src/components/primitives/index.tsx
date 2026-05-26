/**
 * Shared visual primitives — v2.3.
 * Extracted verbatim from mars-supply-ai-v2_02-restyled.jsx so every
 * tab can compose them and keep the AI Studio aesthetic intact.
 *
 * All components use INLINE STYLES intentionally — do NOT migrate to
 * Tailwind utility classes. The visual identity stays as-shipped.
 */

import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { C, MONO, STATUS, type StatusKey } from '../../lib/constants';

// ─── Skeleton ─────────────────────────────────────────────────────────────────
// Gray placeholder block with a subtle shimmer. Sized via inline width/height
// props so any tab can compose its own loading layout from these.

export function Skeleton({
  width = '100%', height = 12, radius = 4, style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}) {
  return (
    <>
      <style>{`
        @keyframes sk-shimmer {
          0%   { background-position: -160px 0; }
          100% { background-position:  160px 0; }
        }
      `}</style>
      <div style={{
        width, height, borderRadius: radius,
        background: 'linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%)',
        backgroundSize: '320px 100%',
        animation: 'sk-shimmer 1.2s ease-in-out infinite',
        ...style,
      }} />
    </>
  );
}

/** Convenience: full-page skeleton stack — header bar + 4 KPI tiles + 2 wide
 *  rows. Used by every read-only tab while fetchDashboard() is pending. */
export function DashboardSkeleton({ title }: { title?: string }) {
  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: C.muted }} />
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
          {title ?? 'Loading…'}
        </span>
      </div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
            padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <Skeleton width={80} height={9} />
            <Skeleton width={120} height={24} />
            <Skeleton width={140} height={10} />
          </div>
        ))}
      </div>
      {/* Wide rows */}
      {[0, 1].map(i => (
        <div key={i} style={{
          background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
          padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <Skeleton width={180} height={12} />
          <Skeleton width="100%" height={10} />
          <Skeleton width="92%" height={10} />
          <Skeleton width="78%" height={10} />
        </div>
      ))}
    </div>
  );
}

// ─── ErrorState ───────────────────────────────────────────────────────────────
// Inline error block with retry button. Used by every tab that fetches data
// independently — the backend being unreachable is a real signal, not
// something to hide behind static fallbacks.

export function ErrorState({
  title = 'Could not load data',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: 40, background: C.off, minHeight: 320,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        background: '#fde8ec', border: `1px solid ${C.red}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <AlertTriangle size={22} color={C.red} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.charcoal }}>{title}</div>
      <div style={{
        fontSize: 12, color: C.muted, maxWidth: 420, textAlign: 'center', lineHeight: 1.5,
      }}>{message}</div>
      {onRetry && (
        <button onClick={onRetry} style={{
          marginTop: 4, display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 16px', background: C.red, color: '#fff',
          border: 'none', borderRadius: 6, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
        }}>
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

export function Pill({
  label, color, size = 11,
}: { label: string; color: string; size?: number }) {
  return (
    <span style={{
      background: color, color: '#fff', borderRadius: 4, padding: '2px 8px',
      fontSize: size, fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

// ─── MiniBar ──────────────────────────────────────────────────────────────────

export function MiniBar({
  value, max = 100, color,
}: { value: number; max?: number; color?: string }) {
  return (
    <div style={{ height: 5, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${Math.min(100, (value / max) * 100)}%`,
        background: color || C.blue, borderRadius: 3, transition: 'width 0.8s',
      }} />
    </div>
  );
}

// ─── SectionHead ──────────────────────────────────────────────────────────────

export function SectionHead({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.muted,
      textTransform: 'uppercase', letterSpacing: '0.1em',
      marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}`,
    }}>{title}</div>
  );
}

// ─── Blinker (animated typing dots) ───────────────────────────────────────────

export function Blinker() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT(x => (x + 1) % 4), 380);
    return () => clearInterval(i);
  }, []);
  return (
    <span style={{ color: C.muted, marginLeft: 1 }}>
      {['   ', '.  ', '.. ', '...'][t]}
    </span>
  );
}

// ─── KpiChip ──────────────────────────────────────────────────────────────────

type ChipProps = { label: string; value: string | number; status?: StatusKey };

/** Render fn — NOT a React component, to sidestep the TS5.8/React19
 *  `key`-in-props check when used inside .map(). */
function renderKpiChip({ label, value, status = 'neutral' }: ChipProps, k: string | number) {
  const s = STATUS[status] ?? STATUS.neutral;
  return (
    <div key={k} style={{
      background: s.bg, borderRadius: 5, padding: '6px 8px',
      border: `1px solid ${C.border}`,
    }}>
      <div style={{
        fontSize: 9, color: C.muted, textTransform: 'uppercase',
        letterSpacing: '0.07em', marginBottom: 2, lineHeight: 1,
      }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: s.col, lineHeight: 1.3 }}>
        {value}
      </div>
    </div>
  );
}

export function KpiChip(props: ChipProps) {
  return renderKpiChip(props, 'kpichip');
}

// ─── KpiGroup ─────────────────────────────────────────────────────────────────

export function KpiGroup({
  title, chips, cols = 2,
}: {
  title: string;
  chips: Array<{ label: string; value: string | number; status?: StatusKey }>;
  cols?: number;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 9, color: C.muted, textTransform: 'uppercase',
        letterSpacing: '0.1em', marginBottom: 5, fontWeight: 700,
        borderBottom: `1px solid ${C.border}`, paddingBottom: 3,
      }}>{title}</div>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 4,
      }}>
        {chips.map((c, i) => renderKpiChip(c, i))}
      </div>
    </div>
  );
}

// ─── BasisList ────────────────────────────────────────────────────────────────

export function BasisList({
  items, color,
}: { items: string[] | null | undefined; color: string }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginTop: 4 }}>
      {items.map((b, i) => (
        <div key={i} style={{
          fontSize: 10, color: C.charcoal, marginBottom: 3, paddingLeft: 8,
          borderLeft: `2px solid ${color}`, lineHeight: 1.4,
        }}>{b}</div>
      ))}
    </div>
  );
}

// ─── SigRow (one label/value line in a SigSection) ────────────────────────────

const SIG_ROW_COLOR: Record<StatusKey, string> = {
  ok: C.green, warn: C.orange, bad: C.red, info: C.blue, neutral: C.charcoal,
};

export function SigRow({
  label, value, status = 'neutral', mono = false,
}: {
  label: string;
  value: ReactNode;
  status?: StatusKey;
  mono?: boolean;
}) {
  const col = SIG_ROW_COLOR[status] ?? C.charcoal;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '3.5px 0 3.5px 10px', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{
        fontSize: 11, color: C.muted, lineHeight: 1.4, flexShrink: 0, marginRight: 8,
      }}>{label}</span>
      <span style={{
        fontSize: 11, fontWeight: 600, color: col,
        fontFamily: mono ? MONO : 'inherit', textAlign: 'right',
      }}>{value}</span>
    </div>
  );
}

// ─── SigSection (titled group with agent-coloured left border) ────────────────

export function SigSection({
  title, color, children,
}: { title: string; color: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.12em',
        fontWeight: 700, marginBottom: 3, paddingLeft: 8,
        borderLeft: `3px solid ${color}`,
      }}>{title}</div>
      {children}
    </div>
  );
}

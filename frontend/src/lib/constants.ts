/**
 * Design palette and shared tokens — v2.3.
 * Extracted from mars-supply-ai-v2_02-restyled.jsx so the inline-style
 * aesthetic of every screen stays in lockstep.
 *
 * Import `C` (colour palette) and `MONO` (mono font) from here instead
 * of redefining colour strings or font stacks inline.
 */

export const C = {
  red:      '#DB033B',   // Tiger Foods / Mars brand red
  redLight: '#fef2f2',   // subtle red wash (active sidebar items, alert bg)
  charcoal: '#1e293b',   // slate-800 — body text + dark headers
  cream:    '#F5F1E7',
  border:   '#e2e8f0',   // slate-200 — neutral borders
  muted:    '#94a3b8',   // slate-400 — secondary text
  green:    '#059669',   // emerald-600 — positive status
  teal:     '#0d9488',   // teal-600 — transportation agent
  blue:     '#0284c7',   // sky-600 — supply planning agent
  orange:   '#d97706',   // amber-600 — warning / demand agent
  purple:   '#7c3aed',   // violet-700 — retail intelligence agent
  white:    '#FFFFFF',
  off:      '#f8fafc',   // slate-50
  black:    '#0f172a',   // slate-900
} as const;

/** Mono font stack — used for numeric/monospace values in inline styles. */
export const MONO = "'JetBrains Mono',ui-monospace,monospace";

// ─── Agent metadata ─────────────────────────────────────────────────────────

export type AgentKey =
  | 'supply_planning'
  | 'demand_planning'
  | 'transportation'
  | 'retail_intelligence';

export const AGENT_KEYS: AgentKey[] = [
  'supply_planning',
  'demand_planning',
  'transportation',
  'retail_intelligence',
];

export const AGENT_LABELS: Record<AgentKey, { label: string; color: string }> = {
  supply_planning:     { label: 'Supply Planning',     color: C.blue   },
  demand_planning:     { label: 'Demand Planning',     color: C.orange },
  transportation:      { label: 'Transportation',      color: C.teal   },
  retail_intelligence: { label: 'Retail Intelligence', color: C.purple },
};

/** Display-name → colour, also valid for snake_case keys. */
export const AGENT_COLORS: Record<string, string> = {
  supply_planning:      C.blue,
  demand_planning:      C.orange,
  transportation:       C.teal,
  retail_intelligence:  C.purple,
  'Supply Planning':    C.blue,
  'Demand Planning':    C.orange,
  'Transportation':     C.teal,
  'Retail Intelligence':C.purple,
  'Customer Supply':    C.green,
  'Trigger Adapter':    C.muted,
};

// ─── Status palettes ────────────────────────────────────────────────────────

/** Background + text colour by neutral status name. Used by KpiChip / SigRow. */
export const STATUS = {
  ok:      { bg: '#edf7ee', col: C.green    },
  warn:    { bg: '#fff8e6', col: C.orange   },
  bad:     { bg: '#fde8ec', col: C.red      },
  info:    { bg: '#e6f5fb', col: C.blue     },
  neutral: { bg: C.off,     col: C.charcoal },
} as const;

export type StatusKey = keyof typeof STATUS;

// ─── Domain colour helpers ──────────────────────────────────────────────────

/** Specialist disposition → colour */
export const dispColor = (d: string | null | undefined): string =>
  ({ PROCEED: C.green, CAUTION: C.orange, BLOCK: C.red } as Record<string, string>)[d ?? ''] ?? C.muted;

/** Escalation severity → colour */
export const sevColor = (s: string | null | undefined): string =>
  ({ HIGH: C.red, MEDIUM: C.orange, LOW: '#DAA520', CRITICAL: '#7B0000' } as Record<string, string>)[s ?? ''] ?? C.muted;

/** Recommendation action → colour */
export const actColor = (a: string | null | undefined): string =>
  ({ ACCEPT: C.green, PARTIAL_FULFILL: C.orange, PARTIAL: C.orange, DEFER: C.blue, REJECT: C.red } as Record<string, string>)[a ?? ''] ?? C.muted;

/** Order flag type → colour */
export const flagColor = (t: string | null | undefined): string =>
  ({ above_forecast: C.orange, promo: C.blue, hard_block: C.red, buffer_build: C.purple, clean: C.green } as Record<string, string>)[t ?? ''] ?? C.muted;

// ─── Convenience maps (kept for backwards compatibility) ─────────────────────

/** Flag type → display colour */
export const FLAG_COLORS: Record<string, string> = {
  hard_block:     C.red,
  above_forecast: C.orange,
  buffer_build:   C.purple,
  promo:          C.teal,
  clean:          C.green,
};

/** Agent recommendation action → colour */
export const ACTION_COLORS: Record<string, string> = {
  ACCEPT:  C.green,
  PARTIAL: C.orange,
  REJECT:  C.red,
  DEFER:   C.muted,
};

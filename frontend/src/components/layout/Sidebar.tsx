/**
 * Sidebar — v2.3 visual identity.
 * Extracted from mars-supply-ai-v2_02-restyled.jsx (function Sidebar).
 *
 * Per Phase 0.4: the 5 screens with no live backend equivalent (Supply
 * Planning / Demand Planning / Transportation / Retail Intelligence
 * agent pages + Data Dictionary) are HIDDEN from the v2.3 navigation.
 * They will return in Phase 2 once the backend exposes routes for them.
 * Reference JSX still lives at /reference/original_ai_studio.jsx.
 *
 * This file is a NEW component alongside SidebarNav.tsx — App.tsx is
 * not yet swapped over. Phase 1/2 wires it in.
 */

import { useState } from 'react';
import {
  LayoutDashboard, Inbox, GitMerge, FileSearch, ShieldCheck,
  Home, Clock, ChevronLeft, ChevronRight, Activity,
  type LucideIcon,
} from 'lucide-react';
import { C } from '../../lib/constants';
import type { ScreenId } from '../../lib/types';

// Re-export ScreenId so callers can keep `import { ScreenId } from '.../Sidebar'`.
export type { ScreenId };

type NavItem =
  | { kind: 'item'; id: ScreenId; label: string; Icon: LucideIcon; badge?: number }
  | { kind: 'divider'; label: string };

const NAV_ITEMS: NavItem[] = [
  { kind: 'item',    id: 'watchtower',  label: 'Watchtower',             Icon: LayoutDashboard },
  { kind: 'item',    id: 'triage',      label: 'Order Triage',           Icon: Inbox           },
  { kind: 'item',    id: 'simulator',   label: 'Fulfillment Simulator',  Icon: GitMerge        },
  { kind: 'item',    id: 'rootcause',   label: 'Root Cause Hub',         Icon: FileSearch      },
  { kind: 'item',    id: 'safetystock', label: 'Safety Stock Optimizer', Icon: ShieldCheck     },
  { kind: 'divider', label: 'New in v2' },
  { kind: 'item',    id: 'manager',     label: 'My Dashboard',           Icon: Home            },
  { kind: 'item',    id: 'decisions',   label: 'Decision Log',           Icon: Clock           },
];

const INFO_ITEMS: { id: ScreenId; label: string; Icon: LucideIcon }[] = [
  { id: 'datahealth', label: 'Data Health', Icon: Activity },
];

// ─── Main component ──────────────────────────────────────────────────────────

export function Sidebar({
  screen, setScreen,
}: {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
}) {
  const [col, setCol] = useState(false);

  return (
    <nav style={{
      width: col ? 60 : 220, background: '#fff',
      borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      transition: 'width 0.18s',
      overflowX: 'hidden', overflowY: 'hidden',
    }}>
      {/* Workspace header */}
      <div style={{
        height: 56, padding: col ? '0' : '0 12px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center',
        justifyContent: col ? 'center' : 'space-between',
        flexShrink: 0,
      }}>
        {!col && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: C.muted,
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>Workspace</span>
        )}
        <button onClick={() => setCol(c => !c)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: C.muted, display: 'flex', alignItems: 'center', padding: 4,
        }}>
          {col ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {/* Nav scroll area */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 6 }}>
        {/* Main + "New in v2" items */}
        {NAV_ITEMS.map((item, idx) => {
          if (item.kind === 'divider') {
            return (
              <div key={`div-${idx}`} style={{
                display: col ? 'none' : 'block', margin: '6px 12px 2px',
                borderTop: `1px solid ${C.border}`, paddingTop: 6,
                fontSize: 9, color: C.muted,
                textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
              }}>{item.label}</div>
            );
          }
          const { id, label, Icon, badge } = item;
          const active = screen === id;
          return (
            <button key={id} onClick={() => setScreen(id)} style={{
              display: 'flex', alignItems: 'center', gap: col ? 0 : 10, width: '100%',
              padding: col ? '11px 0' : '9px 16px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'left',
              justifyContent: col ? 'center' : 'flex-start',
              background: active ? C.redLight : 'transparent',
              borderRight: active ? `3px solid ${C.red}` : '3px solid transparent',
              color: active ? C.charcoal : C.muted,
              fontSize: 13, fontWeight: active ? 600 : 500,
            }}>
              <Icon size={17}
                color={active ? C.red : C.muted}
                strokeWidth={active ? 2.5 : 1.8}
                style={{ flexShrink: 0 }} />
              {!col && <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>}
              {!col && badge != null && (
                <span style={{
                  background: C.red, color: '#fff', borderRadius: 10,
                  padding: '1px 6px', fontSize: 10, fontWeight: 700,
                }}>{badge}</span>
              )}
            </button>
          );
        })}

        {/* Agent Views section — REMOVED in Phase 0.4 (no live backend yet).
            Will be re-added when Phase 2 wires up per-agent endpoints. */}

        {/* Info section */}
        <div style={{
          display: col ? 'none' : 'block', margin: '8px 12px 2px',
          borderTop: `1px solid ${C.border}`, paddingTop: 6,
          fontSize: 9, color: C.muted,
          textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
        }}>Info</div>
        {INFO_ITEMS.map(({ id, label, Icon }) => {
          const active = screen === id;
          return (
            <button key={id} onClick={() => setScreen(id)} style={{
              display: 'flex', alignItems: 'center', gap: col ? 0 : 10, width: '100%',
              padding: col ? '11px 0' : '9px 16px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'left',
              justifyContent: col ? 'center' : 'flex-start',
              background: active ? C.redLight : 'transparent',
              borderRight: active ? `3px solid ${C.red}` : '3px solid transparent',
              color: active ? C.charcoal : C.muted,
              fontSize: 13, fontWeight: active ? 600 : 500,
            }}>
              <Icon size={17}
                color={active ? C.red : C.muted}
                strokeWidth={active ? 2.5 : 1.8}
                style={{ flexShrink: 0 }} />
              {!col && <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>}
            </button>
          );
        })}
      </div>

      {/* Brand footer */}
      {!col && (
        <div style={{
          padding: '8px 14px', borderTop: `1px solid ${C.border}`,
          fontSize: 9, color: C.muted,
        }}>
          © 2026 Mars, Incorporated
        </div>
      )}
    </nav>
  );
}

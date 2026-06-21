import { useState } from "react";
import {
  LayoutDashboard, Inbox, GitMerge, FileSearch,
  PanelLeftClose, PanelLeftOpen, ShieldCheck,
  Clock, Home, Activity, BookOpen, ScrollText, DollarSign,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { ScreenId } from "../../lib/types";

/** @deprecated Use ScreenId from lib/types. Kept as an alias so existing
 *  imports compile during the transition. */
export type TabId = ScreenId;

interface SidebarNavProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────
type TabDef = { id: TabId; label: string; icon: LucideIcon };

const MAIN_TABS: TabDef[] = [
  { id: 'watchtower', label: 'Agent Watchtower',       icon: LayoutDashboard },
  { id: 'triage',     label: 'Order Triage',           icon: Inbox           },
  { id: 'simulator',  label: 'Fulfillment Simulator',  icon: GitMerge        },
  { id: 'rootcause',  label: 'Root Cause Hub',         icon: FileSearch      },
  { id: 'safetystock', label: 'Safety Stock Optimizer', icon: ShieldCheck     },
];

const ANALYTICS_TABS: TabDef[] = [
  { id: 'manager',    label: 'My Dashboard',   icon: Home     },
  { id: 'decisions',  label: 'Decision Log',   icon: Clock    },
  { id: 'logs',       label: 'Agent Logs',     icon: ScrollText },
  { id: 'finops',     label: 'LLM FinOps',     icon: DollarSign },
  { id: 'datahealth', label: 'Data Health',    icon: Activity },
  { id: 'dictionary', label: 'Data Dictionary', icon: BookOpen },
];

// ─── Main component ───────────────────────────────────────────────────────────
export function SidebarNav({ activeTab, setActiveTab }: SidebarNavProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const renderTabs = (tabs: TabDef[]) =>
    tabs.map(tab => {
      const isActive = activeTab === tab.id;
      const Icon = tab.icon;
      return (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            "flex items-center gap-2.5 py-2 w-full transition-colors relative group text-[12px] leading-tight",
            isCollapsed ? "justify-center px-0" : "px-4 text-left",
            isActive
              ? "bg-[#fef2f2] text-slate-900 font-semibold border-r-2 border-[#DB033B]"
              : "text-slate-500 font-medium hover:text-slate-700 hover:bg-slate-50"
          )}
        >
          <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-[#DB033B]" : "text-slate-400")} />
          {!isCollapsed && <span className="truncate">{tab.label}</span>}
          {isCollapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
              {tab.label}
            </div>
          )}
        </button>
      );
    });

  // Inline divider — collapsed shows a thin line, expanded shows the section label.
  const sectionDivider = (label: string) => (
    <div className="mt-2 mb-0.5 shrink-0">
      {!isCollapsed ? (
        <div className="px-4 py-1 text-[9px] font-bold text-slate-400 tracking-widest uppercase">
          {label}
        </div>
      ) : (
        <div className="border-t border-slate-100 mx-4 my-1.5" />
      )}
    </div>
  );

  return (
    <nav
      className={cn(
        // h-full + overflow-hidden contains the inner scroll area cleanly within
        // the parent flex row. shrink-0 keeps the width fixed.
        "h-full border-r border-slate-200 bg-white flex flex-col shrink-0 z-10 transition-all duration-300 relative overflow-hidden",
        isCollapsed ? "w-16" : "w-56"
      )}
    >
      {/* Header — fixed (does NOT scroll) */}
      <div
        className={cn(
          "px-3 py-3 flex items-center shrink-0 border-b border-slate-100",
          isCollapsed ? "justify-center" : "justify-between"
        )}
      >
        {!isCollapsed && (
          <div className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
            Workspace
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(c => !c)}
          className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100"
        >
          {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Scrollable section list (the only scroll surface in the sidebar) */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2">
        <div className="flex flex-col gap-0.5 w-full">
          {renderTabs(MAIN_TABS)}
        </div>

        {sectionDivider('Analytics')}
        <div className="flex flex-col gap-0.5 w-full">
          {renderTabs(ANALYTICS_TABS)}
        </div>
      </div>

      {/* Brand footer — fixed at the bottom */}
      {!isCollapsed && (
        <div className="px-4 py-2 border-t border-slate-100 shrink-0 bg-white">
          <div className="text-[10px] text-slate-400 font-mono leading-tight">
            Tiger Foods OpEx Tower
          </div>
          <div className="text-[9px] text-slate-300 leading-tight mt-0.5">
            v2.02b · Agentic AI
          </div>
        </div>
      )}
    </nav>
  );
}

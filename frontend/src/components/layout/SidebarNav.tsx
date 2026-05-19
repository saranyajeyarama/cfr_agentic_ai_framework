import { LayoutDashboard, Inbox, GitMerge, FileSearch, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import { cn } from "../../lib/utils";
import { useState } from "react";

export type TabId = 'watchtower' | 'triage' | 'simulator' | 'rootcause' | 'optimizer';

interface SidebarNavProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

export function SidebarNav({ activeTab, setActiveTab }: SidebarNavProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const tabs = [
    { id: 'watchtower', label: 'Agent Watchtower', icon: LayoutDashboard },
    { id: 'triage', label: 'Order Triage', icon: Inbox },
    { id: 'simulator', label: 'Fulfillment Simulator', icon: GitMerge },
    { id: 'rootcause', label: 'Root Cause Hub', icon: FileSearch },
    { id: 'optimizer', label: 'Safety Stock Optimizer', icon: ShieldCheck },
  ] as const;

  return (
    <nav className={cn(
      "border-r border-slate-200 bg-white flex flex-col py-6 shrink-0 z-10 transition-all duration-300 relative",
      isCollapsed ? "w-20" : "w-64"
    )}>
      <div className={cn(
        "px-4 mb-4 flex items-center",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        {!isCollapsed && <div className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Workspace</div>}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100"
        >
          {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
      
      <div className="flex flex-col gap-1 w-full mt-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-3 py-3 w-full transition-colors relative group",
                isCollapsed ? "justify-center px-0" : "px-6 text-left",
                isActive 
                  ? "bg-[#fef2f2] text-slate-900 font-semibold border-r-2 border-[#DB033B]" 
                  : "text-slate-500 font-medium hover:text-slate-700 hover:bg-slate-50"
              )}
            >
              <tab.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-[#DB033B]" : "text-slate-400")} />
              
              {!isCollapsed && <span className="truncate">{tab.label}</span>}

              {isCollapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
                  {tab.label}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  );
}


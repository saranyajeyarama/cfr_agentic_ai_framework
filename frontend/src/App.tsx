/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v2.3 shell.
 *
 * Architecture (after Phase 2.1):
 *   • App.tsx no longer blocks rendering on /dashboard-data. Each
 *     read-only tab calls useDashboardData() and renders its own
 *     loading / error / data states. The 60-second cache inside
 *     fetchDashboard() (lib/api.ts) deduplicates concurrent calls.
 *   • OrderTriage owns the /v23/orders queue and the /v23/triage flow.
 *     It accepts only an optional onDecisionSaved callback so the
 *     Fulfillment Simulator can invalidate its incidents cache when
 *     a newly approved order becomes eligible.
 *   • App.tsx still uses useDashboardData() to feed TopBar /
 *     RightSidebar — those degrade gracefully to '—' when data is
 *     still loading or unreachable.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TopBar } from './components/layout/TopBar';
import { SidebarNav, TabId } from './components/layout/SidebarNav';
import { RightSidebar } from './components/layout/RightSidebar';
import { Watchtower } from './components/tabs/Watchtower';
import { OrderTriage } from './components/tabs/OrderTriage';
import { FulfillmentSimulator } from './components/tabs/FulfillmentSimulator';
import { RootCauseHub } from './components/tabs/RootCauseHub';
import { SafetyStockOptimizer } from './components/tabs/SafetyStockOptimizer';
import { DecisionLog } from './components/tabs/DecisionLog';
import { ManagerDashboard } from './components/tabs/ManagerDashboard';
import { DataHealthPage } from './components/tabs/DataHealthPage';
import { useDashboardData } from './lib/hooks';
import {
  useFulfillmentIncidentsStore,
  useFulfillmentScenariosStore,
} from './lib/fulfillment';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('watchtower');

  // Single dashboard hook for the shell — feeds TopBar + RightSidebar.
  // Read-only tabs call useDashboardData() independently; the api.ts
  // cache makes that a no-op network-wise.
  const { data: dashboardData, loading: dashboardLoading, err: dashboardErr } = useDashboardData();

  // Fulfillment Simulator state survives tab switches.
  const incidentsStore                  = useFulfillmentIncidentsStore();
  const [scenariosMap, setScenariosMap] = useFulfillmentScenariosStore();

  // The shell renders immediately — no blocking screen. Each tab and the
  // TopBar handle their own loading/error inline.
  const isLive = !dashboardLoading && !dashboardErr && dashboardData != null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900 font-sans selection:bg-blue-200">
      <TopBar data={dashboardData ?? {}} isLive={isLive} />

      <div className="flex flex-1 overflow-hidden">
        <SidebarNav activeTab={activeTab} setActiveTab={setActiveTab} />

        <main className="flex-1 overflow-hidden relative bg-slate-50">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeTab === 'watchtower'  && <Watchtower />}
              {activeTab === 'triage'      && (
                <OrderTriage onDecisionSaved={incidentsStore.invalidate} />
              )}
              {activeTab === 'simulator'   && (
                <FulfillmentSimulator
                  incidentsStore={incidentsStore}
                  scenariosMap={scenariosMap}
                  setScenariosMap={setScenariosMap}
                />
              )}
              {activeTab === 'rootcause'   && <RootCauseHub />}
              {activeTab === 'safetystock' && <SafetyStockOptimizer />}
              {activeTab === 'decisions'   && <DecisionLog />}
              {activeTab === 'manager'     && <ManagerDashboard onNavigate={setActiveTab} />}
              {activeTab === 'datahealth'  && <DataHealthPage />}
            </motion.div>
          </AnimatePresence>
        </main>

        <RightSidebar data={dashboardData ?? {}} />
      </div>
    </div>
  );
}

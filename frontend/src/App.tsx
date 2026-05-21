/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TopBar } from './components/layout/TopBar';
import { SidebarNav, TabId } from './components/layout/SidebarNav';
import { RightSidebar } from './components/layout/RightSidebar';
import { Watchtower } from './components/tabs/Watchtower';
import { OrderTriage } from './components/tabs/OrderTriage';
import { FulfillmentSimulator } from './components/tabs/FulfillmentSimulator';
import { RootCauseHub } from './components/tabs/RootCauseHub';
import { SafetyStockOptimizer } from './components/tabs/SafetyStockOptimizer';
import mockData from './data/mockData.json';
import type { DashboardData } from './types/dashboard';
import { useAgentEvalsStore, useDecisionLogStore } from './lib/agentEvals';
import {
  useFulfillmentIncidentsStore,
  useFulfillmentScenariosStore,
} from './lib/fulfillment';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('watchtower');
  const [dashboardData, setDashboardData] = useState<DashboardData>(mockData as DashboardData);
  const [isLiveData, setIsLiveData] = useState<boolean>(false);
  // Lifted so tab switches don't unmount OrderTriage and lose its
  // evaluation results. Backed by sessionStorage so reloads keep them.
  const [agentEvals, setAgentEvals] = useAgentEvalsStore();
  // Same pattern for the Fulfillment Simulator — incident list + per-incident
  // LP scenarios survive tab switches and reloads.
  const incidentsStore = useFulfillmentIncidentsStore();
  const [scenariosMap, setScenariosMap] = useFulfillmentScenariosStore();
  // Recent Agent Override Telemetry — persisted so tab switches don't drop
  // the local additions a user made during the session.
  const [decisionLog, setDecisionLog] = useDecisionLogStore(
    dashboardData.decisionCaptureLog ?? [],
  );

  useEffect(() => {
    fetch('/api/dashboard-data')
      .then(r => r.json())
      .then(d => {
        setDashboardData(d as DashboardData);
        setIsLiveData(true);
      })
      .catch(() => {
        setIsLiveData(false);
      });
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900 font-sans selection:bg-blue-200">
      <TopBar data={dashboardData} isLive={isLiveData} />

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
              {activeTab === 'watchtower' && <Watchtower data={dashboardData} />}
              {activeTab === 'triage' && (
                <OrderTriage
                  data={dashboardData}
                  agentEvals={agentEvals}
                  setAgentEvals={setAgentEvals}
                  decisionLog={decisionLog}
                  setDecisionLog={setDecisionLog}
                  onDecisionSaved={incidentsStore.invalidate}
                />
              )}
              {activeTab === 'simulator' && (
                <FulfillmentSimulator
                  incidentsStore={incidentsStore}
                  scenariosMap={scenariosMap}
                  setScenariosMap={setScenariosMap}
                />
              )}
              {activeTab === 'rootcause' && <RootCauseHub data={dashboardData} />}
              {activeTab === 'optimizer' && <SafetyStockOptimizer data={dashboardData} />}
            </motion.div>
          </AnimatePresence>
        </main>

        <RightSidebar data={dashboardData} />
      </div>
    </div>
  );
}

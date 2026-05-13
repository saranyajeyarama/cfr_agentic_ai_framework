/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('watchtower');

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900 font-sans selection:bg-blue-200">
      <TopBar />
      
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
              {activeTab === 'watchtower' && <Watchtower />}
              {activeTab === 'triage' && <OrderTriage />}
              {activeTab === 'simulator' && <FulfillmentSimulator />}
              {activeTab === 'rootcause' && <RootCauseHub />}
              {activeTab === 'optimizer' && <SafetyStockOptimizer />}
            </motion.div>
          </AnimatePresence>
        </main>

        <RightSidebar />
      </div>
    </div>
  );
}

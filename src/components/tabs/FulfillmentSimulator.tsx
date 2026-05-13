import { Activity, AlertTriangle, ArrowRight, ShieldAlert, ChevronRight, CheckCircle2, Factory } from 'lucide-react';
import { Pie, PieChart, ResponsiveContainer, Cell } from 'recharts';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import mockData from '../../data/mockData.json';

type Scenario = {
  id: string;
  name: string;
  tagline: string;
  isRecommended?: boolean;
  arrival: string;
  dcSource: string;
  freightCost: number;
  fine: number;
  netImpact: number;
  savingsVsDefault: number;
  rationale?: string;
};

type Incident = {
  id: string;
  title: string;
  customer: string;
  skuCode: string;
  skuName: string;
  description: string;
  riskProbability: number;
  fineAtRisk: number;
  otifRulebook: string;
  scenarios: Scenario[];
  executionSteps: string[];
};

const INCIDENTS: Incident[] = mockData.fulfillmentIncidents as Incident[];

export function FulfillmentSimulator() {
  const [activeIncidentId, setActiveIncidentId] = useState<string>(INCIDENTS[0].id);
  const [expandedRationaleId, setExpandedRationaleId] = useState<string | null>(null);
  
  const incident = INCIDENTS.find(i => i.id === activeIncidentId) || INCIDENTS[0];
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(incident.scenarios.find(s => s.isRecommended)?.id || incident.scenarios[0].id);

  // Update selected scenario when incident changes
  const handleIncidentClick = (id: string) => {
    setActiveIncidentId(id);
    const newIncident = INCIDENTS.find(i => i.id === id);
    if (newIncident) {
      setSelectedScenarioId(newIncident.scenarios.find(s => s.isRecommended)?.id || newIncident.scenarios[0].id);
    }
  };

  const selectedScenario = incident.scenarios.find(s => s.id === selectedScenarioId);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Multi-Agent Fulfillment Simulator</h2>
          <p className="text-xs text-slate-500">Cross-agent negotiation and resolution paths</p>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Active Incidents Queue */}
        <div className="w-80 border-r border-slate-200 bg-white/50 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-slate-200 bg-slate-100/50">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active Incidents Queue</h3>
          </div>
          <div className="flex flex-col p-2 gap-2">
            {INCIDENTS.map((item) => (
              <button
                key={item.id}
                onClick={() => handleIncidentClick(item.id)}
                className={cn(
                  "p-4 rounded-xl border text-left transition-all duration-200",
                  activeIncidentId === item.id 
                    ? "bg-white border-[#DB033B] shadow-md ring-1 ring-[#DB033B]/20" 
                    : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{item.customer}</span>
                  <div className="w-2 h-2 rounded-full bg-[#DB033B] animate-pulse mt-1"></div>
                </div>
                <h4 className="text-sm font-bold text-slate-800 leading-tight mb-2">{item.title}</h4>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">Risk: <span className="text-[#DB033B] font-bold">${item.fineAtRisk.toLocaleString()}</span></span>
                  <ChevronRight className={cn("w-4 h-4 transition-colors", activeIncidentId === item.id ? "text-[#DB033B]" : "text-slate-400")} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right Panel: Scenario Simulator */}
        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8">
          
          {/* Top Section: Context & Radar */}
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Delay Context</h3>
              <div className="flex gap-4">
                 <div className="w-10 h-10 rounded-full bg-[#DB033B]/10 flex items-center justify-center text-[#DB033B] flex-shrink-0 border border-[#DB033B]/20">
                    <AlertTriangle className="w-5 h-5" />
                 </div>
                 <div>
                   <div className="font-bold text-slate-800">{incident.title} / {incident.customer}</div>
                   <div className="text-sm text-slate-600 mt-1 leading-relaxed">
                     {incident.description}
                   </div>
                 </div>
              </div>
            </div>

            {/* Component 1: Chargeback Risk Radar */}
            <div className="col-span-1 bg-white border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center relative shadow-sm">
               <div className="absolute top-4 w-full flex justify-center">
                   <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center">OTIF / Cut Risk</h3>
               </div>
               <div className="relative w-32 h-32 mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Risk', value: incident.riskProbability, fill: '#ef4444' },
                          { name: 'Safe', value: 100 - incident.riskProbability, fill: '#f1f5f9' }
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={60}
                        startAngle={180}
                        endAngle={-180}
                        dataKey="value"
                        stroke="none"
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center top-6">
                    <span className="text-2xl font-black text-[#DB033B] tracking-tighter">{incident.riskProbability}%</span>
                    <span className="text-[10px] uppercase text-[#DB033B]/80 font-bold">Prob.</span>
                  </div>
               </div>
               
               <div className="text-center mt-2">
                 <div className="text-xs text-slate-500 font-medium">Fine / Rev At Risk</div>
                 <div className="text-lg font-mono font-bold text-[#DB033B]">${incident.fineAtRisk.toLocaleString()}</div>
               </div>
            </div>
          </div>

          {/* Risk Gauge Panel */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-end mb-2">
              <div className="text-3xl font-bold font-mono flex items-baseline gap-2">
                {incident.riskProbability}%
                <span className="text-sm font-sans font-bold text-slate-500 uppercase tracking-widest">Risk Probability</span>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Fine At Risk</div>
                <div className="text-xl font-bold font-mono text-[#DB033B]">${incident.fineAtRisk.toLocaleString()}</div>
              </div>
            </div>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden mb-3">
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  incident.riskProbability <= 60 ? "bg-emerald-500" :
                  incident.riskProbability <= 85 ? "bg-amber-500" : "bg-[#DB033B]"
                )}
                style={{ width: `${incident.riskProbability}%` }}
              ></div>
            </div>
            <p className="text-xs italic text-slate-500 leading-relaxed">{incident.otifRulebook}</p>
          </div>

          {/* Component 2: Scenario Comparison Matrix */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Agent Resolution Strategies</h3>
            <div className="grid grid-cols-2 gap-6 relative">
              
              {incident.scenarios.map((scenario) => {
                const isSelected = selectedScenarioId === scenario.id;
                const isRecommended = scenario.isRecommended;

                return (
                  <button 
                    key={scenario.id}
                    onClick={() => setSelectedScenarioId(scenario.id)}
                    className={cn(
                      "text-left rounded-xl p-6 relative overflow-hidden transition-all duration-300 outline-none focus:ring-0",
                      isSelected 
                        ? (isRecommended ? "bg-[#DB033B]/5 border-2 border-[#DB033B] shadow-md ring-4 ring-[#DB033B]/10" : "bg-white border-2 border-slate-800 shadow-md ring-4 ring-slate-800/10")
                        : "bg-white border-2 border-slate-200 hover:border-slate-300 shadow-sm hover:shadow-md opacity-70 hover:opacity-100"
                    )}
                  >
                    {isRecommended && (
                      <div className="absolute top-0 right-0 bg-[#DB033B] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg">
                        Recommended
                      </div>
                    )}
                    
                    <div className="flex flex-col mb-4">
                      <div className={cn("text-lg font-bold mb-1 pr-24", isSelected ? (isRecommended ? "text-[#DB033B]" : "text-slate-900") : "text-slate-800")}>{scenario.name}</div>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded",
                          isRecommended ? "bg-[#DB033B]/10 text-[#DB033B]" : "bg-slate-100 text-slate-600"
                        )}>
                          {scenario.tagline}
                        </span>
                        {isSelected && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                            <CheckCircle2 className="w-3 h-3" /> Selected
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <ul className="space-y-3 mb-6 text-sm">
                      <li className={cn("flex justify-between border-b pb-2", isRecommended ? "border-[#DB033B]/20" : "border-slate-100")}>
                        <span className={cn("font-medium", isRecommended ? "text-[#DB033B]" : "text-slate-600")}>Arrival</span>
                        <span className={cn("font-bold", scenario.fine > 0 ? "text-[#DB033B]" : "text-emerald-600")}>{scenario.arrival}</span>
                      </li>
                      <li className={cn("flex justify-between border-b pb-2", isRecommended ? "border-[#DB033B]/20" : "border-slate-100")}>
                        <span className={cn("font-medium", isRecommended ? "text-[#DB033B]" : "text-slate-600")}>Freight Cost</span>
                        <span className="text-slate-800 font-mono font-medium">${scenario.freightCost.toLocaleString()}</span>
                      </li>
                      <li className={cn("flex justify-between border-b pb-2", isRecommended ? "border-[#DB033B]/20" : "border-slate-100")}>
                        <span className={cn("font-medium flex items-center gap-1", isRecommended ? "text-[#DB033B]" : "text-slate-600")}>
                          Risk / Fine {scenario.fine > 0 && <ShieldAlert className="w-3 h-3 text-[#DB033B]"/>}
                        </span>
                        <span className={cn("font-mono font-bold", scenario.fine > 0 ? "text-[#DB033B]" : "text-slate-500")}>${scenario.fine.toLocaleString()}</span>
                      </li>
                    </ul>
                    
                    <div className={cn(
                      "p-4 rounded-lg flex justify-between items-center border",
                      isRecommended ? "bg-white border-[#DB033B]/20 mb-2 shadow-sm" : "bg-slate-50 border-slate-200 mt-auto"
                    )}>
                       <div className="flex flex-col">
                         <span className={cn("text-xs font-bold uppercase tracking-widest", isRecommended ? "text-[#DB033B]" : "text-slate-600")}>Net Financial Impact</span>
                         {scenario.savingsVsDefault > 0 && (
                           <span className="text-[10px] text-emerald-600 mt-1 font-bold">+${scenario.savingsVsDefault.toLocaleString()} Savings</span>
                         )}
                       </div>
                       <span className={cn("text-xl font-black font-mono", isRecommended ? "text-[#DB033B]" : "text-[#DB033B]")}>-${Math.abs(scenario.netImpact).toLocaleString()}</span>
                    </div>

                    {scenario.rationale && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setExpandedRationaleId(expandedRationaleId === scenario.id ? null : scenario.id); }}
                          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors font-medium border-none bg-transparent p-0 cursor-pointer w-full text-left"
                        >
                          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", expandedRationaleId === scenario.id && "rotate-90")} />
                          Why did the agent recommend this?
                        </button>
                        {expandedRationaleId === scenario.id && (
                          <p className="mt-3 text-xs leading-relaxed text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 text-left">
                            {scenario.rationale}
                          </p>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Execution Steps */}
          {selectedScenario && selectedScenario.isRecommended && incident.executionSteps && incident.executionSteps.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 mt-4 shadow-inner">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Execution Steps</h3>
              <ul className="space-y-3">
                {incident.executionSteps.map((step, idx) => (
                  <li key={idx} className="flex gap-3 text-sm text-slate-700 items-start">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#DB033B]/10 text-[#DB033B] flex items-center justify-center font-bold text-xs">{idx + 1}</span>
                    <span className="mt-0.5 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Execution Trigger */}
          {selectedScenario && (
            <div className="mt-auto pt-4 border-t border-slate-200 flex justify-end">
              <button className="bg-[#DB033B] hover:opacity-90 text-white font-bold py-3 px-8 rounded-lg text-sm transition-opacity flex items-center justify-center gap-3 shadow-md focus:ring-4 focus:ring-[#DB033B]/20">
                Execute {selectedScenario.name.split(':')[0]} via SAP BAPI <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

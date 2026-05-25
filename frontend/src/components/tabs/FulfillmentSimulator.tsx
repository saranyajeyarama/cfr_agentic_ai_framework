import { Activity, AlertTriangle, ArrowRight, ShieldAlert, ChevronRight, CheckCircle2, Loader2, Truck, Clock, Building2 } from 'lucide-react';
import { Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { buildStartSessionRequest } from '../../lib/api';
import {
  type FulfillmentIncident,
  type FulfillmentScenario,
  type IncidentsState,
  type ScenarioMap,
  runFulfillmentSimulate,
} from '../../lib/fulfillment';

export function FulfillmentSimulator({
  incidentsStore,
  scenariosMap,
  setScenariosMap,
}: {
  incidentsStore: {
    state: IncidentsState;
    load: (force?: boolean) => Promise<void>;
  };
  scenariosMap: ScenarioMap;
  setScenariosMap: React.Dispatch<React.SetStateAction<ScenarioMap>>;
}) {
  const { state: incidentsState, load: loadIncidents } = incidentsStore;
  const INCIDENTS = incidentsState.incidents;

  // Lazy-load the incident list the first time the tab mounts. Subsequent
  // tab switches are no-ops because the store already has data.
  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  const [activeIncidentId, setActiveIncidentId] = useState<string>('');
  const [expandedRationaleId, setExpandedRationaleId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // When the incident list arrives, default to the first row.
  useEffect(() => {
    if (!activeIncidentId && INCIDENTS.length > 0) {
      setActiveIncidentId(INCIDENTS[0].id);
    }
  }, [INCIDENTS, activeIncidentId]);

  const incident: FulfillmentIncident | undefined =
    INCIDENTS.find(i => i.id === activeIncidentId) || INCIDENTS[0];

  // On incident select, kick off the optimizer if we don't already have
  // cached scenarios for it.
  useEffect(() => {
    if (!incident) return;
    const entry = scenariosMap[incident.id];
    if (entry && (entry.status === 'done' || entry.status === 'loading')) return;
    void runFulfillmentSimulate(incident, setScenariosMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident?.id]);

  const scenariosEntry = incident ? scenariosMap[incident.id] : undefined;
  const scenarios: FulfillmentScenario[] = scenariosEntry?.scenarios ?? [];
  const isLoadingScenarios = scenariosEntry?.status === 'loading';
  const scenarioError = scenariosEntry?.status === 'error' ? scenariosEntry.error : undefined;
  const noAlternateReason = (scenariosEntry?.meta as any)?.no_alternate_reason as string | undefined;

  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  useEffect(() => {
    // Default selection: recommended if present, else the first.
    if (scenarios.length === 0) { setSelectedScenarioId(''); return; }
    const rec = scenarios.find(s => s.isRecommended);
    setSelectedScenarioId((rec ?? scenarios[0]).id);
  }, [scenariosEntry?.status, scenarios.length, incident?.id]);

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);

  const handleIncidentClick = (id: string) => {
    setActiveIncidentId(id);
    setExecuteResult(null);
  };

  const handleExecute = async () => {
    if (!incident || !selectedScenario || isExecuting) return;
    setIsExecuting(true);
    setExecuteResult(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildStartSessionRequest(
            {
              soldTo: incident.soldTo,
              materialNumber: incident.materialNumber,
              requestedQty: incident.orderedQty ?? 1000,
              mabd: incident.mabd,
              customerName: incident.customer,
              materialDescription: incident.skuName,
              referenceNumber: `INC-${incident.id}-${selectedScenario.id}`,
            },
            'manual',
          ),
        ),
      });
      if (res.ok) {
        const data = await res.json();
        setExecuteResult({
          type: 'success',
          message: `Session ${data.session_id} started. Agents are processing ${selectedScenario.name}.`,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setExecuteResult({ type: 'error', message: err.detail || `Server error ${res.status}` });
      }
    } catch {
      setExecuteResult({
        type: 'error',
        message: 'Backend unreachable — connect to backend to enable live execution.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Empty / loading states for the whole tab.
  if (incidentsState.status === 'loading' && INCIDENTS.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading at-risk approved orders…
      </div>
    );
  }
  if (incidentsState.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center text-red-600 text-sm">
        Failed to load incidents: {incidentsState.error}
      </div>
    );
  }
  if (INCIDENTS.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-slate-500 text-sm gap-2">
        <Activity className="w-6 h-6 text-slate-300" />
        No at-risk approved orders. Approve orders in Order Triage first; the simulator only operates on accepted (ACCEPT) or modified (PARTIAL_FULFILL) orders.
      </div>
    );
  }
  if (!incident) return null;

  const isDemoSeed = Boolean(incidentsState.meta?.fallback_demo_seed);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Multi-Agent Fulfillment Simulator</h2>
          <p className="text-xs text-slate-500">
            LP-optimized routing for approved orders
            {isDemoSeed
              ? ' · demo seed (no Order Triage approvals in the last 30 days)'
              : ' · live data'}
          </p>
        </div>
        <span className={cn(
          'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded',
          isDemoSeed
            ? 'bg-amber-100 text-amber-800 border border-amber-200'
            : 'bg-emerald-100 text-emerald-800 border border-emerald-200',
        )}>
          {isDemoSeed ? 'Demo Seed' : 'Live'}
        </span>
      </div>

      {isDemoSeed && (
        <div className="mx-8 mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 leading-relaxed">
          <strong>Heads up:</strong> the incident list is seeded from historical OTIF failures because no orders have been
          <em> accepted</em> or <em>modified</em> in Order Triage in the last 30 days. Approve a PO in Order Triage and it
          will surface here. <strong>Scenarios shown for each incident are real LP output</strong> against live BigQuery
          inventory + chargeback data — they are not mock.
        </div>
      )}

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
                {(item.originPlant || item.avgTransitHours) && (
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
                    {item.originPlant && (
                      <span className="flex items-center gap-0.5">
                        <Building2 className="w-3 h-3" /> {item.originPlant}{item.originPlantCity ? ` (${item.originPlantCity})` : ''}
                      </span>
                    )}
                    {item.avgTransitHours != null && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" /> ~{item.avgTransitHours}h
                      </span>
                    )}
                  </div>
                )}
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
                 <div className="min-w-0 flex-1">
                   <div className="font-bold text-slate-800">{incident.customer} — {incident.skuName}</div>
                   <div className="text-sm text-slate-600 mt-1 leading-relaxed break-words">
                     {incident.description}
                   </div>
                   {/* Origin plant & transit context from dim_plant + fct_shipments */}
                   {(incident.originPlantName || incident.avgTransitHours || incident.primaryCarrier) && (
                     <div className="mt-3 flex items-center gap-3 text-xs">
                       <div className="flex items-center gap-1.5 bg-blue-50 text-blue-800 px-2.5 py-1 rounded-lg border border-blue-100">
                         <Building2 className="w-3.5 h-3.5" />
                         <span className="font-bold">{incident.originPlant}</span>
                         {incident.originPlantName && <span className="text-blue-600">({incident.originPlantCity ? `${incident.originPlantCity}` : incident.originPlantName}{incident.originPlantType ? ` ${incident.originPlantType === 'Manufacturing' ? 'Mfg' : incident.originPlantType}` : ''})</span>}
                       </div>
                       {incident.avgTransitHours != null && (
                         <div className="flex items-center gap-1.5 bg-indigo-50 text-indigo-800 px-2.5 py-1 rounded-lg border border-indigo-100">
                           <Clock className="w-3.5 h-3.5" />
                           <span className="font-bold">~{incident.avgTransitHours}h</span>
                           <span className="text-indigo-600">avg transit</span>
                         </div>
                       )}
                       {incident.primaryCarrier && (
                         <div className="flex items-center gap-1.5 bg-violet-50 text-violet-800 px-2.5 py-1 rounded-lg border border-violet-100">
                           <Truck className="w-3.5 h-3.5" />
                           <span className="font-bold">{incident.primaryCarrier}</span>
                         </div>
                       )}
                       {incident.recentFillRate != null && (
                         <div className={cn(
                           "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border",
                           incident.recentFillRate >= 90
                             ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                             : incident.recentFillRate >= 70
                               ? "bg-amber-50 text-amber-800 border-amber-100"
                               : "bg-red-50 text-red-800 border-red-100"
                         )}>
                           <span className="font-bold">{incident.recentFillRate}%</span>
                           <span>fill rate</span>
                         </div>
                       )}
                     </div>
                   )}
                   {/* Real OTIF metrics from BigQuery */}
                   <div className="mt-3 grid grid-cols-4 gap-3 text-center">
                     <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                       <div className="text-lg font-black font-mono text-slate-800">{incident.recentFails ?? 0}<span className="text-xs text-slate-400 font-normal">/{incident.totalDeliveries ?? 0}</span></div>
                       <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Fails (90d)</div>
                     </div>
                     <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                       <div className="text-lg font-black font-mono text-slate-800">{incident.maxDaysLate ?? 0}d</div>
                       <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Max Late</div>
                     </div>
                     <div className="bg-slate-50 rounded-lg p-2 border border-slate-100 overflow-hidden">
                       <div
                         className="text-sm font-bold text-slate-800 truncate leading-snug"
                         title={incident.lastRootCause ?? 'N/A'}
                       >
                         {incident.lastRootCause
                           ? incident.lastRootCause.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                           : 'N/A'}
                       </div>
                       <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mt-0.5">Root Cause</div>
                     </div>
                     <div className="bg-slate-50 rounded-lg p-2 border border-slate-100 overflow-hidden">
                       <div
                         className="text-sm font-bold text-slate-800 truncate leading-snug"
                         title={incident.mabdEnforcement ?? 'N/A'}
                       >
                         {incident.mabdEnforcement
                           ? incident.mabdEnforcement.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                           : 'N/A'}
                       </div>
                       <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mt-0.5">Enforcement</div>
                     </div>
                   </div>
                 </div>
              </div>
            </div>

            <div className="col-span-1 bg-white border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center relative shadow-sm">
               <div className="absolute top-4 w-full flex justify-center">
                   <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center">OTIF Fail Rate (90d)</h3>
               </div>
               <div className="relative w-32 h-32 mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Fail', value: incident.riskProbability, fill: '#ef4444' },
                          { name: 'Pass', value: 100 - incident.riskProbability, fill: '#f1f5f9' }
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
                    <span className="text-[10px] uppercase text-[#DB033B]/80 font-bold">Fail Rate</span>
                  </div>
               </div>

               <div className="text-center mt-2">
                 <div className="text-xs text-slate-500 font-medium">Fine At Risk</div>
                 <div className="text-lg font-mono font-bold text-[#DB033B]">${incident.fineAtRisk.toLocaleString()}</div>
               </div>
               {incident.otifAggressive && (
                 <div className="mt-1 text-[10px] font-bold text-[#DB033B] bg-[#DB033B]/5 px-2 py-0.5 rounded border border-[#DB033B]/20 uppercase tracking-wider">
                   Aggressive Penalty Program
                 </div>
               )}
            </div>
          </div>

          {/* Risk Detail Panel — real data from BigQuery */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-end mb-2">
              <div className="text-3xl font-bold font-mono flex items-baseline gap-2">
                {incident.riskProbability}%
                <span className="text-sm font-sans font-bold text-slate-500 uppercase tracking-widest">OTIF Fail Rate</span>
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
                  incident.riskProbability <= 15 ? "bg-emerald-500" :
                  incident.riskProbability <= 30 ? "bg-amber-500" : "bg-[#DB033B]"
                )}
                style={{ width: `${Math.min(incident.riskProbability, 100)}%` }}
              ></div>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{incident.otifRulebook}</p>
            {/* Chargeback breakdown */}
            {(incident.chargebackCount ?? 0) > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-sm font-bold font-mono text-slate-800">{incident.chargebackCount}</div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Total Chargebacks</div>
                </div>
                <div>
                  <div className="text-sm font-bold font-mono text-slate-800">${(incident.avgChargebackUsd ?? 0).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Avg Per Incident</div>
                </div>
                <div>
                  <div className="text-sm font-bold font-mono text-[#DB033B]">${(incident.totalChargebackUsd ?? 0).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Total Chargebacks $</div>
                </div>
              </div>
            )}
          </div>

          {/* Scenario Comparison Matrix — Live LP output */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent Resolution Strategies</h3>
              {isLoadingScenarios && (
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Running optimizer…
                </span>
              )}
            </div>

            {scenarioError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                Optimizer error: {scenarioError}
              </div>
            )}
            {!scenarioError && !isLoadingScenarios && scenarios.length === 0 && (
              <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-lg p-3 mb-3">
                No scenarios returned for this incident.
              </div>
            )}
            {noAlternateReason && (
              <div className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <span className="font-bold text-amber-700">No alternate route: </span>
                {noAlternateReason}
              </div>
            )}

            <div className={cn(
              "grid gap-6 relative",
              scenarios.length <= 1 ? "grid-cols-1" : "grid-cols-2",
            )}>
              {scenarios.map((scenario) => {
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
                        <span className={cn("font-medium", isRecommended ? "text-[#DB033B]" : "text-slate-600")}>DC Source</span>
                        <span className="text-slate-800 font-mono font-medium text-right max-w-[60%]">{scenario.dcSource}</span>
                      </li>
                      {scenario.transitHours != null && (
                        <li className={cn("flex justify-between border-b pb-2", isRecommended ? "border-[#DB033B]/20" : "border-slate-100")}>
                          <span className={cn("font-medium flex items-center gap-1", isRecommended ? "text-[#DB033B]" : "text-slate-600")}>
                            <Clock className="w-3 h-3" /> Transit Time
                          </span>
                          <span className="text-slate-800 font-mono font-medium">~{scenario.transitHours}h</span>
                        </li>
                      )}
                      {scenario.carrierName && (
                        <li className={cn("flex justify-between border-b pb-2", isRecommended ? "border-[#DB033B]/20" : "border-slate-100")}>
                          <span className={cn("font-medium flex items-center gap-1", isRecommended ? "text-[#DB033B]" : "text-slate-600")}>
                            <Truck className="w-3 h-3" /> Carrier
                          </span>
                          <span className="text-slate-800 font-medium">{scenario.carrierName}</span>
                        </li>
                      )}
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
                          Why did the optimizer recommend this?
                        </button>
                        {expandedRationaleId === scenario.id && (
                          <div className="mt-3 text-xs text-left space-y-2">
                            <p className="leading-relaxed text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                              {scenario.rationale}
                            </p>
                            {/* Per-plant breakdown from dim_plant + fct_shipments */}
                            {scenario.plantDetails && scenario.plantDetails.length > 0 && (
                              <div className="bg-slate-50 rounded-lg border border-slate-100 overflow-hidden">
                                <div className="px-3 py-1.5 bg-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                  Sourcing Breakdown
                                </div>
                                <div className="divide-y divide-slate-100">
                                  {scenario.plantDetails.map((pd: any) => (
                                    <div key={pd.code} className="px-3 py-2 flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                        <div>
                                          <span className="font-bold text-slate-700">{pd.code}</span>
                                          {(pd.city || pd.name) && (
                                            <span className="text-slate-500 ml-1">
                                              ({pd.city || pd.name}{pd.type ? ` · ${pd.type === 'Manufacturing' ? 'Mfg' : pd.type}` : ''})
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-3 text-right">
                                        <span className="font-mono font-bold text-slate-800">{pd.qty?.toLocaleString()} cs</span>
                                        {pd.transitHours != null && (
                                          <span className="text-slate-500 flex items-center gap-0.5">
                                            <Clock className="w-3 h-3" /> ~{pd.transitHours}h
                                          </span>
                                        )}
                                        {pd.carrier && (
                                          <span className="text-slate-500 flex items-center gap-0.5">
                                            <Truck className="w-3 h-3" /> {pd.carrier}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Execution Trigger */}
          {selectedScenario && (
            <div className="mt-auto pt-4 border-t border-slate-200 space-y-3">
              {executeResult && (
                <div className={cn(
                  'px-4 py-3 rounded-lg text-sm font-medium',
                  executeResult.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border border-red-200 text-red-800'
                )}>
                  {executeResult.message}
                </div>
              )}
              <div className="flex justify-end">
                <button
                  disabled={isExecuting}
                  onClick={handleExecute}
                  className="bg-[#DB033B] hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-lg text-sm transition-opacity flex items-center justify-center gap-3 shadow-md focus:ring-4 focus:ring-[#DB033B]/20">
                  {isExecuting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting Session…</>
                    : <>Execute {selectedScenario.name.split(':')[0]} via SAP BAPI <ArrowRight className="w-5 h-5" /></>
                  }
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

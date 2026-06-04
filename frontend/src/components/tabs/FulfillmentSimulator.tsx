import type { Dispatch, SetStateAction } from 'react';
import {
  Activity, AlertTriangle, ShieldAlert, ChevronRight, CheckCircle2, Loader2,
  Truck, Clock, Building2, Terminal, Sparkles, ArrowRight, Boxes,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { simulateFulfillment, recommendFulfillment } from '../../lib/api';
import type { FulfillmentRecommendation } from '../../lib/types';
import {
  type FulfillmentIncident,
  type FulfillmentScenario,
  type PlantDetail,
  type IncidentsState,
  type ScenarioMap,
  runFulfillmentSimulate,
} from '../../lib/fulfillment';

// =============================================================================
// Helpers
// =============================================================================

type PlantInv = { ending: number; committed: number; available: number };

/** Sum the per-plant allocation for a scenario (its fulfilled quantity). */
function scenarioFulfillQty(s: FulfillmentScenario, orderedQty: number): number {
  if (s.plantDetails && s.plantDetails.length > 0) {
    return s.plantDetails.reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
  }
  // No split detail: a no-fine scenario fills the order; a fined one is short.
  return s.fine > 0 ? 0 : orderedQty;
}

/** Pull the known plant codes from the optimizer meta so we can match
 *  free-text sourcing constraints against real DC identifiers. */
function knownPlantsFromMeta(meta: Record<string, unknown> | undefined): string[] {
  const inv = (meta?.inventory_by_plant as Record<string, PlantInv> | undefined) ?? {};
  return Object.keys(inv);
}

/** Parse "Exclude DC-CA-03 from sourcing pool", "don't use US02", etc. into a
 *  blocked_plants list, matching against the real plant codes the optimizer
 *  knows about (hyphen/spacing/case-insensitive). */
function parseBlockedPlants(text: string, knownPlants: string[]): string[] {
  if (!text.trim()) return [];
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const haystack = norm(text);
  return knownPlants.filter((p) => haystack.includes(norm(p)));
}

// =============================================================================
// Component
// =============================================================================

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
  setScenariosMap: Dispatch<SetStateAction<ScenarioMap>>;
}) {
  const { state: incidentsState, load: loadIncidents } = incidentsStore;
  const INCIDENTS = incidentsState.incidents;

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  const [activeIncidentId, setActiveIncidentId] = useState<string>('');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [appliedPlan, setAppliedPlan] = useState<{ incidentId: string; scenarioName: string; at: string } | null>(null);

  // Dynamic Sourcing Constraints (re-simulate with blocked plants).
  const [constraintText, setConstraintText] = useState('');
  const [reSim, setReSim] = useState<{
    incidentId: string;
    status: 'loading' | 'done' | 'error';
    scenarios?: FulfillmentScenario[];
    meta?: Record<string, unknown>;
    blocked?: string[];
    error?: string;
  } | null>(null);

  // Agentic recommendation (on-demand, per incident). The LLM (or rule
  // fallback) picks the scenario + writes the rationale.
  const [recMap, setRecMap] = useState<Record<string, {
    status: 'loading' | 'done' | 'error';
    rec?: FulfillmentRecommendation;
    error?: string;
  }>>({});

  useEffect(() => {
    if (!activeIncidentId && INCIDENTS.length > 0) setActiveIncidentId(INCIDENTS[0].id);
  }, [INCIDENTS, activeIncidentId]);

  const incident: FulfillmentIncident | undefined =
    INCIDENTS.find((i) => i.id === activeIncidentId) || INCIDENTS[0];

  // Kick off the optimizer when an incident is selected (cached per incident).
  useEffect(() => {
    if (!incident) return;
    const entry = scenariosMap[incident.id];
    if (entry && (entry.status === 'done' || entry.status === 'loading')) return;
    void runFulfillmentSimulate(incident, setScenariosMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident?.id]);

  const baseEntry = incident ? scenariosMap[incident.id] : undefined;

  // Prefer a re-simulated (constraint-applied) result for THIS incident.
  const usingReSim = !!reSim && reSim.incidentId === incident?.id && reSim.status === 'done';
  const scenarios: FulfillmentScenario[] = usingReSim
    ? reSim!.scenarios ?? []
    : baseEntry?.scenarios ?? [];
  const meta: Record<string, unknown> = (usingReSim ? reSim!.meta : baseEntry?.meta) ?? {};
  const isLoadingScenarios = baseEntry?.status === 'loading';
  const scenarioError = baseEntry?.status === 'error' ? baseEntry.error : undefined;

  // Default scenario selection: recommended, else first.
  useEffect(() => {
    if (scenarios.length === 0) { setSelectedScenarioId(''); return; }
    const rec = scenarios.find((s) => s.isRecommended);
    setSelectedScenarioId((rec ?? scenarios[0]).id);
  }, [baseEntry?.status, scenarios.length, incident?.id, usingReSim]);

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);
  // Agentic verdict for this incident (if "Evaluate with AI" was run).
  const recEntry = incident ? recMap[incident.id] : undefined;
  const agentRec = recEntry?.status === 'done' ? recEntry.rec : undefined;
  // Resolve the recommended scenario: agent verdict first, then the
  // optimizer's lpPreferred / isRecommended, then the default (scenarios[0]).
  const recommended =
    (agentRec && scenarios.find((s) => s.id === agentRec.recommended_scenario_id)) ??
    scenarios.find((s) => s.isRecommended) ??
    scenarios.find((s) => s.lpPreferred) ??
    scenarios[0];

  const orderedQty = incident?.orderedQty ?? 0;
  const inventoryByPlant = (meta.inventory_by_plant as Record<string, PlantInv> | undefined) ?? {};
  const freightCosts = (meta.freight_costs_used as Record<string, number> | undefined) ?? {};
  const elapsedMs = (meta.elapsed_ms as number | undefined) ?? null;
  const originPlant = (meta.origin_plant as string | undefined) ?? incident?.originPlant ?? '';
  const customerRegion = (meta.customer_region as string | undefined) ?? '';
  const penaltyPerCase = (meta.penalty_per_case as number | undefined) ?? null;
  const knownPlants = useMemo(() => knownPlantsFromMeta(meta), [meta]);

  // The recommended scenario's split = the "AI Split Sourcing Plan".
  const splitPlan: PlantDetail[] = recommended?.plantDetails ?? [];
  const splitByCode = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of splitPlan) m[p.code] = (m[p.code] ?? 0) + (Number(p.qty) || 0);
    return m;
  }, [splitPlan]);

  const handleIncidentClick = (id: string) => {
    setActiveIncidentId(id);
    setAppliedPlan(null);
    setConstraintText('');
    setReSim(null);
  };

  const handleApplyConstraints = async () => {
    if (!incident || !incident.soldTo || !incident.materialNumber || !incident.orderedQty) return;
    const blocked = parseBlockedPlants(constraintText, knownPlants);
    // The candidate set changes → any prior agent verdict is stale.
    setRecMap((prev) => {
      const next = { ...prev };
      delete next[incident.id];
      return next;
    });
    setReSim({ incidentId: incident.id, status: 'loading', blocked });
    try {
      const body = await simulateFulfillment({
        sold_to: incident.soldTo,
        material_number: incident.materialNumber,
        ordered_quantity_cases: incident.orderedQty,
        requested_delivery_date: incident.mabd ?? null,
        origin_plant: incident.originPlant ?? null,
        blocked_plants: blocked,
      });
      setReSim({
        incidentId: incident.id,
        status: 'done',
        scenarios: (body.scenarios ?? []) as FulfillmentScenario[],
        meta: body.meta ?? {},
        blocked,
      });
    } catch (e) {
      setReSim({
        incidentId: incident.id,
        status: 'error',
        blocked,
        error: e instanceof Error ? e.message : 'Re-simulate failed',
      });
    }
  };

  const handleUseRecommendation = () => {
    if (recommended) setSelectedScenarioId(recommended.id);
  };

  // Agentic recommendation — on-demand. Sends the already-computed scenarios +
  // risk/penalty/tier context to the agent (rule fallback when Vertex is down).
  const runRecommend = async (force = false) => {
    if (!incident || scenarios.length === 0) return;
    const id = incident.id;
    setRecMap((prev) => ({ ...prev, [id]: { status: 'loading' } }));
    try {
      const res = await recommendFulfillment(
        {
          incident_id: id,
          sold_to: incident.soldTo ?? '',
          material_number: incident.materialNumber ?? '',
          ordered_quantity_cases: incident.orderedQty ?? 0,
          scenarios: scenarios as unknown as never,
          context: {
            penalty_per_case: penaltyPerCase,
            single_source_possible: (meta as Record<string, unknown>).single_source_possible,
            plants_opened: (meta as Record<string, unknown>).plants_opened,
            customer: incident.customer,
            priority_tier: incident.otifProgram,
            otifTarget: incident.otifTarget,
            otifFailRate: incident.otifFailRate,
            recentFails: incident.recentFails,
            totalDeliveries: incident.totalDeliveries,
            maxDaysLate: incident.maxDaysLate,
            avgChargebackUsd: incident.avgChargebackUsd,
            totalChargebackUsd: incident.totalChargebackUsd,
            chargebackCount: incident.chargebackCount,
            mabd: incident.mabd,
            mabdEnforcement: incident.mabdEnforcement,
            otifAggressive: incident.otifAggressive,
          },
        },
        force,
      );
      setRecMap((prev) => ({ ...prev, [id]: { status: 'done', rec: res.recommendation } }));
      setSelectedScenarioId(res.recommendation.recommended_scenario_id);
    } catch (e) {
      setRecMap((prev) => ({
        ...prev,
        [id]: { status: 'error', error: e instanceof Error ? e.message : 'Recommendation failed' },
      }));
    }
  };

  const handleExecute = () => {
    if (!incident || !selectedScenario) return;
    setAppliedPlan({ incidentId: incident.id, scenarioName: selectedScenario.name, at: new Date().toISOString() });
  };

  // ── tab-level empty/loading/error ───────────────────────────────────────────
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
        No at-risk approved orders. Approve orders in Order Triage first.
      </div>
    );
  }
  if (!incident) return null;

  const isDemoSeed = Boolean(incidentsState.meta?.fallback_demo_seed);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Fulfillment Incidents</h2>
          <p className="text-xs text-slate-500">Active risks — by fine exposure · LP-optimized multi-DC sourcing</p>
        </div>
        <span className={cn(
          'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded',
          isDemoSeed ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200',
        )}>
          {isDemoSeed ? 'Demo Seed' : 'Live'}
        </span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left rail: incidents queue */}
        <div className="w-80 border-r border-slate-200 bg-white/50 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-slate-200 bg-slate-100/50">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active Incidents Queue</h3>
            <p className="text-[10px] text-slate-400 mt-1">{INCIDENTS.length} at-risk orders</p>
          </div>
          <div className="flex flex-col p-2 gap-2">
            {INCIDENTS.map((item) => (
              <button
                key={item.id}
                onClick={() => handleIncidentClick(item.id)}
                className={cn(
                  'p-4 rounded-xl border text-left transition-all duration-200',
                  activeIncidentId === item.id
                    ? 'bg-white border-[#DB033B] shadow-md ring-1 ring-[#DB033B]/20'
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm',
                )}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{item.customer}</span>
                  <span className="text-[11px] font-bold text-[#DB033B]">${item.fineAtRisk.toLocaleString()} at risk</span>
                </div>
                <h4 className="text-sm font-bold text-slate-800 leading-tight mb-2">{item.skuName}</h4>
                {/* risk-probability bar */}
                <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', item.riskProbability >= 60 ? 'bg-[#DB033B]' : item.riskProbability >= 30 ? 'bg-amber-500' : 'bg-emerald-500')}
                    style={{ width: `${Math.min(item.riskProbability, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-400 mt-1">Risk probability: {item.riskProbability}%</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel: redesigned simulator */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

          {/* 1 — Dynamic Sourcing Constraints */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[#DB033B]" />
              <h3 className="text-sm font-bold text-slate-800">Dynamic Sourcing Constraints</h3>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Inject manual conditions. The multi-agent engine re-routes, recalculates the fulfillment array,
              and updates the execution plan natively.
            </p>
            <div className="flex gap-3 items-stretch">
              <textarea
                value={constraintText}
                onChange={(e) => setConstraintText(e.target.value)}
                placeholder={`e.g. "Exclude ${knownPlants[0] ?? 'DC-CA-03'} from sourcing pool" or "Do not use contracted preferred carriers"`}
                className="flex-1 resize-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-[#DB033B] focus:ring-1 focus:ring-[#DB033B] min-h-[44px]"
                rows={1}
              />
              <button
                onClick={handleApplyConstraints}
                disabled={reSim?.status === 'loading' || !incident.soldTo}
                className="shrink-0 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold px-5 rounded-lg transition-colors flex items-center gap-2"
              >
                {reSim?.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                Apply &amp; Re-Simulate
              </button>
            </div>
            {reSim && reSim.incidentId === incident.id && (
              <div className="mt-2 text-[11px]">
                {reSim.status === 'done' && (
                  <span className="text-emerald-700">
                    Re-simulated{reSim.blocked && reSim.blocked.length > 0
                      ? <> with <span className="font-mono font-bold">{reSim.blocked.join(', ')}</span> excluded from the sourcing pool.</>
                      : ' (no recognized plant codes in the constraint — ran with the full pool).'}
                  </span>
                )}
                {reSim.status === 'error' && <span className="text-red-600">Re-simulate failed: {reSim.error}</span>}
              </div>
            )}
          </div>

          {/* 1b — Resolution metrics summary (recommended scenario, at a glance) */}
          {recommended && (
            (() => {
              const recFulfill = scenarioFulfillQty(recommended, orderedQty);
              const fillPct = orderedQty > 0 ? Math.round((recFulfill / orderedQty) * 100) : 0;
              const tiles: { label: string; value: string; tone?: 'red' | 'green' | 'slate' }[] = [
                { label: 'Ordered', value: `${orderedQty.toLocaleString()} cs`, tone: 'slate' },
                { label: 'Recommended Fulfill', value: `${recFulfill.toLocaleString()} cs · ${fillPct}%`, tone: 'slate' },
                { label: 'Freight Cost', value: `$${recommended.freightCost.toLocaleString()}`, tone: 'slate' },
                { label: 'Fine / Penalty', value: recommended.fine > 0 ? `-$${recommended.fine.toLocaleString()}` : '$0', tone: recommended.fine > 0 ? 'red' : 'slate' },
                { label: 'Net Impact', value: recommended.netImpact < 0 ? `-$${Math.abs(recommended.netImpact).toLocaleString()}` : `$${recommended.netImpact.toLocaleString()}`, tone: recommended.netImpact < 0 ? 'red' : 'green' },
                { label: 'Saves vs Default', value: recommended.savingsVsDefault > 0 ? `$${recommended.savingsVsDefault.toLocaleString()}` : '$0', tone: recommended.savingsVsDefault > 0 ? 'green' : 'slate' },
              ];
              return (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-3.5 h-3.5 text-[#DB033B]" />
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                      Resolution Summary
                    </h3>
                    <span className="text-[10px] text-slate-400">· {recommended.name}</span>
                    {usingReSim && (
                      <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                        Constraint-adjusted
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {tiles.map((t) => (
                      <div key={t.label} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">{t.label}</div>
                        <div className={cn(
                          'font-mono font-bold text-sm',
                          t.tone === 'red' ? 'text-[#DB033B]' : t.tone === 'green' ? 'text-emerald-600' : 'text-slate-800',
                        )}>
                          {t.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()
          )}

          {/* 2 — Transportation Agent tool-call terminal */}
          <div className="rounded-xl overflow-hidden border border-slate-800 shadow-sm bg-[#0f1117]">
            <div className="flex items-center justify-between px-4 py-2 bg-[#161922] border-b border-slate-800">
              <div className="flex items-center gap-2 text-[11px] font-mono font-bold tracking-wide text-sky-400">
                <Terminal className="w-3.5 h-3.5" />
                TRANSPORTATION AGENT · TOOL_CALL: CALL_SHIPMENT_OPTIMIZER
              </div>
              <span className="text-[10px] font-mono text-emerald-400">
                {isLoadingScenarios ? 'running…' : elapsedMs != null ? `✓ ${elapsedMs}ms` : '✓'}
              </span>
            </div>
            <div className="px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-300 space-y-2">
              <div>
                <span className="text-slate-500">Input:</span>
                <div className="text-amber-300 break-all">
                  {JSON.stringify({
                    sold_to: incident.soldTo,
                    origin_dc: originPlant || null,
                    destination_customer: incident.customer,
                    qty_cs: orderedQty,
                    mabd: incident.mabd ?? null,
                    fine_per_cs_late: penaltyPerCase,
                    blocked_plants: usingReSim ? (reSim?.blocked ?? []) : [],
                    scenario_count: scenarios.length,
                  })}
                </div>
              </div>
              <div>
                <span className="text-slate-500">Output:</span>
                {isLoadingScenarios ? (
                  <div className="text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> optimizing…</div>
                ) : (
                  <div className="text-emerald-300 space-y-0.5">
                    <div>- {scenarios.length} ranked fulfillment scenario{scenarios.length === 1 ? '' : 's'} generated</div>
                    {recommended && <div>- Recommended: "{recommended.name}"</div>}
                    {recommended && recommended.savingsVsDefault > 0 && (
                      <div>- Net saving vs default: ${recommended.savingsVsDefault.toLocaleString()}</div>
                    )}
                    {(meta.solver_status as string | undefined) && (
                      <div>- Solver: {String(meta.solver_status)}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3 — Risk header bar */}
          <div className="rounded-xl bg-[#1e2430] text-white px-6 py-5 flex items-start justify-between shadow-sm">
            <div className="min-w-0">
              <h3 className="text-lg font-bold">{incident.title}</h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed max-w-2xl">{incident.description}</p>
            </div>
            <div className="text-right pl-6 shrink-0">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Fine at Risk</div>
              <div className="text-3xl font-black font-mono text-[#ff5277]">${incident.fineAtRisk.toLocaleString()}</div>
              <div className="text-[10px] text-slate-400 mt-1">{incident.riskProbability}% probability</div>
            </div>
          </div>

          {/* 4 — Scenario columns */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent Resolution Strategies</h3>
              {isLoadingScenarios && (
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Running optimizer…</span>
              )}
            </div>

            {scenarioError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">Optimizer error: {scenarioError}</div>
            )}

            {scenarios.length > 0 && (
              <div className={cn('grid gap-4', scenarios.length >= 3 ? 'grid-cols-3' : scenarios.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
                {scenarios.map((s) => {
                  const isSel = selectedScenarioId === s.id;
                  const isRec = s.isRecommended;
                  const fulfill = scenarioFulfillQty(s, orderedQty);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedScenarioId(s.id)}
                      className={cn(
                        'text-left rounded-xl p-5 relative overflow-hidden transition-all duration-200 outline-none border-2',
                        isSel
                          ? (isRec ? 'border-[#DB033B] bg-[#DB033B]/5 ring-4 ring-[#DB033B]/10 shadow-md' : 'border-slate-800 bg-white ring-4 ring-slate-800/10 shadow-md')
                          : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm opacity-80 hover:opacity-100',
                      )}
                    >
                      {isRec && (
                        <div className="absolute top-0 right-0 bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-bl-lg flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" /> AI Recommended
                        </div>
                      )}
                      <div className={cn('text-base font-bold mb-1 pr-20', isRec ? 'text-[#DB033B]' : 'text-slate-800')}>{s.name}</div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-4">{s.tagline}</div>

                      <ul className="space-y-2.5 text-sm">
                        <li className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500 font-medium">Fulfill Qty</span>
                          <span className="font-mono font-bold text-slate-800">{fulfill.toLocaleString()} cs</span>
                        </li>
                        <li className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500 font-medium">Freight Cost</span>
                          <span className="font-mono text-slate-800">${s.freightCost.toLocaleString()}</span>
                        </li>
                        <li className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500 font-medium flex items-center gap-1">
                            Fine / Penalty {s.fine > 0 && <ShieldAlert className="w-3 h-3 text-[#DB033B]" />}
                          </span>
                          <span className={cn('font-mono font-bold', s.fine > 0 ? 'text-[#DB033B]' : 'text-slate-400')}>
                            {s.fine > 0 ? `-$${s.fine.toLocaleString()}` : '$0'}
                          </span>
                        </li>
                        <li className="flex justify-between pt-1">
                          <span className="text-slate-600 font-bold uppercase text-[11px] tracking-wider">Net Impact</span>
                          <span className={cn('font-mono font-black', s.netImpact < 0 ? 'text-[#DB033B]' : 'text-emerald-600')}>
                            {s.netImpact < 0 ? `-$${Math.abs(s.netImpact).toLocaleString()}` : `$${s.netImpact.toLocaleString()}`}
                          </span>
                        </li>
                      </ul>

                      <div className={cn('mt-4 rounded-lg px-3 py-2 text-center', s.savingsVsDefault > 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50 border border-slate-100')}>
                        <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Saves vs default </span>
                        <span className={cn('font-mono font-bold', s.savingsVsDefault > 0 ? 'text-emerald-700' : 'text-slate-400')}>
                          {s.savingsVsDefault > 0 ? `$${s.savingsVsDefault.toLocaleString()}` : '$0'}
                        </span>
                      </div>

                      {isSel && (
                        <div className="mt-3 flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                          <CheckCircle2 className="w-3 h-3" /> Selected
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 5 — AI Rationale + Execution Steps */}
          {selectedScenario && (
            <div className="grid grid-cols-2 gap-5">
              <div className={cn(
                'bg-white border rounded-xl p-5 shadow-sm',
                agentRec ? 'border-[#DB033B]/40' : 'border-slate-200',
              )}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    AI Rationale{agentRec ? '' : ` — ${selectedScenario.name}`}
                  </h4>
                  {agentRec && (
                    <span className={cn(
                      'text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
                      agentRec.recommendation_source === 'agent'
                        ? 'bg-[#DB033B]/10 text-[#DB033B] border-[#DB033B]/30'
                        : 'bg-slate-100 text-slate-600 border-slate-200',
                    )}>
                      {agentRec.recommendation_source === 'agent' ? 'Agentic' : 'Rule-based'}
                      {' · '}{Math.round((agentRec.confidence || 0) * 100)}%
                    </span>
                  )}
                </div>
                {recEntry?.status === 'loading' ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Agent evaluating the scenarios…
                  </div>
                ) : agentRec ? (
                  <>
                    <p className="text-sm text-slate-700 leading-relaxed">{agentRec.rationale}</p>
                    {agentRec.key_considerations.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {agentRec.key_considerations.map((k, i) => (
                          <li key={i} className="flex gap-2 text-xs text-slate-600">
                            <span className="text-[#DB033B] flex-shrink-0">•</span>{k}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {selectedScenario.rationale || 'No rationale returned by the optimizer for this scenario.'}
                    </p>
                    {recEntry?.status === 'error' && (
                      <p className="mt-2 text-xs text-amber-600">Agent unavailable — showing the optimizer rationale.</p>
                    )}
                    <p className="mt-3 text-[11px] text-slate-400">
                      Click <span className="font-semibold">Evaluate with AI</span> for an agent recommendation that weighs single-source vs split, OTIF risk, penalty and customer tier.
                    </p>
                  </>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Execution Steps</h4>
                {incident.executionSteps && incident.executionSteps.length > 0 ? (
                  <ul className="space-y-2.5">
                    {incident.executionSteps.map((step, i) => (
                      <li key={i} className="flex gap-3 text-sm text-slate-700 items-start">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#DB033B]/10 text-[#DB033B] flex items-center justify-center font-bold text-[11px]">{i + 1}</span>
                        <span className="leading-snug">{step}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 italic">No execution steps for this incident.</p>
                )}
              </div>
            </div>
          )}

          {/* 6 — Execute bar */}
          {selectedScenario && (
            <div className="space-y-3">
              {appliedPlan && appliedPlan.incidentId === incident.id && (
                <div className="px-4 py-3 rounded-lg text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Plan applied: {appliedPlan.scenarioName}</div>
                    <div className="text-xs text-emerald-700 mt-0.5">
                      Logged at {new Date(appliedPlan.at).toLocaleString()} — action this plan manually in SAP (no execute endpoint yet).
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-stretch gap-3">
                <button
                  onClick={handleExecute}
                  className="flex-1 bg-[#DB033B] hover:opacity-90 text-white font-bold py-3 rounded-lg text-sm transition-opacity flex items-center justify-center gap-2 shadow-md"
                >
                  Execute: {selectedScenario.name}
                </button>
                <button
                  onClick={() => runRecommend(Boolean(agentRec))}
                  disabled={recEntry?.status === 'loading' || scenarios.length === 0}
                  title="Ask the agent to weigh the scenarios and recommend one"
                  className="px-5 border-2 border-[#DB033B] text-[#DB033B] font-bold rounded-lg text-sm hover:bg-[#DB033B]/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {recEntry?.status === 'loading'
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Evaluating…</>
                    : <><Sparkles className="w-4 h-4" /> {agentRec ? 'Re-evaluate with AI' : 'Evaluate with AI'}</>}
                </button>
                {agentRec && selectedScenarioId !== recommended?.id && (
                  <button
                    onClick={handleUseRecommendation}
                    className="px-4 border-2 border-emerald-500 text-emerald-700 font-bold rounded-lg text-sm hover:bg-emerald-50 transition-colors flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Use AI pick
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 7 — DC Sourcing Explorer */}
          {Object.keys(inventoryByPlant).length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-slate-500" />
                  <h3 className="text-sm font-bold text-slate-800">DC Sourcing Explorer — {incident.skuCode}</h3>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Network Total</div>
                  <div className="font-mono font-bold text-slate-800">
                    {Object.values(inventoryByPlant).reduce((s, v) => s + (v.available || 0), 0).toLocaleString()} cs
                  </div>
                </div>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-200">
                    <th className="text-left font-bold py-2">DC</th>
                    <th className="text-right font-bold py-2">Available</th>
                    <th className="text-left font-bold py-2 pl-4">Coverage of order</th>
                    <th className="text-right font-bold py-2">Allocated</th>
                    <th className="text-right font-bold py-2">After Fill</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(inventoryByPlant)
                    .sort((a, b) => (b[1].available || 0) - (a[1].available || 0))
                    .map(([code, inv]) => {
                      const allocated = splitByCode[code] ?? 0;
                      const afterFill = (inv.available || 0) - allocated;
                      const coverage = orderedQty > 0 ? Math.min(100, ((inv.available || 0) / orderedQty) * 100) : 0;
                      const isOrigin = code === originPlant;
                      const isUsed = allocated > 0;
                      return (
                        <tr key={code} className={cn('transition-colors', isUsed ? 'bg-[#DB033B]/[0.03]' : '')}>
                          <td className="py-2.5">
                            <div className="font-bold text-slate-800 font-mono">{code}</div>
                            <div className="text-[10px] text-slate-400">
                              {isOrigin ? 'Origin' : 'Alternate'}
                              {freightCosts[code] != null && <> · ${freightCosts[code]}/cs</>}
                            </div>
                          </td>
                          <td className="py-2.5 text-right font-mono text-slate-800">{(inv.available || 0).toLocaleString()}</td>
                          <td className="py-2.5 pl-4">
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', coverage >= 100 ? 'bg-emerald-500' : coverage >= 40 ? 'bg-amber-500' : 'bg-[#DB033B]')}
                                style={{ width: `${coverage}%` }}
                              />
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{Math.round(coverage)}%</div>
                          </td>
                          <td className="py-2.5 text-right font-mono">
                            {allocated > 0 ? <span className="text-[#DB033B] font-bold">{allocated.toLocaleString()} cs</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2.5 text-right font-mono text-slate-600">{afterFill.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>

              {/* AI Split Sourcing Plan */}
              {splitPlan.length > 0 && (
                <div className="mt-5 rounded-xl border-2 border-[#DB033B]/20 bg-[#DB033B]/[0.03] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-3.5 h-3.5 text-[#DB033B]" />
                    <h4 className="text-xs font-bold text-[#DB033B] uppercase tracking-widest">AI Split Sourcing Plan</h4>
                    {customerRegion && <span className="text-[10px] text-slate-400">· region {customerRegion}</span>}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {splitPlan.map((p) => {
                      const pct = orderedQty > 0 ? Math.round((Number(p.qty) / orderedQty) * 100) : 0;
                      return (
                        <div key={`${p.code}-${p.qty}`} className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm min-w-[140px]">
                          <div className="flex items-center gap-1.5 text-slate-800 font-bold font-mono">
                            <Building2 className="w-3.5 h-3.5 text-slate-400" /> {p.code}
                          </div>
                          {(p.city || p.name) && <div className="text-[10px] text-slate-400 mb-1">{p.city || p.name}</div>}
                          <div className="font-mono font-black text-lg text-[#DB033B]">{Number(p.qty).toLocaleString()} cs</div>
                          <div className="text-[10px] text-slate-500">{pct}% of order
                            {p.transitHours != null && <> · ~{p.transitHours}h</>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

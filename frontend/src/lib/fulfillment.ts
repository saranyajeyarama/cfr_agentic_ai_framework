/**
 * Fulfillment Simulator client-side state.
 *
 * Two stores backed by sessionStorage so tab switches and page reloads
 * keep the data:
 *
 *  1. Incident list (one fetch per browser-tab lifetime) — the data that
 *     used to live in `data.fulfillmentIncidents` from /dashboard-data.
 *     We lazy-load it the first time the user opens the Simulator tab.
 *
 *  2. Scenarios per incident id — cached so re-clicking an incident or
 *     switching tabs doesn't re-run the LP.
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

// ─── Types (mirror backend FulfillmentIncident / FulfillmentScenario) ────────

export type PlantDetail = {
  code: string;
  name: string;
  city: string;
  type: string;
  qty: number;
  transitHours?: number;
  carrier?: string;
};

export type FulfillmentScenario = {
  id: string;
  name: string;
  tagline: string;
  arrival: string;
  dcSource: string;
  freightCost: number;
  fine: number;
  netImpact: number;
  savingsVsDefault: number;
  isRecommended: boolean;
  rationale?: string;
  // Delivery-enriched fields (from dim_plant + fct_shipments + dim_carrier).
  transitHours?: number;
  carrierName?: string;
  plantDetails?: PlantDetail[];
};

export type FulfillmentIncident = {
  id: string;
  title: string;
  customer: string;
  skuCode: string;
  skuName: string;
  soldTo?: string;
  materialNumber?: string;
  orderedQty?: number;
  mabd?: string;
  description: string;
  riskProbability: number;
  fineAtRisk: number;
  otifRulebook: string;
  originPlant?: string;
  // Delivery-enriched origin plant metadata (dim_plant + fct_shipments).
  originPlantName?: string;
  originPlantCity?: string;
  originPlantType?: string;
  avgTransitHours?: number;
  primaryCarrier?: string;
  recentFillRate?: number;
  // Extended risk data from BigQuery enrichment.
  otifTarget?: number;
  otifProgram?: string;
  otifFailRate?: number;
  recentFails?: number;
  totalDeliveries?: number;
  maxDaysLate?: number;
  avgDaysLate?: number;
  lastFailReason?: string;
  lastRootCause?: string;
  avgChargebackUsd?: number;
  totalChargebackUsd?: number;
  chargebackCount?: number;
  mabdEnforcement?: string;
  otifAggressive?: boolean;
  scenarios: FulfillmentScenario[];
  executionSteps: string[];
  _demo_seed?: boolean;
};

export type ScenarioFetchStatus = 'idle' | 'loading' | 'done' | 'error';

export type ScenarioEntry = {
  status: ScenarioFetchStatus;
  scenarios?: FulfillmentScenario[];
  meta?: Record<string, unknown>;
  error?: string;
};

export type ScenarioMap = Record<string, ScenarioEntry>;

// ─── sessionStorage backing ──────────────────────────────────────────────────

const SCENARIOS_KEY = 'tiger:fulfillment:scenarios:v1';
const INCIDENTS_KEY = 'tiger:fulfillment:incidents:v1';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ─── Incident list store ─────────────────────────────────────────────────────

export type IncidentsState = {
  incidents: FulfillmentIncident[];
  status: 'idle' | 'loading' | 'done' | 'error';
  meta?: Record<string, unknown>;
  error?: string;
};

const INCIDENTS_INITIAL: IncidentsState = { incidents: [], status: 'idle' };

export function useFulfillmentIncidentsStore() {
  const [state, setState] = useState<IncidentsState>(() =>
    readJSON<IncidentsState>(INCIDENTS_KEY, INCIDENTS_INITIAL),
  );

  useEffect(() => writeJSON(INCIDENTS_KEY, state), [state]);

  const load = useCallback(async (force = false) => {
    if (!force && state.status === 'loading') return;
    if (!force && state.status === 'done' && state.incidents.length > 0) return;
    setState(prev => ({ ...prev, status: 'loading' }));
    try {
      const res = await fetch('/api/fulfillment/incidents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setState({
        incidents: (body.incidents ?? []) as FulfillmentIncident[],
        status: 'done',
        meta: body.meta,
      });
    } catch (e: any) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: e?.message || 'fetch failed',
      }));
    }
  }, [state.status, state.incidents.length]);

  /** Mark the store as stale so the next Fulfillment Simulator mount
   *  re-fetches from the backend (picks up newly approved orders). */
  const invalidate = useCallback(() => {
    setState(INCIDENTS_INITIAL);
    writeJSON(INCIDENTS_KEY, INCIDENTS_INITIAL);
  }, [setState]);

  return { state, load, setState, invalidate };
}

// ─── Scenarios-per-incident store ────────────────────────────────────────────

export function useFulfillmentScenariosStore(): [
  ScenarioMap,
  Dispatch<SetStateAction<ScenarioMap>>,
] {
  const [map, setMap] = useState<ScenarioMap>(() => {
    const loaded = readJSON<ScenarioMap>(SCENARIOS_KEY, {});
    // Drop in-flight entries from a previous tab lifetime.
    const cleaned: ScenarioMap = {};
    for (const [k, v] of Object.entries(loaded)) {
      if (v && v.status !== 'loading') cleaned[k] = v;
    }
    return cleaned;
  });

  useEffect(() => writeJSON(SCENARIOS_KEY, map), [map]);

  return [map, setMap];
}

/**
 * Imperative trigger — fires POST /api/fulfillment/simulate and writes
 * the result into the scenarios store keyed by incidentId. Returns the
 * resulting entry so the caller can await + render.
 */
export async function runFulfillmentSimulate(
  incident: FulfillmentIncident,
  setMap: Dispatch<SetStateAction<ScenarioMap>>,
): Promise<void> {
  if (!incident.soldTo || !incident.materialNumber || !incident.orderedQty) {
    setMap(prev => ({
      ...prev,
      [incident.id]: {
        status: 'error',
        error: 'Incident is missing sold_to / material / qty — cannot simulate.',
      },
    }));
    return;
  }
  setMap(prev => ({ ...prev, [incident.id]: { status: 'loading' } }));
  try {
    const res = await fetch('/api/fulfillment/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sold_to: incident.soldTo,
        material_number: incident.materialNumber,
        ordered_quantity_cases: incident.orderedQty,
        requested_delivery_date: incident.mabd,
        origin_plant: incident.originPlant,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    setMap(prev => ({
      ...prev,
      [incident.id]: {
        status: 'done',
        scenarios: body.scenarios ?? [],
        meta: body.meta ?? {},
      },
    }));
  } catch (e: any) {
    setMap(prev => ({
      ...prev,
      [incident.id]: {
        status: 'error',
        error: e?.message || 'simulate failed',
      },
    }));
  }
}

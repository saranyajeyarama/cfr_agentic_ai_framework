/**
 * v2.3 Frontend Contract Types
 *
 * All types here match the exact JSON shapes returned by the live backend.
 * Source of truth: _v23_adapter.py + openapi.json
 */

// ─── /v23/orders ─────────────────────────────────────────────────────────────

export type FlagType = 'above_forecast' | 'promo' | 'hard_block' | 'buffer_build' | 'clean';

/** The _backend round-trip payload the UI sends back to /v23/triage/{id}. */
export interface V23OrderBackend {
  sold_to: string;
  material_number: string;
  ordered_quantity_cases: number;
  requested_delivery_date: string | null;
  customer_name: string | null;
  material_description: string | null;
  consensus_plan_qty_cases: number | null;
  above_forecast_pct: number | null;
  forward_days_of_supply: number | null;
  projection_status: string | null;
}

export interface V23Order {
  id: string;        // SO-{hash} — stable synthetic ID
  po: string;        // PO-{hash}
  sold_to: string;
  customer: string;  // sold_to_name
  sku: string;       // material_number
  desc: string;      // material_description
  qty: number;       // ordered_qty_cases
  mabd: string | null;  // requested_delivery_date (ISO date)
  ship_to: string;
  priority: number;  // sold_to_priority_tier 1–5
  flag: string;      // human-readable flag message
  flag_type: FlagType;
  _backend: V23OrderBackend;
}

export interface V23OrdersResponse {
  orders: V23Order[];
  row_count: number;
  data_available: boolean;
  rationale: string | null;
}

// ─── /v23/triage/{order_id} ──────────────────────────────────────────────────

export interface V23Evidence {
  tool: string;
  finding: string;
  point: string;
}

export interface V23Signal {
  disposition: string;     // 'ACCEPT' | 'REJECT' | 'CAUTION' | 'DEFER'
  confidence: number;
  hard_block: boolean;
  summary: string;
  evidence: V23Evidence[];
  full_signal: Record<string, unknown>;
}

export type AgentKey = 'supply_planning' | 'demand_planning' | 'transportation' | 'retail_intelligence';

export interface V23Conflict {
  type: string;
  disputants: string[];
  summary: string;
  debate_rounds: number;
  resolution: string;
}

export interface V23Alternative {
  label: string;
  qty: number;
  outcome: string;
}

export interface V23Recommendation {
  action: string;     // 'ACCEPT' | 'REJECT' | 'PARTIAL' | 'DEFER'
  qty: number;
  fill_pct: number;
  confidence: number;
  outcome: string;
  alternatives: V23Alternative[];
}

export interface V23Chain {
  drivers: string[];
  tradeoffs: string[];
  flip: string;
}

export interface V23Escalation {
  summary: string;
  severity: string;   // 'LOW' | 'MEDIUM' | 'HIGH'
  action: string;
}

export interface V23Synthesis {
  forecast_classification: string;
  above_forecast_pct: number | null;
  plan_qty: number | null;
  signals: Partial<Record<AgentKey, V23Signal>>;
  conflicts: V23Conflict[];
  rec: V23Recommendation;
  chain: V23Chain;
  escalations: Record<string, V23Escalation>;
}

export interface V23TriageResponse {
  order_id: string;
  synthesis: V23Synthesis;
  session_id: string;
}

// ─── /data-health ────────────────────────────────────────────────────────────

export type DataSourceStatus = 'FRESH' | 'WARNING' | 'STALE' | 'LOADED' | 'MISALIGNED' | 'MISSING';

export interface DataHealthSource {
  name: string;
  agent: string;
  source_system: string;
  freshness_anchor: string | null;
  earliest_data_date: string | null;
  latest_data_date: string | null;
  age_days: number | null;
  total_rows: number | null;
  expected_lag_days: number | null;
  max_forward_lag_days: number | null;
  status: DataSourceStatus;
  status_reason: string;
}

export interface DataHealthSummary {
  total: number;
  fresh: number;
  warning: number;
  stale: number;
  empty: number;
  misaligned: number;
  missing: number;
  loaded: number;
}

export interface DataHealthResponse {
  data_available: boolean;
  sources: DataHealthSource[];
  summary: DataHealthSummary;
  reference_date: string;
  view_queried: string;
  union_query_fallback_reason: string | null;
}

// ─── /telemetry/execution ────────────────────────────────────────────────────

export interface ExecutionTelemetryEntry {
  id: string;
  session_id: string;
  user_id: string | null;
  purchase_order_number: string | null;
  agent_recommendation: string | null;
  user_decision: string | null;
  override_reason: string | null;
  outcome: string | null;
  aligned: boolean | null;
  timestamp: string;
}

// ─── /dashboard-data ─────────────────────────────────────────────────────────
// Kept loose — the dashboard-data route returns a wide object. Tabs
// that consume it cast as needed. Prefer the typed v2.3 routes above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DashboardData = Record<string, any>;

// ─── ScreenId — canonical navigation type ────────────────────────────────────
// Phase 7: 4 agent overview pages restored after their backend routes shipped
// (/agents/supply, /agents/demand, /agents/transport, /agents/retail).
export type ScreenId =
  | 'watchtower'
  | 'triage'
  | 'simulator'
  | 'rootcause'
  | 'safetystock'
  | 'decisions'
  | 'manager'
  | 'datahealth'
  | 'dictionary'
  | 'agent-supply'
  | 'agent-demand'
  | 'agent-transport'
  | 'agent-retail';

// ─── /agents/{supply,demand,transport,retail} ────────────────────────────────
// Field names match the backend dict shape and the AI Studio PORT_* constants
// verbatim — no client-side remapping.

export type AgentMeta = {
  fetched_at?: string;
  source?: string;
  count?: number;
  error?: string;
};

// /agents/supply ───────────────────────────────────────────────────────────
export type SupplyInventoryRow = {
  sku: string; desc: string; dc: string;
  cs: number; dos: number;
  status: 'STOCKOUT' | 'BELOW_SS' | 'OK' | string;
  short: number;
};

export type SupplyProductionRow = {
  pro: string; sku: string; desc: string; end: string;
  status: string; adherence: number;
  risk: 'HIGH' | 'MEDIUM' | 'LOW' | string;
};

export type SupplyRawMaterialRow = {
  material: string; concern: boolean; dos: number;
  rationale: string; skus: string;
};

export interface AgentsSupplyResponse {
  data: {
    inventory:     SupplyInventoryRow[];
    production:    SupplyProductionRow[];
    raw_materials: SupplyRawMaterialRow[];
  };
  meta: AgentMeta;
}

// /agents/demand ───────────────────────────────────────────────────────────
export type DemandClassification =
  'BUFFER_BUILD' | 'GENUINE_PULL' | 'PROMO_DRIVEN' | 'ONE_OFF_ANOMALY' | string;

export type DemandPositionRow = {
  customer: string; sku: string; desc: string;
  vs_plan: number; plan_cs: number;
  classification: DemandClassification;
  conf: number; wmape: number; bias: number;
  quality: 'HEALTHY' | 'SYSTEMATIC_OVER' | 'SYSTEMATIC_UNDER' | string;
  promo: boolean; escalation: boolean;
};

export type DemandPromoRow = {
  customer: string; sku: string; name: string;
  type: string; dates: string; incr: number; status: string;
};

export interface AgentsDemandResponse {
  data: {
    positions:      DemandPositionRow[];
    promo_calendar: DemandPromoRow[];
  };
  meta: AgentMeta;
}

// /agents/transport ────────────────────────────────────────────────────────
export type TransportLaneRow = {
  id: string; lane: string; origin: string; dest: string;
  transit: number; otp: number; ships: number;
  viable: boolean; carrier: string;
};

export type TransportCarrierRow = {
  name: string; otp: number; target: number;
  ships: number; cb: number; meets: boolean;
};

export type TransportOtifRow = {
  customer: string; otif: number; target: number;
  delta: number; cb: number; exposure: number;
};

export interface AgentsTransportResponse {
  data: {
    lanes:    TransportLaneRow[];
    carriers: TransportCarrierRow[];
    otif:     TransportOtifRow[];
  };
  meta: AgentMeta;
}

// /agents/retail ───────────────────────────────────────────────────────────
export type RetailClassificationRow = {
  customer: string; sku: string; desc: string;
  cls: DemandClassification;
  conf: number; pos: number;
  trend: 'ACCELERATING' | 'FLAT' | 'DECELERATING' | string;
  ohi: number | null; ohi_norm: number | null;
  promo: boolean; risk: number;
};

export type RetailPosTrendRow = {
  sku: string; desc: string;
  trend: 'ACCELERATING' | 'FLAT' | 'DECELERATING' | string;
  acv: number;
  weekly: Array<{ w: string; v: number }>;
};

export interface AgentsRetailResponse {
  data: {
    classifications: RetailClassificationRow[];
    pos_trends:      RetailPosTrendRow[];
  };
  meta: AgentMeta;
}

// ─── /chat ───────────────────────────────────────────────────────────────────
// Backend ChatMessage shape (FastAPI schema). Roles are 'user' | 'agent'.
export interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  agentId?: string;
}

export interface ChatResponse {
  text: string;
}

// ─── /fulfillment/simulate ───────────────────────────────────────────────────

export interface SimulateRequest {
  sold_to: string;
  material_number: string;
  ordered_quantity_cases: number;
  requested_delivery_date?: string | null;
  origin_plant?: string | null;
  customer_region?: string | null;
  blocked_plants?: string[];
}

export interface FulfillmentScenarioWire {
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
  lpPreferred?: boolean;
  plantsOpened?: number;
  rationale?: string;
  transitHours?: number;
  carrierName?: string;
  plantDetails?: Array<Record<string, unknown>>;
}

export interface SimulateResponse {
  scenarios: FulfillmentScenarioWire[];
  meta?: Record<string, unknown>;
}

// ─── /fulfillment/recommend (agentic recommendation) ─────────────────────────
export interface FulfillmentRecommendRequest {
  incident_id: string;
  sold_to?: string;
  material_number?: string;
  ordered_quantity_cases?: number;
  scenarios: FulfillmentScenarioWire[];
  context?: Record<string, unknown>;
}

export interface FulfillmentRecommendation {
  recommended_scenario_id: string;
  rationale: string;
  confidence: number;
  key_considerations: string[];
  recommendation_source: 'agent' | 'rule';
}

export interface FulfillmentRecommendResponse {
  incident_id: string;
  recommendation: FulfillmentRecommendation;
  cached: boolean;
  cached_at?: string | null;
}

// ─── /fulfillment/incidents ──────────────────────────────────────────────────
// Re-export the canonical FulfillmentIncident shape from lib/fulfillment so
// new code can pull it from one place. The export below avoids a circular
// import by using `import type`.
export type { FulfillmentIncident as SimulatorIncident } from './fulfillment';

// ─── Spec-named aliases (v2.3 contract per Prompt 0.3) ───────────────────────
// The spec uses unprefixed names. These aliases let new code follow the spec
// naming while existing code can keep using the V23* names.

export type Order              = V23Order;
export type BackendPayload     = V23OrderBackend;
export type TriageResponse     = V23TriageResponse;
export type Synthesis          = V23Synthesis;
export type SpecialistSignal   = V23Signal;
export type Conflict           = V23Conflict;
export type Recommendation     = V23Recommendation;
export type ReasoningChain     = V23Chain;
export type Escalation         = V23Escalation;
export type Evidence           = V23Evidence;
export type Alternative        = V23Alternative;

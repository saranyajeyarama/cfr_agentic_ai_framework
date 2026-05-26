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
// Per Phase 0.4: only screens with a live backend equivalent are listed.
// The 5 screens that were hidden (Supply / Demand / Transport / Retail
// agent pages + Data Dictionary) will be re-added in Phase 2 once the
// backend exposes routes for them. Reference JSX still lives at
// /reference/original_ai_studio.jsx so those screens can be revived.
export type ScreenId =
  | 'watchtower'
  | 'triage'
  | 'simulator'
  | 'rootcause'
  | 'safetystock'
  | 'decisions'
  | 'manager'
  | 'datahealth';

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
  rationale?: string;
  transitHours?: number;
  carrierName?: string;
  plantDetails?: Array<Record<string, unknown>>;
}

export interface SimulateResponse {
  scenarios: FulfillmentScenarioWire[];
  meta?: Record<string, unknown>;
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

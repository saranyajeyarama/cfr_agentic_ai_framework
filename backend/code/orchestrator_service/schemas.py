"""
Tiger Foods Customer Supply agentic AI — Pydantic schemas (v2.01).

STANDALONE. Complete schema set for the 5-agent build. Not a patch.

Field names match the real tiger_semantic schema (sold_to,
material_number, ordered_quantity_cases, requested_delivery_date) and the
CustomerOrderEvent trigger contract in agent_tools.py.

ADK agents are configured with output_schema=... on these models, forcing
Gemini to emit conformant JSON. Validation failures are caught by the
orchestrator and routed to its error path.
"""

from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Evidence — shared across all agents
# ---------------------------------------------------------------------------
class Evidence(BaseModel):
    tool_called: str
    view_queried: str
    key_finding: str
    data_point: str


# ---------------------------------------------------------------------------
# Specialist signal envelope
# ---------------------------------------------------------------------------
class SpecialistSignalBase(BaseModel):
    """Common envelope returned by each of the 4 specialists."""
    agent: Literal["supply_planning", "demand_planning",
                   "transportation", "retail_intelligence"]
    disposition: Literal["PROCEED", "CAUTION", "BLOCK"]
    confidence: float = Field(ge=0.0, le=1.0)
    hard_block: bool = False
    evidence: list[Evidence] = Field(default_factory=list)
    reasoning_summary: str


# ---------------------------------------------------------------------------
# Supply Planning
# ---------------------------------------------------------------------------
class InventoryProjectionWeek(BaseModel):
    plant_code: Optional[str] = None
    projection_week_start_date: Optional[str] = None
    ending_inventory_cases: float = 0.0
    days_of_supply: Optional[float] = None
    projection_status: Optional[
        Literal["OK", "BELOW_SS", "STOCKOUT"]] = None


class FGPosition(BaseModel):
    """Forward available-to-promise, from fct_inventory_projection."""
    current_week_ending_inventory_cases: float = 0.0
    current_week_days_of_supply: Optional[float] = None
    projection_status: Optional[
        Literal["OK", "BELOW_SS", "STOCKOUT"]] = None
    usable_short_by_cases: float = 0.0
    projection_weeks: list[InventoryProjectionWeek] = Field(
        default_factory=list)


class HighestRiskRun(BaseModel):
    production_order_number: Optional[str] = None
    planned_end_date: Optional[str] = None
    production_order_status: Optional[
        Literal["CRTD", "REL", "TECO"]] = None
    plan_adherence_pct: Optional[float] = None
    risk_summary: Optional[str] = None


class ProductionOrderRisk(BaseModel):
    upcoming_runs_count: int = 0
    highest_risk_run: Optional[HighestRiskRun] = None


class SupplyPlanningSignalPayload(BaseModel):
    fg_position: FGPosition
    production_order_risk: ProductionOrderRisk
    raw_material_signal: dict[str, Any] = Field(default_factory=dict)
    procurement_signal: dict[str, Any] = Field(default_factory=dict)
    shelf_life_note: Optional[str] = None  # report-only; no MRSL pass/fail


class SupplyPlanningSignal(SpecialistSignalBase):
    agent: Literal["supply_planning"] = "supply_planning"
    signal: SupplyPlanningSignalPayload


# ---------------------------------------------------------------------------
# Demand Planning
# ---------------------------------------------------------------------------
class ForecastAccuracySignal(BaseModel):
    trailing_wmape_pct: Optional[float] = None
    trailing_bias_pct: Optional[float] = None
    plan_quality_flag: Literal[
        "HEALTHY", "SYSTEMATIC_UNDER", "SYSTEMATIC_OVER",
        "NOISY", "INSUFFICIENT_DATA"
    ] = "INSUFFICIENT_DATA"


class DemandPlanningSignalPayload(BaseModel):
    above_forecast_pct: Optional[float] = None
    consensus_plan_qty_cases: Optional[float] = None
    above_forecast_classification: Literal[
        "GENUINE_PULL", "BUFFER_BUILD", "PROMO_DRIVEN",
        "SYSTEMATIC_PLAN_ERROR", "ONE_OFF_ANOMALY", "INSUFFICIENT_DATA"
    ]
    classification_confidence: float = Field(ge=0.0, le=1.0)
    classification_basis: list[str] = Field(default_factory=list)
    forecast_accuracy_signal: ForecastAccuracySignal
    promo_attributed: bool = False
    demand_team_escalation_recommended: bool = False
    demand_team_escalation_reason: Optional[str] = None


class DemandPlanningSignal(SpecialistSignalBase):
    agent: Literal["demand_planning"] = "demand_planning"
    signal: DemandPlanningSignalPayload


# ---------------------------------------------------------------------------
# Transportation
# ---------------------------------------------------------------------------
class LaneProfile(BaseModel):
    origin_plant: Optional[str] = None
    destination_region: Optional[str] = None
    avg_transit_hours: float = 0.0
    on_time_arrival_pct: float = 0.0
    shipment_count: int = 0
    viable: bool = False
    notes: Optional[str] = None


class CarrierOTP(BaseModel):
    carrier_number: Optional[str] = None
    carrier_name: Optional[str] = None
    trailing_otp_pct: float = 0.0
    contracted_otp_target: Optional[float] = None
    meets_target: bool = False


class ChargebackExposure(BaseModel):
    trailing_chargeback_count: int = 0
    total_chargeback_usd: float = 0.0
    posted_usd: float = 0.0
    disputed_usd: float = 0.0
    top_chargeback_types: list[str] = Field(default_factory=list)


class CustomerOtifPosition(BaseModel):
    trailing_otif_pct: float = 0.0
    customer_otif_target_pct: float = 0.0
    delta_to_target_pct: float = 0.0


class TransportationSignalPayload(BaseModel):
    primary_lane: LaneProfile
    carrier_options: list[CarrierOTP] = Field(default_factory=list)
    chargeback_exposure: ChargebackExposure
    customer_otif_position: CustomerOtifPosition
    active_alert_count: int = 0


class TransportationSignal(SpecialistSignalBase):
    agent: Literal["transportation"] = "transportation"
    signal: TransportationSignalPayload


# ---------------------------------------------------------------------------
# Retail Intelligence  (repointed to fct_demand_drivers + fct_promo_plan)
# ---------------------------------------------------------------------------
class ConsumerTakeawaySignal(BaseModel):
    trailing_weeks_observed: int = 0
    latest_pos_units: Optional[float] = None
    takeaway_trend: Optional[
        Literal["ACCELERATING", "FLAT", "DECELERATING",
                "INSUFFICIENT_DATA"]] = "INSUFFICIENT_DATA"
    avg_distribution_pct_acv: Optional[float] = None
    promo_active_in_window: bool = False


class PromotionalContext(BaseModel):
    active_or_upcoming_promo: bool = False
    promo_type: Optional[str] = None
    expected_incremental_quantity: Optional[float] = None
    promo_status: Optional[str] = None


class RetailIntelligenceSignalPayload(BaseModel):
    pull_vs_buffer_classification: Literal[
        "GENUINE_PULL", "BUFFER_BUILD", "PROMO_DRIVEN",
        "INSUFFICIENT_DATA"
    ]
    classification_confidence: float = Field(ge=0.0, le=1.0)
    classification_basis: list[str] = Field(default_factory=list)
    consumer_takeaway: ConsumerTakeawaySignal
    promotional_context: PromotionalContext
    data_gaps: list[str] = Field(default_factory=list)


class RetailIntelligenceSignal(SpecialistSignalBase):
    agent: Literal["retail_intelligence"] = "retail_intelligence"
    signal: RetailIntelligenceSignalPayload


# ---------------------------------------------------------------------------
# Conflicts and debate
# ---------------------------------------------------------------------------
class Conflict(BaseModel):
    type: Literal["HARD_BLOCK", "DISPOSITION_DIVERGENCE",
                  "CONFIDENCE_ASYMMETRY"]
    disputants: list[str]
    summary: str
    debate_rounds_used: int = 0
    resolution: Literal["UNRESOLVED", "RESOLVED", "DEADLOCK"] = "UNRESOLVED"


class DebateMessage(BaseModel):
    your_previous_signal: dict[str, Any]
    disputant_position: dict[str, Any]
    round_number: int = Field(ge=2, le=3)
    instruction: str = (
        "Read the disputant's position. If their data is genuinely new "
        "and material, REVISE your signal. Otherwise HOLD and cite the "
        "specific data they did not have."
    )


# ---------------------------------------------------------------------------
# Customer Supply Decision — the synthesizer's output
# ---------------------------------------------------------------------------
class OrderContext(BaseModel):
    """Mirrors CustomerOrderEvent — real schema field names."""
    sold_to: str
    customer_name: Optional[str] = None
    material_number: str
    material_description: Optional[str] = None
    ordered_quantity_cases: float
    consensus_plan_qty_cases: Optional[float] = None
    forecast_classification: Literal[
        "WITHIN_FORECAST", "ABOVE_FORECAST", "UNKNOWN"] = "UNKNOWN"
    above_forecast_pct: Optional[float] = None
    requested_delivery_date: Optional[str] = None
    ship_to: Optional[str] = None
    customer_po_number: Optional[str] = None
    sales_order_number: Optional[str] = None
    priority_tier_level: Optional[int] = None
    trigger_source: str = "demo_payload"


class AlternativeOption(BaseModel):
    label: str
    fulfill_qty_cs: float
    estimated_outcome: str
    viable: bool


class SapAction(BaseModel):
    """Layer-2 SAP classification the synthesizer emits so downstream BATP
    translation knows which SAP transaction to prepare (Section 7). Optional
    and backward-compatible — a deterministic fallback derives it when absent."""
    decision_type: Literal[
        "TRANSFER_RECOMMENDATION", "ORDER_ADJUSTMENT", "DELIVERY_FLAG", "ESCALATION"
    ]
    sap_transaction_target: Optional[
        Literal["ME21N", "MIGO", "VA02", "VL02N"]
    ] = None
    change_type: Optional[
        Literal["QUANTITY_CHANGE", "PLANT_CHANGE", "DATE_CHANGE", "EXPEDITE_FLAG"]
    ] = None
    reason: Optional[str] = None


class Recommendation(BaseModel):
    action: Literal["ACCEPT", "REJECT", "PARTIAL_FULFILL", "DEFER"]
    fulfill_qty_cs: float = 0.0
    partial_fill_pct: Optional[float] = None
    alternative_options: list[AlternativeOption] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    expected_outcome: str
    # Layer-2 SAP classification (Section 7). Optional → older payloads still validate;
    # the BATP layer derives a fallback when the agent omits it.
    sap_action: Optional[SapAction] = None


class ReasoningChain(BaseModel):
    which_specialists_drove_decision: list[str] = Field(default_factory=list)
    key_trade_offs: list[str] = Field(default_factory=list)
    what_would_change_the_decision: str


class Escalation(BaseModel):
    summary: str
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    recommended_action: str


class Escalations(BaseModel):
    to_transportation_manager: Optional[Escalation] = None
    to_demand_planning_team: Optional[Escalation] = None
    to_supply_planning_team: Optional[Escalation] = None


class DCEPayload(BaseModel):
    cdm_domains_referenced: list[str] = Field(default_factory=list)
    scenario_tag: Optional[str] = None


class CustomerSupplyDecision(BaseModel):
    agent: Literal["customer_supply"] = "customer_supply"
    session_id: str
    order: OrderContext
    specialist_signals: dict[str, dict[str, Any]]
    conflicts_detected: list[Conflict] = Field(default_factory=list)
    recommendation: Recommendation
    reasoning_chain: ReasoningChain
    escalations: Escalations = Field(default_factory=Escalations)
    dce_payload: DCEPayload = Field(default_factory=DCEPayload)
    ready_to_present_to_human: bool = True


# ---------------------------------------------------------------------------
# HTTP request / response models
# ---------------------------------------------------------------------------
class DemoOrderPayload(BaseModel):
    """Inline order body for trigger_source='demo_payload'. Real schema
    field names. All fields optional — an empty payload makes the service
    fall back to resolve_demo_scenario()."""
    sold_to: Optional[str] = None
    material_number: Optional[str] = None
    ordered_quantity_cases: Optional[float] = None
    requested_delivery_date: Optional[str] = None
    ship_to: Optional[str] = None
    customer_po_number: Optional[str] = None
    sales_order_number: Optional[str] = None
    customer_name: Optional[str] = None
    material_description: Optional[str] = None


class StartSessionRequest(BaseModel):
    """One route, two trigger sources.

      trigger_source='demo_payload' → order carried inline in demo_order
      trigger_source='edi_850'      → only isa_control_id; the service
                                       fetches the row from
                                       fct_edi_purchase_orders
    """
    trigger_type: Literal["new_order", "alert_fired", "manual"] = "new_order"
    trigger_source: Literal["demo_payload", "edi_850"] = "demo_payload"
    demo_order: Optional[DemoOrderPayload] = None
    isa_control_id: Optional[str] = None


class StartSessionResponse(BaseModel):
    session_id: str
    status: str
    trigger_source: str
    resolved_order: dict[str, Any] = Field(default_factory=dict)
    placeholder_used: bool = False


class ApprovalRequest(BaseModel):
    user_id: str
    approval_notes: Optional[str] = None


class RejectionRequest(BaseModel):
    user_id: str
    rejection_reason: str


class DecisionResponse(BaseModel):
    decision_id: str
    status: str


# ---------------------------------------------------------------------------
# Nexus co-pilot chat (GET /chat) — Gemini-backed
# ---------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: Literal["user", "agent"]
    text: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    systemPrompt: str = ""
    agentId: str = "nexus"


class ChatResponse(BaseModel):
    text: str


# ---------------------------------------------------------------------------
# Fulfillment Simulator — Phase 1 LP optimizer endpoints
# Field names match the front-end Scenario / Incident types exactly so the
# UI can render the response object without any field renames.
# ---------------------------------------------------------------------------
class FulfillmentScenario(BaseModel):
    id: str
    name: str
    tagline: str
    arrival: str
    dcSource: str
    freightCost: float
    fine: float
    netImpact: float
    savingsVsDefault: float = 0
    isRecommended: bool = False
    # The optimizer's own cost-based preference (savings > 0 after the
    # per-shipment fixed cost). The agentic recommendation (POST
    # /fulfillment/recommend) overrides `isRecommended`; `lpPreferred`
    # preserves the optimizer's view for the rule fallback.
    lpPreferred: bool = False
    plantsOpened: int = 0
    rationale: Optional[str] = None
    # Delivery-enriched fields (from dim_plant + fct_shipments + dim_carrier).
    transitHours: Optional[float] = None
    carrierName: Optional[str] = None
    plantDetails: Optional[list[dict[str, Any]]] = None  # [{code, name, city, type, qty}]


class FulfillmentSimulateRequest(BaseModel):
    sold_to: str
    material_number: str
    ordered_quantity_cases: float
    requested_delivery_date: Optional[str] = None
    origin_plant: Optional[str] = None
    customer_region: Optional[str] = None
    blocked_plants: list[str] = Field(default_factory=list)
    # BUG-FIX-PHASE2 / Step 6: free-text soft constraints the planner can
    # add via the UI (e.g., "DC04 closed today" or "prefer DC02"). The
    # Fulfillment Agent reads this as SOFT guidance; hard blocks belong in
    # blocked_plants. LP path ignores this field.
    user_constraints: Optional[str] = None


class FulfillmentSimulateMeta(BaseModel):
    solver_status: str
    elapsed_ms: int
    no_alternate_reason: Optional[str] = None
    freight_costs_used: dict[str, float] = Field(default_factory=dict)
    penalty_per_case: float = 0
    per_shipment_fixed_usd: float = 0
    single_source_possible: bool = False
    plants_opened: Optional[int] = None
    ordered_qty: float = 0
    origin_plant: Optional[str] = None
    customer_region: Optional[str] = None
    inventory_by_plant: dict[str, dict[str, float]] = Field(default_factory=dict)
    # Commitment-aware ATP context (open allocations subtracted from on-hand).
    committed_total: float = 0
    commitments_subtracted: bool = False
    inventory_note: Optional[str] = None
    is_demo_seed: bool = False
    # ───────── BUG-FIX-PHASE2: which engine produced this response ─────────
    # "deterministic_lp" — the original PuLP/CBC LP solver
    # "agent"            — the Phase 2 Fulfillment Agent (Gemini-backed)
    # Frontend reads this to show an "Engine: AGENT | LP" badge on the
    # scenario cards so the planner knows what produced the recommendation.
    engine: Literal["deterministic_lp", "agent"] = "deterministic_lp"
    engine_note: Optional[str] = None
    agent_decision_summary: Optional[str] = None
    agent_confidence: Optional[float] = None
    agent_tradeoffs: list[str] = Field(default_factory=list)
    user_constraints_applied: list[str] = Field(default_factory=list)
    blocked_plants_applied: list[str] = Field(default_factory=list)


class FulfillmentSimulateResponse(BaseModel):
    scenarios: list[FulfillmentScenario]
    meta: FulfillmentSimulateMeta


# ───────── BUG-FIX-PHASE2 / Fulfillment Agent — output schema ─────────
# These models define the shape the new Fulfillment Agent will emit. They
# mirror the existing FulfillmentScenario fields so the frontend can render
# either output (LP or agent) with minimal divergence, while adding the
# rationale-rich fields the business team requested (natural-language
# explanation, trade-offs list, user-constraint echo).
#
# The legacy LP code path (fulfillment_optimizer.simulate) and its output
# types (FulfillmentScenario, FulfillmentSimulateResponse) are NOT removed
# — they stay dormant behind a feature flag so rollback to LP is a single
# env-var flip.
# ----------------------------------------------------------------------
class PlantAllocation(BaseModel):
    """Per-plant breakdown showing what the agent decided to ship."""
    plant_code: str
    plant_name: Optional[str] = None
    plant_city: Optional[str] = None
    plant_type: Optional[str] = None   # "Manufacturing" | "Distribution Center"
    cases_allocated: float = 0.0
    available_cases: float = 0.0
    freight_cost_per_case_usd: float = 0.0
    transit_hours: Optional[float] = None
    carrier: Optional[str] = None


class FulfillmentAgentScenario(BaseModel):
    """One scenario card produced by the Fulfillment Agent.

    Shape mirrors FulfillmentScenario above so the frontend can render
    LP and agent output through the same component, with additive fields
    (rationale, tradeoffs, plant_details) for the richer agent reasoning.
    """
    id: str                                  # e.g. "scenario-a-default"
    name: str
    tagline: str = ""
    arrival: str = ""
    dc_source: str = ""                      # rollup label, e.g. "US02 + DC03"

    freight_cost: float = 0.0
    fine: float = 0.0
    net_impact: float = 0.0                  # -(freight + fine)
    savings_vs_default: float = 0.0
    is_recommended: bool = False

    # The agent's natural-language reasoning — the headline value-add.
    rationale: str = ""                      # full paragraph
    tradeoffs: list[str] = Field(default_factory=list)

    # Per-plant breakdown (mirrors LP's plantDetails).
    plant_details: list[PlantAllocation] = Field(default_factory=list)
    transit_hours: Optional[float] = None
    carrier_name: Optional[str] = None


class FulfillmentAgentDecision(BaseModel):
    """The full envelope returned by the Fulfillment Agent.

    The endpoint normalizes this to the existing FulfillmentSimulateResponse
    shape so the frontend remains the same. The extra fields (rationale,
    tradeoffs, user_constraints_applied) are surfaced into the per-scenario
    rationale block on the cards.
    """
    agent: Literal["fulfillment"] = "fulfillment"
    session_id: Optional[str] = None

    # Order echo so the frontend / debug tools have full context.
    order_summary: dict[str, Any] = Field(default_factory=dict)
    # Expected keys: sold_to, material_number, ordered_quantity_cases,
    # requested_delivery_date, origin_plant, customer_region.

    # The two scenarios (Default Route + Agent Recommendation).
    scenarios: list[FulfillmentAgentScenario] = Field(default_factory=list)

    # What the agent considered as constraints — echoed so the UI can
    # confirm to the user that their input was applied.
    user_constraints_applied: list[str] = Field(default_factory=list)
    blocked_plants_applied: list[str] = Field(default_factory=list)

    # Top-level reasoning summary (drives a "Why this recommendation?" line
    # above the cards, separate from each scenario's rationale).
    decision_summary: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    # Defensive captures — what data the agent reasoned over. Useful for
    # debugging and for the future commitment-subtraction layer to verify
    # which inventory numbers were used.
    inventory_snapshot_used: dict[str, Any] = Field(default_factory=dict)
    penalty_per_case_usd: Optional[float] = None


# ---------------------------------------------------------------------------
# Agentic fulfillment recommendation — POST /fulfillment/recommend
# An LLM reasons over the LP candidate scenarios + risk/penalty/tier context
# and picks the scenario + rationale. Deterministic rule fallback when Vertex
# AI is unavailable.
# ---------------------------------------------------------------------------
class FulfillmentRecommendRequest(BaseModel):
    incident_id: str
    sold_to: str = ""
    material_number: str = ""
    ordered_quantity_cases: float = 0
    # The already-computed scenarios + context, round-tripped from /simulate so
    # the endpoint does not re-run BigQuery or the LP.
    scenarios: list[FulfillmentScenario] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)


class FulfillmentRecommendation(BaseModel):
    recommended_scenario_id: str
    rationale: str = ""
    confidence: float = 0.0
    key_considerations: list[str] = Field(default_factory=list)
    recommendation_source: Literal["agent", "rule"] = "rule"


class FulfillmentRecommendResponse(BaseModel):
    incident_id: str
    recommendation: FulfillmentRecommendation
    cached: bool = False
    cached_at: Optional[str] = None


class FulfillmentIncidentScenario(FulfillmentScenario):
    """Same as FulfillmentScenario; alias kept for clarity in the
    incidents response (where scenarios is intentionally an empty list
    in Phase 1 — populated lazily by POST /fulfillment/simulate)."""
    pass


class FulfillmentIncident(BaseModel):
    id: str
    title: str
    customer: str
    skuCode: str
    skuName: str
    soldTo: Optional[str] = None
    materialNumber: Optional[str] = None
    orderedQty: Optional[float] = None
    mabd: Optional[str] = None
    description: str
    riskProbability: int
    fineAtRisk: float
    otifRulebook: str
    originPlant: Optional[str] = None
    # Delivery-enriched origin plant metadata (from dim_plant + fct_shipments).
    originPlantName: Optional[str] = None
    originPlantCity: Optional[str] = None
    originPlantType: Optional[str] = None
    avgTransitHours: Optional[float] = None
    primaryCarrier: Optional[str] = None
    recentFillRate: Optional[float] = None
    # Extended risk data from BigQuery enrichment (Phase 1).
    otifTarget: Optional[float] = None
    otifProgram: Optional[str] = None
    otifFailRate: Optional[float] = None
    recentFails: Optional[int] = None
    totalDeliveries: Optional[int] = None
    maxDaysLate: Optional[int] = None
    avgDaysLate: Optional[float] = None
    lastFailReason: Optional[str] = None
    lastRootCause: Optional[str] = None
    avgChargebackUsd: Optional[float] = None
    totalChargebackUsd: Optional[float] = None
    chargebackCount: Optional[int] = None
    mabdEnforcement: Optional[str] = None
    otifAggressive: Optional[bool] = None
    scenarios: list[FulfillmentIncidentScenario] = Field(default_factory=list)
    executionSteps: list[str] = Field(default_factory=list)
    _demo_seed: bool = False


class FulfillmentIncidentsResponse(BaseModel):
    incidents: list[FulfillmentIncident]
    meta: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# User Execution Telemetry
# Dedicated audit log in tiger_decisions.fct_user_execution_telemetry.
# Written whenever a user clicks "Execute Override & Log Telemetry" or
# "Confirm Allocation" in Order Triage (or "Execute" in the Fulfillment
# Simulator in a future phase).
# ---------------------------------------------------------------------------

class ExecutionTelemetryRequest(BaseModel):
    """Body the frontend sends for every human decision event."""
    po_number: Optional[str] = None
    sold_to: Optional[str] = None
    customer_name: Optional[str] = None
    material_number: Optional[str] = None
    ordered_qty: Optional[float] = None
    agent_recommendation: Optional[str] = None
    user_decision: str          # accept / modify / reject
    override_reason: Optional[str] = None
    override_reason_code: Optional[str] = None
    session_id: Optional[str] = None
    decision_id: Optional[str] = None
    outcome_note: Optional[str] = None
    user_id: Optional[str] = "planner"
    source_tab: Optional[str] = "order_triage"


class ExecutionTelemetryEntry(BaseModel):
    """One row from fct_user_execution_telemetry mapped to the UI shape
    (field names match the front-end DecisionEntry type exactly)."""
    id: str                          # telemetry_id
    timestamp: str                   # event_timestamp ISO string
    poNumber: str                    # po_number
    customer: str                    # customer_name (falls back to sold_to)
    agentRecommendation: str         # agent_recommendation
    userDecision: str                # user_decision
    overrideReason: Optional[str] = None
    outcome: str                     # outcome_note


class ExecutionTelemetryWriteResponse(BaseModel):
    telemetry_id: str
    status: str = "written"


class ExecutionTelemetryListResponse(BaseModel):
    entries: list[ExecutionTelemetryEntry]
    total: int

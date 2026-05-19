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


class Recommendation(BaseModel):
    action: Literal["ACCEPT", "REJECT", "PARTIAL_FULFILL", "DEFER"]
    fulfill_qty_cs: float = 0.0
    partial_fill_pct: Optional[float] = None
    alternative_options: list[AlternativeOption] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    expected_outcome: str


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

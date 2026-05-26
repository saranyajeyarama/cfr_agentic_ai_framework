"""
Tiger Foods Customer Supply Agentic AI — FastAPI service (v2.02b).

STANDALONE. v2.02 = the v2.01 single-flow 5-agent service PLUS the two
routes the OpEx Tower front-end requires:

  POST /sessions               start a 5-agent session (trigger adapter)
  GET  /sessions/{id}          read session state
  POST /sessions/{id}/approve  human approval gate -> DCE write
  POST /sessions/{id}/reject   human rejection gate -> DCE write
  GET  /demo/candidates        data-derived demo scenario shortlist
  GET  /dashboard-data         live BigQuery data in the dashboard shape   [v2.02]
  POST /chat                   Nexus co-pilot — Gemini via Vertex AI       [v2.02]
  GET  /health                 liveness

The agent core is unchanged from v2.01 — v2.02 only adds the dashboard
pipeline and the chat route so one Cloud Run service serves the whole app.
"""

from __future__ import annotations

# Silence OpenTelemetry's "Failed to detach context" flood. ADK async
# generators create OTEL span tokens in one asyncio context; FastAPI
# BackgroundTasks closes them in a copied context, so ContextVar.reset()
# raises ValueError. OTEL catches it and logs it at ERROR — harmless noise.
from logging_config import configure_logging
configure_logging()

import logging
import logging as _logging
log = logging.getLogger(__name__)
_logging.getLogger("opentelemetry").setLevel(_logging.CRITICAL)

import asyncio
import os
import uuid
from datetime import datetime, timezone

from google.cloud import bigquery
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agent_tools import (
    CustomerOrderEvent,
    from_demo_payload,
    from_edi_purchase_order,
    resolve_demo_scenario,
    get_demo_scenario_candidates,
    get_network_inventory,
    get_customer_penalty_profile,
    get_data_health,
)
from firestore_client import create_session, get_session
from orchestrator import run_session, approve_session, reject_session
from schemas import (
    StartSessionRequest, StartSessionResponse,
    ApprovalRequest, RejectionRequest, DecisionResponse,
    ChatRequest, ChatResponse,
    FulfillmentSimulateRequest, FulfillmentSimulateResponse,
    FulfillmentIncidentsResponse,
    ExecutionTelemetryRequest, ExecutionTelemetryWriteResponse,
    ExecutionTelemetryListResponse,
)
from fulfillment_optimizer import simulate as _simulate_fulfillment
from _v23_adapter import (
    candidate_to_v23_order,
    decision_to_v23_synthesis,
)


PROJECT_ID = os.environ.get("PROJECT_ID", "resilience-riskradar")
REGION = os.environ.get("REGION", "us-central1")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "gemini")

PROVIDER_NAMES = {"gemini": "Gemini 2.5 Flash (Vertex AI)"}

app = FastAPI(
    title="Tiger Foods Customer Supply Agentic AI",
    version="2.02b",
    description=("5-agent N-to-N parallel orchestration with debate-on-"
                 "conflict, plus dashboard data and Nexus co-pilot."),
)

# The front-end Express server proxies /api/* here; CORS open so the
# browser dev server can also call directly if needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _new_session_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"session_{ts}_{uuid.uuid4().hex[:6]}"


# ---------------------------------------------------------------------------
# User Execution Telemetry — fct_user_execution_telemetry
# Dedicated BigQuery audit table in tiger_decisions (US multi-region).
# Created once on first write/read via _ensure_telemetry_table().
# ---------------------------------------------------------------------------

_TELEMETRY_TABLE = f"{PROJECT_ID}.tiger_decisions.fct_user_execution_telemetry"
_telemetry_table_ready: bool = False


def _bq_telemetry() -> bigquery.Client:
    """BigQuery client for tiger_decisions (US multi-region)."""
    from data_pipeline import _bq_decisions
    return _bq_decisions()


def _ensure_telemetry_table() -> None:
    """Create fct_user_execution_telemetry if it doesn't exist (idempotent)."""
    global _telemetry_table_ready
    if _telemetry_table_ready:
        return
    try:
        client = _bq_telemetry()
        schema = [
            bigquery.SchemaField("telemetry_id",          "STRING",    mode="REQUIRED"),
            bigquery.SchemaField("event_timestamp",        "TIMESTAMP", mode="REQUIRED"),
            bigquery.SchemaField("po_number",              "STRING"),
            bigquery.SchemaField("sold_to",                "STRING"),
            bigquery.SchemaField("customer_name",          "STRING"),
            bigquery.SchemaField("material_number",        "STRING"),
            bigquery.SchemaField("ordered_qty",            "FLOAT64"),
            bigquery.SchemaField("agent_recommendation",   "STRING"),
            bigquery.SchemaField("user_decision",          "STRING",    mode="REQUIRED"),
            bigquery.SchemaField("override_reason",        "STRING"),
            bigquery.SchemaField("override_reason_code",   "STRING"),
            bigquery.SchemaField("session_id",             "STRING"),
            bigquery.SchemaField("decision_id",            "STRING"),
            bigquery.SchemaField("outcome_note",           "STRING"),
            bigquery.SchemaField("user_id",                "STRING"),
            bigquery.SchemaField("source_tab",             "STRING"),
            bigquery.SchemaField("created_at",             "TIMESTAMP", mode="REQUIRED"),
        ]
        table = bigquery.Table(_TELEMETRY_TABLE, schema=schema)
        table.time_partitioning = bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY,
            field="created_at",
        )
        table.description = (
            "User execution telemetry — human override audit trail for "
            "Order Triage and Fulfillment Simulator. Written by the frontend "
            "via POST /telemetry/execution on every Accept / Modify / Reject."
        )
        client.create_table(table, exists_ok=True)
        _telemetry_table_ready = True
        log.info("Telemetry table ready: %s", _TELEMETRY_TABLE)
    except Exception as exc:
        log.warning("Telemetry table ensure failed: %s", exc)


@app.exception_handler(RequestValidationError)
async def _log_validation_error(request: Request, exc: RequestValidationError):
    body = await request.body()
    log.warning(
        "422 validation error %s %s errors=%s body=%.500s",
        request.method, request.url.path,
        exc.errors(), body[:500].decode("utf-8", "replace"),
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "project": PROJECT_ID, "version": "2.02b",
            "provider": AI_PROVIDER,
            "providerName": PROVIDER_NAMES.get(AI_PROVIDER, AI_PROVIDER)}


# ---------------------------------------------------------------------------
# Dashboard data — live BigQuery in the front-end DashboardData shape  [v2.02]
# ---------------------------------------------------------------------------
@app.get("/dashboard-data")
def dashboard_data() -> dict:
    """Live tiger_semantic data shaped for the OpEx Tower dashboard.
    Each section degrades to a safe default if its query fails, so a
    partially-populated warehouse still yields a renderable response."""
    from data_pipeline import fetch_dashboard_data
    return fetch_dashboard_data()


# ---------------------------------------------------------------------------
# Fulfillment Simulator — Phase 1 LP optimizer endpoints [v2.02b]
# Split out from /dashboard-data so the other dashboard tabs aren't slowed
# by the Order-Triage-approval join, and so the LP can be called once per
# user click rather than per dashboard load.
# ---------------------------------------------------------------------------
@app.get("/fulfillment/incidents", response_model=FulfillmentIncidentsResponse)
def fulfillment_incidents() -> FulfillmentIncidentsResponse:
    """At-risk approved orders eligible for fulfillment simulation.

    Filter pipeline (data_pipeline._fetch_fulfillment_incidents):
      1. Take orders that were ACCEPT or PARTIAL_FULFILL in Order Triage
         (`tiger_decisions.fct_allocation_decisions`).
      2. Join against execution-risk signals (recent OTIF failures,
         low ATP, late production orders) — only orders with at least
         one active risk surface as incidents.
      3. If the decision log is empty, fall back to a small demo seed
         from `fct_otif` history so the UI is never blank.

    Scenarios are NOT included here — the front-end calls
    POST /fulfillment/simulate per incident on click.
    """
    from data_pipeline import fetch_fulfillment_incidents
    payload = fetch_fulfillment_incidents()
    return FulfillmentIncidentsResponse(**payload)


@app.post("/fulfillment/simulate", response_model=FulfillmentSimulateResponse)
def fulfillment_simulate(req: FulfillmentSimulateRequest) -> FulfillmentSimulateResponse:
    """Run the LP optimizer for one at-risk order and return two scenario
    cards (Default + Optimal Alternate) ready for the front-end.

    Synchronous, no LLM involved. Typical latency: 0.5-2s dominated by
    the two BigQuery lookups (network inventory + penalty profile)."""
    # 1) Per-plant available inventory from BigQuery (commitment-aware).
    inv_resp = get_network_inventory(
        material_number=req.material_number,
        sold_to=req.sold_to,
    )
    available_by_plant: dict[str, float] = {}
    inventory_by_plant: dict[str, dict[str, float]] = {}
    for row in inv_resp.get("rows", []):
        plant = row.get("plant_code") or ""
        if not plant:
            continue
        avail = float(row.get("available") or 0)
        available_by_plant[plant] = avail
        inventory_by_plant[plant] = {
            "ending": float(row.get("ending") or 0),
            "committed": float(row.get("committed") or 0),
            "available": avail,
        }

    # 2) Per-customer penalty rate ($/case) + region for freight lookup.
    penalty_profile = get_customer_penalty_profile(sold_to=req.sold_to)
    penalty_per_case = float(penalty_profile.get("penalty_per_case_usd") or 25.0)

    # Auto-resolve customer region from dim_customer if the frontend didn't
    # send one.  The penalty_profile query already hit dim_customer, but
    # region_state isn't exposed there — do a fast lookup.
    customer_region = req.customer_region
    if not customer_region and req.sold_to:
        try:
            from data_pipeline import _bq_client
            bq = _bq_client()
            rows = list(bq.query(
                f"SELECT customer_region_state FROM `tiger_semantic.dim_customer` "
                f"WHERE customer_number = @st LIMIT 1",
                job_config=bigquery.QueryJobConfig(
                    query_parameters=[
                        bigquery.ScalarQueryParameter("st", "STRING", req.sold_to),
                    ]
                ),
            ).result())
            if rows:
                customer_region = rows[0].get("customer_region_state")
        except Exception:
            pass  # graceful fallback — use plant defaults

    # 3) Make sure the origin plant is present in the inventory map (it may
    # have zero available — that's still a valid LP input).
    origin_plant = req.origin_plant or next(iter(available_by_plant), "ORIGIN")
    if origin_plant not in available_by_plant:
        available_by_plant[origin_plant] = 0.0
        inventory_by_plant.setdefault(origin_plant,
                                      {"ending": 0.0, "committed": 0.0, "available": 0.0})

    # 4) Delivery context: plant metadata + transit times + carriers.
    #    Queries dim_plant, fct_shipments, dim_carrier from tiger_semantic.
    plant_meta: dict[str, dict] = {}
    try:
        from data_pipeline import _bq_client as _bq_sem
        bq_sem = _bq_sem()
        plant_codes = list(available_by_plant.keys())

        # 4a) dim_plant — names, cities, types for all candidate plants
        plant_rows = list(bq_sem.query(
            "SELECT plant_code, plant_name, plant_city, plant_region, plant_type "
            "FROM `tiger_semantic.dim_plant` "
            "WHERE plant_code IN UNNEST(@plants)",
            job_config=bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ArrayQueryParameter("plants", "STRING", plant_codes),
                ]
            ),
        ).result())
        for pr in plant_rows:
            plant_meta[pr["plant_code"]] = {
                "name": pr.get("plant_name") or "",
                "city": pr.get("plant_city") or "",
                "region": pr.get("plant_region") or "",
                "type": pr.get("plant_type") or "",
            }

        # 4b) fct_shipments — avg transit hours and primary carrier per
        #     (origin_plant, destination_region) for the customer's region.
        #     fct_shipments uses mixed-case regions ("Southeast", "Mountain",
        #     "Mid-Atlantic", "Central", "Pacific") — map from our normalized
        #     keys to fct_shipments region names.
        from fulfillment_optimizer import _normalize_region
        dest_region = _normalize_region(customer_region)
        _REGION_TO_SHIPMENT_REGIONS = {
            "SOUTH": ["South"],
            "SOUTHEAST": ["Southeast"],
            "NORTHEAST": ["Northeast", "Mid-Atlantic"],
            "MIDWEST": ["Central"],
            "WEST": ["West", "Mountain", "Pacific"],
        }
        dest_ship_regions = _REGION_TO_SHIPMENT_REGIONS.get(dest_region or "", [])
        if dest_ship_regions:
            ship_rows = list(bq_sem.query(
                "SELECT origin_plant, "
                "  ROUND(AVG(transit_duration_hours), 1) AS avg_transit_hours, "
                "  APPROX_TOP_COUNT(carrier_name, 1)[OFFSET(0)].value AS primary_carrier, "
                "  COUNT(*) AS shipment_count "
                "FROM `tiger_semantic.fct_shipments` "
                "WHERE origin_plant IN UNNEST(@plants) "
                "  AND destination_region IN UNNEST(@dests) "
                "GROUP BY origin_plant",
                job_config=bigquery.QueryJobConfig(
                    query_parameters=[
                        bigquery.ArrayQueryParameter("plants", "STRING", plant_codes),
                        bigquery.ArrayQueryParameter("dests", "STRING", dest_ship_regions),
                    ]
                ),
            ).result())
            for sr in ship_rows:
                p = sr["origin_plant"]
                pm = plant_meta.setdefault(p, {})
                pm["avg_transit_hours"] = float(sr.get("avg_transit_hours") or 0) or None
                pm["primary_carrier"] = sr.get("primary_carrier")
                pm["shipment_count"] = int(sr.get("shipment_count") or 0)
        elif plant_codes:
            # No region → just get overall average per plant.
            ship_rows = list(bq_sem.query(
                "SELECT origin_plant, "
                "  ROUND(AVG(transit_duration_hours), 1) AS avg_transit_hours, "
                "  APPROX_TOP_COUNT(carrier_name, 1)[OFFSET(0)].value AS primary_carrier, "
                "  COUNT(*) AS shipment_count "
                "FROM `tiger_semantic.fct_shipments` "
                "WHERE origin_plant IN UNNEST(@plants) "
                "GROUP BY origin_plant",
                job_config=bigquery.QueryJobConfig(
                    query_parameters=[
                        bigquery.ArrayQueryParameter("plants", "STRING", plant_codes),
                    ]
                ),
            ).result())
            for sr in ship_rows:
                p = sr["origin_plant"]
                pm = plant_meta.setdefault(p, {})
                pm["avg_transit_hours"] = float(sr.get("avg_transit_hours") or 0) or None
                pm["primary_carrier"] = sr.get("primary_carrier")
                pm["shipment_count"] = int(sr.get("shipment_count") or 0)

        # 4c) dim_carrier — on-time performance target for each carrier
        carriers_seen = {
            pm.get("primary_carrier")
            for pm in plant_meta.values()
            if pm.get("primary_carrier")
        }
        if carriers_seen:
            carrier_rows = list(bq_sem.query(
                "SELECT carrier_name, carrier_scac_code, transportation_mode, "
                "  on_time_performance_target_pct "
                "FROM `tiger_semantic.dim_carrier` "
                "WHERE carrier_name IN UNNEST(@names)",
                job_config=bigquery.QueryJobConfig(
                    query_parameters=[
                        bigquery.ArrayQueryParameter("names", "STRING", list(carriers_seen)),
                    ]
                ),
            ).result())
            carrier_info = {cr["carrier_name"]: dict(cr) for cr in carrier_rows}
            for pm in plant_meta.values():
                c = pm.get("primary_carrier")
                if c and c in carrier_info:
                    ci = carrier_info[c]
                    pm["carrier_scac"] = ci.get("carrier_scac_code")
                    pm["carrier_mode"] = ci.get("transportation_mode")
                    pm["carrier_otp_target"] = ci.get("on_time_performance_target_pct")
    except Exception as exc:
        # Delivery context is best-effort — optimizer still works without it.
        log.warning("Fulfillment delivery context error: %s", exc)

    # 5) Solve.
    result = _simulate_fulfillment(
        ordered_qty=float(req.ordered_quantity_cases),
        origin_plant=origin_plant,
        customer_region=customer_region,
        available_by_plant=available_by_plant,
        penalty_per_case=penalty_per_case,
        blocked_plants=req.blocked_plants or (),
        plant_meta=plant_meta,
    )

    meta = dict(result.get("meta") or {})
    meta["inventory_by_plant"] = inventory_by_plant
    return FulfillmentSimulateResponse(
        scenarios=result.get("scenarios") or [],
        meta=meta,
    )


# ---------------------------------------------------------------------------
# Nexus co-pilot chat — Gemini via Vertex AI  [v2.02]
# ---------------------------------------------------------------------------
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Multi-turn co-pilot conversation, proxied to Gemini on Vertex AI."""
    if not req.messages:
        raise HTTPException(status_code=400, detail="No messages provided")
    try:
        import vertexai
        from vertexai.generative_models import (
            Content, GenerativeModel, Part,
        )
        vertexai.init(project=PROJECT_ID, location=REGION)

        kwargs: dict = {"model_name": "gemini-2.5-flash"}
        if req.systemPrompt:
            kwargs["system_instruction"] = req.systemPrompt
        model = GenerativeModel(**kwargs)

        # All messages except the last form the history.
        history: list = []
        for m in req.messages[:-1]:
            role = "user" if m.role == "user" else "model"
            history.append(Content(role=role,
                                    parts=[Part.from_text(m.text)]))
        chat_session = model.start_chat(history=history)

        # Vertex SDK is synchronous — run off the event loop.
        response = await asyncio.to_thread(
            chat_session.send_message, req.messages[-1].text)
        return ChatResponse(text=response.text)

    except HTTPException:
        raise
    except Exception as exc:
        log.error("Chat route error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Gemini error: {type(exc).__name__}: {exc}")


@app.get("/demo/candidates")
def demo_candidates(limit: int = 10) -> dict:
    """Data-derived demo scenario shortlist. Pin a chosen anchor via the
    DEMO_SOLD_TO / DEMO_MATERIAL env vars."""
    return get_demo_scenario_candidates(limit=limit)


# ---------------------------------------------------------------------------
# v2.3 routes — additive, non-breaking. Wrap the v2.1 contract in the
# v2.3 UI's expected shapes so the upgraded UI can run against the live
# backend without breaking the v2.1 frontend during the parallel
# transition.
#
# Contract & adapter logic live in _v23_adapter.py. These routes are
# thin wrappers; do not put business logic here.
# ---------------------------------------------------------------------------
@app.get("/v23/orders")
def v23_orders(limit: int = 10) -> dict:
    """v2.3 ORDERS[] shape — wraps get_demo_scenario_candidates and
    adapts each row to the v2.3 UI's expected field names. Flag
    derivation (above_forecast / promo / hard_block / buffer_build /
    clean) is server-side here, single source of truth for both UIs.
    """
    src = get_demo_scenario_candidates(limit=limit)
    candidates = src.get("candidates") or []
    return {
        "orders": [candidate_to_v23_order(c) for c in candidates],
        "row_count": len(candidates),
        "data_available": bool(candidates),
        "rationale": src.get("rationale"),
    }


@app.get("/data-health")
def data_health() -> dict:
    """Live freshness snapshot of every tiger_semantic view the agents
    depend on. Queries BigQuery INFORMATION_SCHEMA — no mock data.

    Used by the v2.3 UI's Data Health page. Returns one row per view
    with last_modified timestamp, age in hours, expected refresh window,
    and a status flag (FRESH / WARNING / STALE / MISSING).

    See _DATA_HEALTH_VIEW_CONFIG in agent_tools.py for the per-view
    refresh cadence + source-system config the status thresholds use.
    """
    return get_data_health()


@app.post("/v23/triage/{order_id}")
async def v23_triage(order_id: str, backend: dict) -> dict:
    """Run the full 5-agent flow for one v2.3 UI order, return the
    result in the v2.3 SYNTHESIS[order_id] shape.

    Request body: the `_backend` dict from /v23/orders for this order
    (sold_to, material_number, ordered_quantity_cases,
    requested_delivery_date, ...). The v2.3 UI round-trips that
    payload back so we can resolve the CustomerOrderEvent without
    re-querying the candidate shortlist.

    Response: { order_id, synthesis: <v2.3 SYNTHESIS entry>, session_id }
    """
    # Validate the round-tripped payload
    required = ("sold_to", "material_number")
    missing = [k for k in required if not backend.get(k)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"_backend payload missing required keys: {missing}")

    # Resolve to a CustomerOrderEvent via the demo trigger path
    try:
        order_event = from_demo_payload({
            "sold_to": backend["sold_to"],
            "material_number": backend["material_number"],
            "ordered_quantity_cases": backend.get(
                "ordered_quantity_cases"),
            "requested_delivery_date": backend.get(
                "requested_delivery_date"),
            "customer_name": backend.get("customer_name"),
            "material_description": backend.get("material_description"),
            "ship_to": backend.get("ship_to"),
        })
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not resolve v2.3 order: {exc}")

    # Run the session inline (same pattern as /sessions/sync)
    session_id = _new_session_id()
    create_session(
        session_id=session_id,
        trigger_type="manual",
        trigger_payload={**order_event.to_dict(),
                         "trigger_source": "v23_payload"},
    )
    await _run_session_tracked(session_id, "manual", order_event)
    sess = get_session(session_id)
    if not sess:
        raise HTTPException(
            status_code=500,
            detail="Session was created but cannot be read back")

    # Pull the final_action_card from session state and adapt to v2.3 shape
    decision = sess.get("final_action_card") or {}
    if not decision:
        raise HTTPException(
            status_code=500,
            detail="Session completed but produced no decision")

    return {
        "order_id": order_id,
        "session_id": session_id,
        "synthesis": decision_to_v23_synthesis(decision),
        # Bonus — also return the unmapped v2.1 contract for clients that
        # want it. Frontend can ignore.
        "raw_decision": decision,
    }


# ---------------------------------------------------------------------------
# Start a session — trigger adapter resolves the order event
# ---------------------------------------------------------------------------
@app.post("/sessions", response_model=StartSessionResponse)
async def start_session(
    req: StartSessionRequest,
    background_tasks: BackgroundTasks,
) -> StartSessionResponse:
    log.info("POST /sessions trigger_source=%s sold_to=%s material=%s", req.trigger_source, getattr(req, 'sold_to', '?'), getattr(req, 'material_number', '?'))
    try:
        if req.trigger_source == "edi_850":
            if not req.isa_control_id:
                raise HTTPException(
                    status_code=422,
                    detail="trigger_source=edi_850 requires isa_control_id")
            order_event: CustomerOrderEvent = from_edi_purchase_order(
                req.isa_control_id)
        else:  # demo_payload
            payload = req.demo_order.model_dump(exclude_none=True) \
                if req.demo_order else {}
            order_event = (from_demo_payload(payload) if payload
                           else resolve_demo_scenario())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422,
                            detail=f"Could not resolve order: {exc}")

    session_id = _new_session_id()
    create_session(
        session_id=session_id,
        trigger_type=req.trigger_type,
        trigger_payload={**order_event.to_dict(),
                         "trigger_source": req.trigger_source},
    )
    background_tasks.add_task(
        _run_session_tracked, session_id, req.trigger_type, order_event)

    return StartSessionResponse(
        session_id=session_id,
        status="active",
        trigger_source=req.trigger_source,
        resolved_order=order_event.to_dict(),
        placeholder_used=order_event._is_placeholder,
    )


@app.post("/sessions/sync")
async def start_session_sync(req: StartSessionRequest) -> dict:
    """Run the full 5-agent flow inline and return the completed session
    document (including final_action_card). One HTTP request, one
    response — no polling, no orphans, no race conditions.

    The trade-off is that the request blocks for ~60-180s depending on
    BigQuery + Gemini latency. Use this for demos / debugging on a slow
    UI; the background-task POST /sessions stays for production volume.
    """
    try:
        if req.trigger_source == "edi_850":
            if not req.isa_control_id:
                raise HTTPException(
                    status_code=422,
                    detail="trigger_source=edi_850 requires isa_control_id")
            order_event: CustomerOrderEvent = from_edi_purchase_order(
                req.isa_control_id)
        else:
            payload = req.demo_order.model_dump(exclude_none=True) \
                if req.demo_order else {}
            order_event = (from_demo_payload(payload) if payload
                           else resolve_demo_scenario())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422,
                            detail=f"Could not resolve order: {exc}")

    session_id = _new_session_id()
    create_session(
        session_id=session_id,
        trigger_type=req.trigger_type,
        trigger_payload={**order_event.to_dict(),
                         "trigger_source": req.trigger_source},
    )
    await _run_session_tracked(session_id, req.trigger_type, order_event)
    sess = get_session(session_id)
    if not sess:
        raise HTTPException(status_code=500,
                            detail="Session was created but cannot be read back")
    return sess


# Sessions whose background task was kicked off by THIS process. Any
# `active` session NOT in this set is orphaned (the task it belonged
# to is in a previous, dead container). Clock-independent, so it works
# under WSL2/Docker clock drift.
_LIVE_SESSIONS: set[str] = set()


async def _run_session_tracked(session_id: str, *args, **kwargs):
    _LIVE_SESSIONS.add(session_id)
    try:
        await run_session(session_id, *args, **kwargs)
    finally:
        _LIVE_SESSIONS.discard(session_id)


@app.get("/sessions/{session_id}")
def read_session(session_id: str) -> dict:
    sess = get_session(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    # Zombie fence: an `active` session that this process is NOT running
    # must be orphaned (its task is in a dead container). Mark error so
    # the front-end stops counting it as in-flight.
    if (sess.get("status") == "active"
            and not sess.get("ended_at")
            and session_id not in _LIVE_SESSIONS):
        sess["status"] = "error"
        sess["error"] = ("Session task is no longer running "
                         "(orphaned by a backend restart). "
                         "Re-evaluate to retry.")
    return sess


# ---------------------------------------------------------------------------
# Approve / reject
# ---------------------------------------------------------------------------
def _require_awaiting(session_id: str) -> dict:
    sess = get_session(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    if sess.get("status") != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=(f"Session is '{sess.get('status')}', not "
                    f"awaiting_approval"))
    return sess


@app.post("/sessions/{session_id}/approve", response_model=DecisionResponse)
def approve(session_id: str, req: ApprovalRequest) -> DecisionResponse:
    log.info("POST /sessions/%s/approve user_id=%s", session_id, req.user_id)
    sess = _require_awaiting(session_id)
    decision_id = approve_session(
        session_id=session_id,
        action_card=sess.get("final_action_card") or {},
        user_id=req.user_id,
        approval_notes=req.approval_notes,
    )
    return DecisionResponse(decision_id=decision_id, status="approved")


@app.post("/sessions/{session_id}/reject", response_model=DecisionResponse)
def reject(session_id: str, req: RejectionRequest) -> DecisionResponse:
    log.info("POST /sessions/%s/reject reason=%.100s", session_id, req.rejection_reason[:100] if req.rejection_reason else '')
    sess = _require_awaiting(session_id)
    decision_id = reject_session(
        session_id=session_id,
        action_card=sess.get("final_action_card") or {},
        user_id=req.user_id,
        rejection_reason=req.rejection_reason,
    )
    return DecisionResponse(decision_id=decision_id, status="rejected")


# ---------------------------------------------------------------------------
# User Execution Telemetry endpoints
# ---------------------------------------------------------------------------

@app.post("/telemetry/execution", response_model=ExecutionTelemetryWriteResponse)
def write_telemetry(req: ExecutionTelemetryRequest) -> ExecutionTelemetryWriteResponse:
    """Write one human-decision event to fct_user_execution_telemetry.

    Called by the frontend (background, non-blocking) immediately after a
    user clicks Accept / Modify / Reject in Order Triage. The local UI state
    is updated optimistically; this call persists the record to BigQuery for
    cross-session and cross-user visibility.
    """
    _ensure_telemetry_table()
    client = _bq_telemetry()
    telemetry_id = f"tel-{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    row = {
        "telemetry_id":        telemetry_id,
        "event_timestamp":     now.isoformat(),
        "po_number":           req.po_number or "",
        "sold_to":             req.sold_to or "",
        "customer_name":       req.customer_name or "",
        "material_number":     req.material_number or "",
        "ordered_qty":         req.ordered_qty,
        "agent_recommendation": req.agent_recommendation or "",
        "user_decision":       req.user_decision,
        "override_reason":     req.override_reason,
        "override_reason_code": req.override_reason_code,
        "session_id":          req.session_id,
        "decision_id":         req.decision_id,
        "outcome_note":        req.outcome_note or "",
        "user_id":             req.user_id or "planner",
        "source_tab":          req.source_tab or "order_triage",
        "created_at":          now.isoformat(),
    }
    errors = client.insert_rows_json(_TELEMETRY_TABLE, [row])
    if errors:
        log.error("Telemetry BQ insert errors: %s", errors)
        raise HTTPException(status_code=500, detail=f"BigQuery insert failed: {errors}")
    log.info("Telemetry written: id=%s decision=%s po=%s", telemetry_id, req.user_decision, req.po_number)
    return ExecutionTelemetryWriteResponse(telemetry_id=telemetry_id, status="written")


@app.get("/telemetry/execution", response_model=ExecutionTelemetryListResponse)
def read_telemetry(limit: int = 20) -> ExecutionTelemetryListResponse:
    """Return the most recent human-decision events from BigQuery.

    Called on Order Triage tab mount to populate the Recent Agent Override
    Telemetry table with real persisted data instead of mock seed values.
    Degrades to empty list if the table doesn't exist yet or the query fails.
    """
    _ensure_telemetry_table()
    client = _bq_telemetry()
    safe_limit = min(max(limit, 1), 100)
    try:
        rows = list(client.query(f"""
            SELECT
                telemetry_id,
                event_timestamp,
                po_number,
                customer_name,
                sold_to,
                agent_recommendation,
                user_decision,
                override_reason,
                outcome_note
            FROM `{_TELEMETRY_TABLE}`
            ORDER BY event_timestamp DESC
            LIMIT {safe_limit}
        """).result())
    except Exception as exc:
        log.error("Telemetry read failed: %s", exc, exc_info=True)
        return ExecutionTelemetryListResponse(entries=[], total=0)

    entries = []
    for r in rows:
        r = dict(r)
        et = r.get("event_timestamp")
        ts = et.isoformat() if hasattr(et, "isoformat") else str(et or "")
        entries.append({
            "id":                  r.get("telemetry_id") or "",
            "timestamp":           ts,
            "poNumber":            r.get("po_number") or "",
            "customer":            r.get("customer_name") or r.get("sold_to") or "",
            "agentRecommendation": r.get("agent_recommendation") or "",
            "userDecision":        (r.get("user_decision") or "").lower(),
            "overrideReason":      r.get("override_reason"),
            "outcome":             r.get("outcome_note") or "",
        })
    return ExecutionTelemetryListResponse(entries=entries, total=len(entries))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0",
                port=int(os.environ.get("PORT", "8080")))

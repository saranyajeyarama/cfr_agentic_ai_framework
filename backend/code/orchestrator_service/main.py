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
from orchestrator import run_session, approve_session, reject_session, _extract_json
from schemas import (
    StartSessionRequest, StartSessionResponse,
    ApprovalRequest, RejectionRequest, DecisionResponse,
    ChatRequest, ChatResponse,
    FulfillmentSimulateRequest, FulfillmentSimulateResponse,
    FulfillmentIncidentsResponse,
    FulfillmentRecommendRequest, FulfillmentRecommendation,
    FulfillmentRecommendResponse,
    ExecutionTelemetryRequest, ExecutionTelemetryWriteResponse,
    ExecutionTelemetryListResponse,
)
from fulfillment_optimizer import simulate as _simulate_fulfillment

# ───────── BUG-FIX-PHASE2: Fulfillment Agent imports ─────────
# Imported lazily inside _run_fulfillment_agent() to avoid loading ADK at
# module import time for endpoints that never invoke the agent.
import json as _stdlib_json
import time as _stdlib_time
from _v23_adapter import (
    candidate_to_v23_order,
    decision_to_v23_synthesis,
    _coerce_confidence,
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


# ---------------------------------------------------------------------------
# Triage result cache — fct_triage_cache
# Persists each order's synthesized agent decision so re-clicking an order
# returns the STORED result instantly and consistently, instead of re-running
# the 200s+ 5-agent flow (whose output is non-deterministic between runs).
# Two layers: an in-process dict (instant re-clicks within a live instance) +
# BigQuery tiger_decisions (durable across restarts / instances).
# ---------------------------------------------------------------------------
import json as _json

_TRIAGE_CACHE_TABLE = f"{PROJECT_ID}.tiger_decisions.fct_triage_cache"
_triage_cache_table_ready: bool = False
_TRIAGE_MEM_CACHE: dict[str, dict] = {}


def _ensure_triage_cache_table() -> None:
    """Create fct_triage_cache if it doesn't exist (idempotent)."""
    global _triage_cache_table_ready
    if _triage_cache_table_ready:
        return
    try:
        client = _bq_telemetry()
        schema = [
            bigquery.SchemaField("order_id",                "STRING",    mode="REQUIRED"),
            bigquery.SchemaField("sold_to",                 "STRING"),
            bigquery.SchemaField("material_number",         "STRING"),
            bigquery.SchemaField("ordered_quantity_cases",  "FLOAT64"),
            bigquery.SchemaField("requested_delivery_date", "STRING"),
            bigquery.SchemaField("session_id",              "STRING"),
            bigquery.SchemaField("recommendation_action",   "STRING"),
            bigquery.SchemaField("confidence",              "FLOAT64"),
            bigquery.SchemaField("synthesis_json",          "STRING"),
            bigquery.SchemaField("raw_decision_json",       "STRING"),
            bigquery.SchemaField("created_at",              "TIMESTAMP", mode="REQUIRED"),
            # Wall-clock time the 5-agent run took — drives the Watchtower
            # "AI Resolution" KPI (avg minutes). Nullable for legacy rows.
            bigquery.SchemaField("duration_ms",             "FLOAT64"),
        ]
        table = bigquery.Table(_TRIAGE_CACHE_TABLE, schema=schema)
        table.time_partitioning = bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY, field="created_at")
        table.description = (
            "Order Triage agent-synthesis cache. One row per /v23/triage run; "
            "the latest row per order_id is replayed so re-evaluating an order "
            "returns the stored, consistent result without re-running the "
            "5-agent flow. Written by POST /v23/triage, read on cache-hit + "
            "by GET /v23/triage/{order_id}/cached.")
        client.create_table(table, exists_ok=True)
        # Idempotent: ensure duration_ms exists on a table created before this
        # column was added (BQ supports ADD COLUMN IF NOT EXISTS). Best-effort.
        try:
            client.query(
                f"ALTER TABLE `{_TRIAGE_CACHE_TABLE}` "
                f"ADD COLUMN IF NOT EXISTS duration_ms FLOAT64"
            ).result()
        except Exception as exc:
            log.warning("Triage cache duration_ms ALTER skipped: %s", exc)
        _triage_cache_table_ready = True
        log.info("Triage cache table ready: %s", _TRIAGE_CACHE_TABLE)
    except Exception as exc:
        log.warning("Triage cache table ensure failed: %s", exc)


def _read_triage_cache(order_id: str) -> dict | None:
    """Return cached {order_id, session_id, synthesis, raw_decision, cached_at}
    for order_id, or None. Checks the in-process layer first, then BigQuery
    (latest row by created_at)."""
    mem = _TRIAGE_MEM_CACHE.get(order_id)
    if mem:
        return mem
    _ensure_triage_cache_table()
    try:
        client = _bq_telemetry()
        rows = list(client.query(
            f"""
            SELECT session_id, synthesis_json, raw_decision_json,
                   CAST(created_at AS STRING) AS created_at
            FROM `{_TRIAGE_CACHE_TABLE}`
            WHERE order_id = @oid
            ORDER BY created_at DESC
            LIMIT 1
            """,
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("oid", "STRING", order_id)]),
        ).result())
    except Exception as exc:
        log.warning("Triage cache read failed for %s: %s", order_id, exc)
        return None
    if not rows:
        return None
    r = dict(rows[0])
    try:
        synthesis = _json.loads(r.get("synthesis_json") or "{}")
        raw_decision = _json.loads(r.get("raw_decision_json") or "{}")
    except Exception:
        return None
    entry = {
        "order_id":     order_id,
        "session_id":   r.get("session_id") or "",
        "synthesis":    synthesis,
        "raw_decision": raw_decision,
        "cached_at":    r.get("created_at"),
    }
    _TRIAGE_MEM_CACHE[order_id] = entry
    return entry


def _write_triage_cache(order_id: str, backend: dict, session_id: str,
                        synthesis: dict, raw_decision: dict,
                        duration_ms: float | None = None) -> None:
    """Persist a triage result to the in-process cache (L1) + BigQuery (L2)."""
    now = datetime.now(timezone.utc)
    _TRIAGE_MEM_CACHE[order_id] = {
        "order_id":     order_id,
        "session_id":   session_id,
        "synthesis":    synthesis,
        "raw_decision": raw_decision,
        "cached_at":    now.isoformat(),
    }
    _ensure_triage_cache_table()
    try:
        rec = (synthesis.get("rec") or {}) if isinstance(synthesis, dict) else {}
        row = {
            "order_id":                order_id,
            "sold_to":                 backend.get("sold_to"),
            "material_number":         backend.get("material_number"),
            "ordered_quantity_cases":  backend.get("ordered_quantity_cases"),
            "requested_delivery_date": backend.get("requested_delivery_date"),
            "session_id":              session_id,
            "recommendation_action":   rec.get("action"),
            "confidence":              rec.get("confidence"),
            "synthesis_json":          _json.dumps(synthesis),
            "raw_decision_json":       _json.dumps(raw_decision, default=str),
            "created_at":              now.isoformat(),
            "duration_ms":             duration_ms,
        }
        errors = _bq_telemetry().insert_rows_json(_TRIAGE_CACHE_TABLE, [row])
        if errors:
            log.error("Triage cache insert errors: %s", errors)
        else:
            log.info("Triage cached: order=%s session=%s", order_id, session_id)
    except Exception as exc:
        log.warning("Triage cache write failed for %s: %s", order_id, exc)


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


# ─────────────────────────────────────────────────────────────────────────
# BUG-FIX-PHASE2: Fulfillment Agent runner + feature-flag dispatch
# ─────────────────────────────────────────────────────────────────────────
# When FULFILLMENT_USE_AGENT is truthy, /fulfillment/simulate routes to
# the Gemini-backed Fulfillment Agent instead of the LP solver. The LP
# code path is preserved unchanged — flipping the env var swaps engines
# at request time without any code change.

def _safe_float(v, default: float = 0.0) -> float:
    """Coerce strings/None/bad types to float. Defensive against LLM drift
    where numeric fields come back as strings ('1.80') or null."""
    try:
        if v is None or v == "":
            return float(default)
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def _safe_bool(v, default: bool = False) -> bool:
    """Coerce truthy strings/ints to bool. LLMs sometimes emit 'true'
    as a string or 1 as an int instead of a proper boolean."""
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in ("true", "yes", "1", "y")
    return default


def _safe_str_list(v) -> list[str]:
    """Coerce a single string (drift pattern) into a 1-item list. Also
    filters out empty strings."""
    if v is None:
        return []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    return []


def _normalize_fulfillment_decision(
    decision_json: dict,
    req: FulfillmentSimulateRequest,
    customer_region: Optional[str],
    elapsed_ms: int,
) -> FulfillmentSimulateResponse:
    """Defensively reshape FulfillmentAgentDecision into FulfillmentSimulateResponse.

    Handles known LLM drift patterns:
      - Numeric strings instead of floats ('5.20' -> 5.20)
      - Boolean strings instead of booleans ('true' -> True)
      - Single string instead of list (rationale/tradeoffs)
      - Sum of cases_allocated > ordered_quantity_cases (warn + clamp)
      - cases_allocated > available_cases per plant (warn + clamp)
      - Missing is_recommended (default first scenario after Default)
      - Empty scenarios list (raise — handler falls back to LP)
      - 'action'/'disposition' drift on scenario level (treat as is_recommended)

    Logs every drift detected so we can audit prompt quality over time.
    """
    ordered_qty = float(req.ordered_quantity_cases or 0)
    agent_scenarios = decision_json.get("scenarios") or []

    if not isinstance(agent_scenarios, list) or not agent_scenarios:
        raise RuntimeError(
            "Fulfillment agent returned no scenarios; "
            f"top-level keys: {list(decision_json.keys())}"
        )

    norm_scenarios: list[dict] = []
    for idx, s in enumerate(agent_scenarios):
        if not isinstance(s, dict):
            log.warning("[NORM-FUL] scenario[%d] is not a dict (got %s); skipping",
                        idx, type(s).__name__)
            continue

        # ── plant_details — type coerce + cap at available ─────────────
        plant_details: list[dict] = []
        sum_allocated = 0.0
        for pd_idx, pd in enumerate(s.get("plant_details") or []):
            if not isinstance(pd, dict):
                log.warning("[NORM-FUL] scenario[%d].plant_details[%d] not dict; skip",
                            idx, pd_idx)
                continue
            allocated = _safe_float(pd.get("cases_allocated"))
            available = _safe_float(pd.get("available_cases"), default=allocated)
            # Cap allocation at the agent's own reported available.
            if available > 0 and allocated > available:
                log.warning("[NORM-FUL] scenario[%d] plant=%s allocated=%s > available=%s — clamping",
                            idx, pd.get("plant_code"), allocated, available)
                allocated = available
            sum_allocated += allocated
            plant_details.append({
                "code": pd.get("plant_code") or "",
                "name": pd.get("plant_name") or "",
                "city": pd.get("plant_city") or "",
                "type": pd.get("plant_type") or "",
                "qty": allocated,
                "transitHours": _safe_float(pd.get("transit_hours"), default=None)
                                  if pd.get("transit_hours") is not None else None,
                "carrier": pd.get("carrier") or None,
            })

        # ── enforce total ≤ ordered_qty ─────────────────────────────────
        if sum_allocated > ordered_qty * 1.01:  # 1% tolerance for float
            log.warning("[NORM-FUL] scenario[%d] total allocated=%s > ordered_qty=%s — "
                        "agent overcommitted; trusting agent but flagging",
                        idx, sum_allocated, ordered_qty)

        # ── is_recommended — handle disposition/action drift ─────────────
        is_rec_raw = (s.get("is_recommended")
                      if "is_recommended" in s
                      else s.get("recommended")
                      or s.get("disposition")
                      or s.get("action"))
        # Treat disposition/action string values as recommended only if
        # they're affirmative ("ACCEPT", "RECOMMEND", "YES", "TRUE")
        is_rec = False
        if isinstance(is_rec_raw, bool):
            is_rec = is_rec_raw
        elif isinstance(is_rec_raw, str):
            is_rec = is_rec_raw.strip().upper() in (
                "TRUE", "YES", "RECOMMEND", "RECOMMENDED", "ACCEPT", "AGENT", "OPTIMAL")
        else:
            is_rec = _safe_bool(is_rec_raw)

        # ── numeric fields with type coercion ────────────────────────────
        freight = _safe_float(s.get("freight_cost"))
        fine = _safe_float(s.get("fine"))
        net_impact = s.get("net_impact")
        if net_impact is None:
            # Reconstruct if missing.
            net_impact = -(freight + fine)
        else:
            net_impact = _safe_float(net_impact)
        savings = _safe_float(s.get("savings_vs_default"))

        # ── rationale — string (allow single-item list drift) ───────────
        rationale_raw = s.get("rationale")
        if isinstance(rationale_raw, list):
            rationale = " ".join(str(x) for x in rationale_raw if x)
            log.warning("[NORM-FUL] scenario[%d] rationale was a list; joined to string", idx)
        else:
            rationale = str(rationale_raw or "")

        # BUG-FIX-PHASE2 / Step A: preserve per-scenario tradeoffs so the UI
        # can render them as bullets under each card's rationale. Uses
        # _safe_str_list to handle the single-string drift pattern.
        scenario_tradeoffs = _safe_str_list(s.get("tradeoffs"))

        norm_scenarios.append({
            "id": s.get("id") or f"scenario-{idx}",
            "name": s.get("name") or "",
            "tagline": s.get("tagline") or "",
            "arrival": s.get("arrival") or "",
            "dcSource": s.get("dc_source") or s.get("dcSource") or "",
            "freightCost": freight,
            "fine": fine,
            "netImpact": net_impact,
            "savingsVsDefault": savings,
            "isRecommended": is_rec,
            "rationale": rationale,
            "tradeoffs": scenario_tradeoffs,
            "transitHours": _safe_float(s.get("transit_hours"), default=None)
                              if s.get("transit_hours") is not None else None,
            "carrierName": s.get("carrier_name") or s.get("carrierName") or None,
            "plantDetails": plant_details,
        })

    # ── ensure exactly one scenario is flagged as recommended ───────────
    n_recommended = sum(1 for s in norm_scenarios if s["isRecommended"])
    if n_recommended == 0 and len(norm_scenarios) >= 2:
        log.warning("[NORM-FUL] no scenario marked is_recommended; defaulting to scenario[1] "
                    "(typically the Agent Recommendation)")
        norm_scenarios[1]["isRecommended"] = True
    elif n_recommended > 1:
        log.warning("[NORM-FUL] %d scenarios marked is_recommended; keeping the last one",
                    n_recommended)
        # Keep only the last; clear the rest.
        last_idx = max(i for i, s in enumerate(norm_scenarios) if s["isRecommended"])
        for i, s in enumerate(norm_scenarios):
            s["isRecommended"] = (i == last_idx)

    # ── aggregate tradeoffs from all scenarios (deduplicated) ───────────
    agent_tradeoffs: list[str] = []
    for s in agent_scenarios:
        if not isinstance(s, dict):
            continue
        for t in _safe_str_list(s.get("tradeoffs")):
            if t and t not in agent_tradeoffs:
                agent_tradeoffs.append(t)

    # ── meta — same shape as LP path, with engine indicator ─────────────
    meta = {
        "solver_status": "Optimal",
        "elapsed_ms": elapsed_ms,
        "freight_costs_used": {},
        "penalty_per_case": _safe_float(decision_json.get("penalty_per_case_usd")),
        "ordered_qty": ordered_qty,
        "origin_plant": req.origin_plant,
        "customer_region": customer_region,
        "inventory_by_plant": {
            p: {"available": _safe_float(c), "ending": _safe_float(c), "committed": 0.0}
            for p, c in (decision_json.get("inventory_snapshot_used") or {}).items()
        },
        "engine": "agent",
        "engine_note": "Fulfillment Agent (Gemini 2.5 Pro)",
        "agent_decision_summary": decision_json.get("decision_summary") or None,
        "agent_confidence": _safe_float(decision_json.get("confidence"), default=None)
                             if decision_json.get("confidence") is not None else None,
        "agent_tradeoffs": agent_tradeoffs,
        "user_constraints_applied": _safe_str_list(
            decision_json.get("user_constraints_applied")),
        "blocked_plants_applied": _safe_str_list(
            decision_json.get("blocked_plants_applied")),
    }

    return FulfillmentSimulateResponse(
        scenarios=norm_scenarios,
        meta=meta,
    )


def _fulfillment_engine() -> str:
    """Return 'agent' or 'deterministic_lp' based on the env var.

    Read on each request so the operator can toggle without a restart
    (e.g. via Cloud Run config). Default is 'deterministic_lp' for
    safety — the LP has been in production; the agent is new.
    """
    flag = (os.environ.get("FULFILLMENT_USE_AGENT", "") or "").strip().lower()
    return "agent" if flag in ("1", "true", "yes", "on") else "deterministic_lp"


async def _run_fulfillment_agent(
    req: FulfillmentSimulateRequest,
) -> FulfillmentSimulateResponse:
    """Invoke the Fulfillment Agent and normalize its output to the
    FulfillmentSimulateResponse shape the front-end already renders.

    Reuses the agent's own tool calls — the agent itself queries
    fct_inventory_projection, fct_chargebacks, freight_costs.json, etc.
    via its bound tools. We just hand it the order payload and trust
    its 5-step reasoning to produce the two scenarios.

    Defensive: any failure here falls back to the LP path so a broken
    agent doesn't blank out the UI.
    """
    # Lazy imports — keep agent dependencies out of cold-path code.
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types
    from agents import get_agent
    from orchestrator import _extract_json
    from data_pipeline import _bq_client as _bq_sem

    t0 = _stdlib_time.time()

    # Resolve customer region the same way the LP path does, so the
    # agent's lookup_freight_cost calls return real lane rates.
    customer_region = req.customer_region
    if not customer_region and req.sold_to:
        try:
            bq = _bq_sem()
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
            pass

    # Build the payload the agent receives. Mirrors the fields listed
    # in agents/fulfillment_agent.md → "THE ORDER YOU RECEIVE".
    payload = {
        "sold_to": req.sold_to,
        "material_number": req.material_number,
        "ordered_quantity_cases": float(req.ordered_quantity_cases),
        "requested_delivery_date": req.requested_delivery_date,
        "origin_plant": req.origin_plant,
        "customer_region": customer_region,
        "blocked_plants": list(req.blocked_plants or []),
        "user_constraints": getattr(req, "user_constraints", "") or "",
    }

    agent = get_agent("fulfillment")
    app_name = "tiger-fulfillment-agent"
    session_service = InMemorySessionService()
    session_id = f"fulfillment-{int(_stdlib_time.time()*1000)}-{uuid.uuid4().hex[:6]}"
    user_id = "fulfillment-caller"

    await session_service.create_session(
        app_name=app_name, user_id=user_id, session_id=session_id,
    )
    runner = Runner(
        app_name=app_name, agent=agent, session_service=session_service,
    )
    user_msg = genai_types.Content(
        role="user",
        parts=[genai_types.Part.from_text(text=_stdlib_json.dumps(payload))],
    )

    decision_json: dict | None = None
    raw_text = ""
    try:
        async for event in runner.run_async(
            user_id=user_id, session_id=session_id, new_message=user_msg,
        ):
            if event.is_final_response() and event.content and event.content.parts:
                raw_text = "".join(
                    p.text for p in event.content.parts
                    if getattr(p, "text", None)
                )
                decision_json = _extract_json(raw_text)
                # ───────── BUG-FIX-PHASE2 / Option B: persist raw agent response ─────
                # Same pattern as orchestrator._save_raw_response for the 5 triage
                # agents. Defensive: any failure here is swallowed so the request
                # still succeeds. Files land in backend/agent_raw_responses/ and
                # follow the naming convention: {ts}_fulfillment_{adk_session}.json
                try:
                    from orchestrator import _save_raw_response as _fa_save
                    _fa_save("fulfillment", session_id, raw_text, decision_json)
                except Exception as _save_err:
                    log.warning("Fulfillment raw response save failed: %s", _save_err)
    finally:
        try:
            await session_service.delete_session(
                app_name=app_name, user_id=user_id, session_id=session_id,
            )
        except Exception:
            pass

    elapsed_ms = int((_stdlib_time.time() - t0) * 1000)
    log.info("Fulfillment agent run complete elapsed_ms=%d parsed=%s",
             elapsed_ms, decision_json is not None)

    if not decision_json:
        # Agent didn't produce valid JSON — bubble up to the LP fallback.
        raise RuntimeError(
            "Fulfillment agent returned non-JSON output; "
            f"raw response was: {raw_text[:500]}"
        )

    # ───── BUG-FIX-PHASE2 / Step 5: defensive normalization ─────
    # All drift-handling lives in _normalize_fulfillment_decision so
    # this function stays focused on the ADK invocation. The normalizer
    # logs every drift it detects so we can audit prompt quality.
    return _normalize_fulfillment_decision(
        decision_json=decision_json,
        req=req,
        customer_region=customer_region,
        elapsed_ms=elapsed_ms,
    )


@app.post("/fulfillment/simulate", response_model=FulfillmentSimulateResponse)
async def fulfillment_simulate(req: FulfillmentSimulateRequest) -> FulfillmentSimulateResponse:
    """Run the LP optimizer (default) OR the Fulfillment Agent (when
    FULFILLMENT_USE_AGENT=true) and return two scenario cards (Default +
    Optimal Alternate) ready for the front-end.

    Engine selection happens per-request via env var so an operator can
    toggle between the deterministic LP and the agent without a restart.
    If the agent fails (non-JSON output, tool error, timeout), the
    request transparently falls back to the LP — the user always gets
    a response.

    LP path: synchronous, no LLM. ~1-2s, dominated by 2 BigQuery lookups.
    Agent path: async, Gemini-backed. ~5-15s, includes 4-6 tool calls.
    """
    engine = _fulfillment_engine()
    log.info("Fulfillment simulate engine=%s sold_to=%s material=%s qty=%s",
             engine, req.sold_to, req.material_number, req.ordered_quantity_cases)
    if engine == "agent":
        try:
            return await _run_fulfillment_agent(req)
        except Exception as exc:
            log.warning("Fulfillment agent failed (%s); falling back to LP", exc)
            # fall through to LP path below — user gets a response.


    # 1) Per-plant available inventory from BigQuery (commitment-aware).
    # ───────── BUG-FIX-PHASE2: pass RDD so widget reflects delivery week ─────
    # When the Order Triage Inventory Snapshot calls this endpoint, the
    # request body carries requested_delivery_date. Forward it so the
    # tool can anchor on the delivery window instead of the earliest
    # projection week (which was 2024 historical data after the data
    # team's table refresh). Fulfillment Simulator clients that don't
    # pass RDD continue to get the earliest-week behavior.
    inv_resp = get_network_inventory(
        material_number=req.material_number,
        sold_to=req.sold_to,
        requested_delivery_date=req.requested_delivery_date,
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
    # Surface commitment-aware ATP context (from get_network_inventory) so the
    # UI / debuggers can see how much was reserved against on-hand for this SKU.
    meta["committed_total"] = inv_resp.get("committed_total", 0.0)
    meta["commitments_subtracted"] = inv_resp.get("commitments_subtracted", False)
    meta["inventory_note"] = inv_resp.get("note")
    # ───────── BUG-FIX-PHASE2: engine indicator for the UI badge ─────────
    meta["engine"] = "deterministic_lp"
    meta["engine_note"] = "PuLP/CBC linear-programming solver"
    return FulfillmentSimulateResponse(
        scenarios=result.get("scenarios") or [],
        meta=meta,
    )


# ---------------------------------------------------------------------------
# Agentic fulfillment recommendation — POST /fulfillment/recommend
# An LLM reasons over the LP candidate scenarios + risk/penalty/tier context
# and picks the scenario + rationale. On-demand (button-triggered), cached per
# (incident_id, scenarios_hash). Deterministic rule fallback when Vertex AI is
# unavailable (currently 403 SERVICE_DISABLED) — never raises to the client.
# ---------------------------------------------------------------------------
import hashlib as _hashlib

_FULFILLMENT_REC_TABLE = f"{PROJECT_ID}.tiger_decisions.fct_fulfillment_recommendation_cache"
_fulfillment_rec_table_ready: bool = False
_FULFILLMENT_REC_MEM_CACHE: dict[str, dict] = {}


def _scenarios_hash(scenarios: list) -> str:
    """Stable hash of the candidate set so a re-simulate (e.g. with
    blocked_plants) that changes the scenarios is a cache MISS."""
    parts = []
    for s in scenarios or []:
        d = s if isinstance(s, dict) else (s.model_dump() if hasattr(s, "model_dump") else {})
        parts.append(f"{d.get('id')}:{d.get('freightCost')}:{d.get('fine')}:{d.get('savingsVsDefault')}")
    return _hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


def _ensure_fulfillment_rec_cache_table() -> None:
    global _fulfillment_rec_table_ready
    if _fulfillment_rec_table_ready:
        return
    try:
        client = _bq_telemetry()
        schema = [
            bigquery.SchemaField("incident_id",             "STRING",    mode="REQUIRED"),
            bigquery.SchemaField("sold_to",                 "STRING"),
            bigquery.SchemaField("material_number",         "STRING"),
            bigquery.SchemaField("ordered_quantity_cases",  "FLOAT64"),
            bigquery.SchemaField("recommended_scenario_id", "STRING"),
            bigquery.SchemaField("confidence",              "FLOAT64"),
            bigquery.SchemaField("recommendation_source",   "STRING"),
            bigquery.SchemaField("rationale",               "STRING"),
            bigquery.SchemaField("key_considerations_json", "STRING"),
            bigquery.SchemaField("scenarios_hash",          "STRING"),
            bigquery.SchemaField("recommendation_json",     "STRING"),
            bigquery.SchemaField("created_at",              "TIMESTAMP", mode="REQUIRED"),
        ]
        table = bigquery.Table(_FULFILLMENT_REC_TABLE, schema=schema)
        table.time_partitioning = bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY, field="created_at")
        table.description = (
            "Agentic Fulfillment Simulator recommendation cache. One row per "
            "/fulfillment/recommend run; the latest row per (incident_id, "
            "scenarios_hash) is replayed so re-evaluating an incident returns "
            "the stored verdict without re-calling the LLM. A re-simulate that "
            "changes the candidate scenarios produces a new hash → cache MISS.")
        client.create_table(table, exists_ok=True)
        _fulfillment_rec_table_ready = True
        log.info("Fulfillment recommendation cache table ready: %s", _FULFILLMENT_REC_TABLE)
    except Exception as exc:
        log.warning("Fulfillment rec cache table ensure failed: %s", exc)


def _read_fulfillment_rec_cache(incident_id: str, scenarios_hash: str) -> dict | None:
    mem_key = f"{incident_id}|{scenarios_hash}"
    mem = _FULFILLMENT_REC_MEM_CACHE.get(mem_key)
    if mem:
        return mem
    _ensure_fulfillment_rec_cache_table()
    try:
        client = _bq_telemetry()
        rows = list(client.query(
            f"""
            SELECT recommendation_json, CAST(created_at AS STRING) AS created_at
            FROM `{_FULFILLMENT_REC_TABLE}`
            WHERE incident_id = @id AND scenarios_hash = @h
            ORDER BY created_at DESC
            LIMIT 1
            """,
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("id", "STRING", incident_id),
                bigquery.ScalarQueryParameter("h", "STRING", scenarios_hash)]),
        ).result())
    except Exception as exc:
        log.warning("Fulfillment rec cache read failed for %s: %s", incident_id, exc)
        return None
    if not rows:
        return None
    r = dict(rows[0])
    try:
        rec = _json.loads(r.get("recommendation_json") or "{}")
    except Exception:
        return None
    entry = {"recommendation": rec, "cached_at": r.get("created_at")}
    _FULFILLMENT_REC_MEM_CACHE[mem_key] = entry
    return entry


def _write_fulfillment_rec_cache(req: FulfillmentRecommendRequest, scenarios_hash: str,
                                 rec: dict) -> None:
    now = datetime.now(timezone.utc)
    mem_key = f"{req.incident_id}|{scenarios_hash}"
    _FULFILLMENT_REC_MEM_CACHE[mem_key] = {"recommendation": rec, "cached_at": now.isoformat()}
    _ensure_fulfillment_rec_cache_table()
    try:
        row = {
            "incident_id":             req.incident_id,
            "sold_to":                 req.sold_to,
            "material_number":         req.material_number,
            "ordered_quantity_cases":  req.ordered_quantity_cases,
            "recommended_scenario_id": rec.get("recommended_scenario_id"),
            "confidence":              rec.get("confidence"),
            "recommendation_source":   rec.get("recommendation_source"),
            "rationale":               rec.get("rationale"),
            "key_considerations_json": _json.dumps(rec.get("key_considerations") or []),
            "scenarios_hash":          scenarios_hash,
            "recommendation_json":     _json.dumps(rec),
            "created_at":              now.isoformat(),
        }
        errors = _bq_telemetry().insert_rows_json(_FULFILLMENT_REC_TABLE, [row])
        if errors:
            log.error("Fulfillment rec cache insert errors: %s", errors)
    except Exception as exc:
        log.warning("Fulfillment rec cache write failed for %s: %s", req.incident_id, exc)


def _rule_recommendation(req: FulfillmentRecommendRequest) -> dict:
    """Deterministic fallback when the LLM is unavailable. Picks the
    optimizer-preferred scenario, else the best savings, else the default."""
    scenarios = [s.model_dump() if hasattr(s, "model_dump") else dict(s)
                 for s in (req.scenarios or [])]
    if not scenarios:
        return {"recommended_scenario_id": "scenario-a-default", "rationale":
                "No scenarios available to evaluate.", "confidence": 0.3,
                "key_considerations": [], "recommendation_source": "rule"}
    chosen = next((s for s in scenarios if s.get("lpPreferred")), None)
    if chosen is None:
        viable = [s for s in scenarios if (s.get("savingsVsDefault") or 0) > 0]
        chosen = max(viable, key=lambda s: s.get("savingsVsDefault") or 0) if viable else None
    if chosen is None:
        chosen = next((s for s in scenarios if s.get("id") == "scenario-a-default"), scenarios[0])

    ctx = req.context or {}
    single = ctx.get("single_source_possible")
    n_open = chosen.get("plantsOpened")
    considerations = []
    if single and (n_open == 1 or chosen.get("id") == "scenario-a-default"):
        considerations.append("A single plant covers the full order — single-sourcing avoids split-shipment handling.")
    if (chosen.get("savingsVsDefault") or 0) > 0:
        considerations.append(f"Chosen plan saves ${int(chosen['savingsVsDefault']):,} vs the default route after shipment friction.")
    if ctx.get("penalty_per_case"):
        considerations.append(f"OTIF penalty is ${ctx.get('penalty_per_case')}/case — fulfilling on time avoids it.")
    if chosen.get("fine"):
        considerations.append(f"This plan still carries a ${int(chosen['fine']):,} OTIF penalty on the shortfall.")
    return {
        "recommended_scenario_id": chosen.get("id", "scenario-a-default"),
        "rationale": chosen.get("rationale") or "Selected on lowest total cost (freight + penalty + shipment friction).",
        "confidence": 0.5,
        "key_considerations": considerations or ["Rule-based selection on lowest total economic cost."],
        "recommendation_source": "rule",
    }


_FULFILLMENT_REC_SYSTEM_PROMPT = (
    "You are a senior fulfillment planner for Tiger Foods Customer Supply Operations. "
    "Given an at-risk order and a small set of candidate fulfillment scenarios from the "
    "optimizer, choose the single best scenario and justify it. Weigh: prefer SINGLE-SOURCING "
    "unless a split saves materially more than its operational friction (each extra plant/shipment "
    "is real handling cost); the OTIF penalty per case (high penalty -> avoid any shortfall); the "
    "customer's priority tier and MABD enforcement; recent OTIF failures and chargeback exposure; "
    "the number of plants opened; and arrival/transit risk. "
    "Return ONLY a single valid JSON object (no prose, no markdown fences) with EXACTLY these keys: "
    '{"recommended_scenario_id": <one of the provided scenario ids>, '
    '"rationale": <2-3 sentence plain-English justification>, '
    '"confidence": <number 0..1>, '
    '"key_considerations": <array of 2-4 short strings>}.'
)


@app.post("/fulfillment/recommend", response_model=FulfillmentRecommendResponse)
async def fulfillment_recommend(
    req: FulfillmentRecommendRequest, force: bool = False,
) -> FulfillmentRecommendResponse:
    """Agentic recommendation over the (already-computed) LP scenarios. Cached
    per (incident_id, scenarios_hash). Falls back to a deterministic rule when
    Vertex AI is unavailable so the feature works regardless of the 403 state."""
    valid_ids = {(s.id if hasattr(s, "id") else s.get("id")) for s in (req.scenarios or [])}
    s_hash = _scenarios_hash(req.scenarios)

    # 1) Cache hit → replay.
    if not force:
        cached = _read_fulfillment_rec_cache(req.incident_id, s_hash)
        if cached:
            return FulfillmentRecommendResponse(
                incident_id=req.incident_id,
                recommendation=FulfillmentRecommendation(**cached["recommendation"]),
                cached=True, cached_at=cached.get("cached_at"))

    rec_dict: dict | None = None
    # 2) Try the LLM.
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel
        vertexai.init(project=PROJECT_ID, location=REGION)
        model = GenerativeModel(model_name="gemini-2.5-flash",
                                system_instruction=_FULFILLMENT_REC_SYSTEM_PROMPT)
        user_payload = {
            "order": {
                "incident_id": req.incident_id,
                "sold_to": req.sold_to,
                "ordered_quantity_cases": req.ordered_quantity_cases,
            },
            "context": req.context,
            "scenarios": [
                (s.model_dump() if hasattr(s, "model_dump") else dict(s))
                for s in (req.scenarios or [])
            ],
        }
        resp = await asyncio.to_thread(model.generate_content, _json.dumps(user_payload))
        parsed = _extract_json(getattr(resp, "text", "") or "")
        if parsed and parsed.get("recommended_scenario_id") in valid_ids:
            rec_dict = {
                "recommended_scenario_id": parsed["recommended_scenario_id"],
                "rationale": str(parsed.get("rationale") or "")[:1200],
                "confidence": _coerce_confidence(parsed.get("confidence")),
                "key_considerations": [str(x) for x in (parsed.get("key_considerations") or [])][:6],
                "recommendation_source": "agent",
            }
        else:
            log.warning("Fulfillment agent returned unusable JSON (id not in %s) — rule fallback", valid_ids)
    except Exception as exc:
        log.warning("Fulfillment agent LLM call failed (%s) — rule fallback", type(exc).__name__)

    # 3) Deterministic fallback.
    if rec_dict is None:
        rec_dict = _rule_recommendation(req)

    # 4) Persist + return.
    _write_fulfillment_rec_cache(req, s_hash, rec_dict)
    return FulfillmentRecommendResponse(
        incident_id=req.incident_id,
        recommendation=FulfillmentRecommendation(**rec_dict),
        cached=False)


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


@app.get("/v23/triage/{order_id}/cached")
def v23_triage_cached(order_id: str) -> dict:
    """Cache-only peek: return the stored synthesis for order_id if a prior
    /v23/triage run was persisted, else {cached: false}. Lets the UI replay a
    result instantly on order-select without re-running the 5-agent flow."""
    cached = _read_triage_cache(order_id)
    if not cached:
        return {"order_id": order_id, "cached": False}
    return {
        "order_id":     order_id,
        "cached":       True,
        "session_id":   cached["session_id"],
        "synthesis":    cached["synthesis"],
        "raw_decision": cached["raw_decision"],
        "cached_at":    cached.get("cached_at"),
    }


@app.post("/v23/triage/{order_id}")
async def v23_triage(order_id: str, backend: dict, force: bool = False) -> dict:
    """Run the full 5-agent flow for one v2.3 UI order, return the
    result in the v2.3 SYNTHESIS[order_id] shape.

    Request body: the `_backend` dict from /v23/orders for this order
    (sold_to, material_number, ordered_quantity_cases,
    requested_delivery_date, ...). The v2.3 UI round-trips that
    payload back so we can resolve the CustomerOrderEvent without
    re-querying the candidate shortlist.

    Caching: the synthesized result is persisted to tiger_decisions.
    fct_triage_cache. Unless `?force=true`, a cached result for this
    order_id is returned immediately (no agent run) so re-evaluating is
    instant + consistent. `force=true` re-runs the agents and overwrites.

    Response: { order_id, synthesis, session_id, raw_decision, cached }
    """
    # Validate the round-tripped payload
    required = ("sold_to", "material_number")
    missing = [k for k in required if not backend.get(k)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"_backend payload missing required keys: {missing}")

    # Cache hit → replay the stored synthesis, skip the 5-agent run.
    if not force:
        cached = _read_triage_cache(order_id)
        if cached:
            log.info("Triage cache HIT order=%s session=%s",
                     order_id, cached.get("session_id"))
            return {
                "order_id":     order_id,
                "session_id":   cached["session_id"],
                "synthesis":    cached["synthesis"],
                "raw_decision": cached["raw_decision"],
                "cached":       True,
                "cached_at":    cached.get("cached_at"),
            }

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
    _run_t0 = datetime.now(timezone.utc)
    await _run_session_tracked(session_id, "manual", order_event)
    _run_duration_ms = (datetime.now(timezone.utc) - _run_t0).total_seconds() * 1000.0
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

    synthesis = decision_to_v23_synthesis(decision)
    # Persist so re-evaluating this order replays the stored result.
    _write_triage_cache(order_id, backend, session_id, synthesis, decision,
                        duration_ms=_run_duration_ms)

    return {
        "order_id": order_id,
        "session_id": session_id,
        "synthesis": synthesis,
        # Bonus — also return the unmapped v2.1 contract for clients that
        # want it. Frontend can ignore.
        "raw_decision": decision,
        "cached": False,
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


# ---------------------------------------------------------------------------
# Decision Log — durable, paginated audit trail
# ---------------------------------------------------------------------------
@app.get("/decision-log")
def decision_log(limit: int = 200, offset: int = 0) -> dict:
    """Paginated audit trail of agentic decisions (newest first), read from
    tiger_decisions.fct_allocation_decisions.

    Returns { total_count, filtered_count, decisions[] }. Each decision row
    carries the full audit surface — action (agent recommendation), fulfill
    qty, fill_rate_pct, user_id, rationale, rejection_reason, session_id,
    orchestrator_version, alignment, outcome, and OTIF penalty exposure.
    On a hard failure returns 500 so the UI can fall back to its in-memory
    current-session view.
    """
    from data_pipeline import fetch_decision_log_page
    try:
        return fetch_decision_log_page(limit=limit, offset=offset)
    except Exception as exc:
        log.error("decision-log fetch failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Decision log unavailable")


# ---------------------------------------------------------------------------
# Root Cause Hub + Safety Stock Optimizer — dedicated single-responsibility APIs
# (split out of /dashboard-data so each tab fetches only what it needs)
# ---------------------------------------------------------------------------
@app.get("/root-cause")
def root_cause() -> dict:
    """CFR root-cause breakdown (drivers, demand-vs-supply cases missed) from
    tiger_semantic.fct_otif. Backs the Root Cause Hub tab."""
    from data_pipeline import fetch_root_cause
    try:
        return fetch_root_cause()
    except Exception as exc:
        log.error("root-cause fetch failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Root cause data unavailable")


@app.get("/safety-stock")
def safety_stock() -> dict:
    """Demand-driven safety-stock recommendations (z·σ·√LT vs the static target)
    from tiger_semantic.fct_inventory_projection. Backs the Safety Stock
    Optimizer tab. Returns { recommendations: [...] }."""
    from data_pipeline import fetch_safety_stock
    try:
        return fetch_safety_stock()
    except Exception as exc:
        log.error("safety-stock fetch failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Safety stock data unavailable")


@app.get("/data-dictionary")
def data_dictionary() -> dict:
    """Live schema dictionary (views + columns + data types) read directly from
    tiger_semantic.INFORMATION_SCHEMA.COLUMNS — no hardcoded schema. Returns
    { totalViews, totalColumns, views: [{name, columnCount, grainHint, columns[]}] }.
    Business/lineage fields (description, source_table, source_field, BW InfoObject)
    are not present in BigQuery metadata → returned null (shown '—' in the UI)."""
    from data_pipeline import fetch_data_dictionary
    try:
        return fetch_data_dictionary()
    except Exception as exc:
        log.error("data-dictionary fetch failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Data dictionary unavailable")


# ---------------------------------------------------------------------------
# Phase 7 — Agent overview pages (Supply / Demand / Transport / Retail)
# ---------------------------------------------------------------------------
# Each route returns {data: <PORT_* shape>, meta: {...}}. See data_pipeline.py
# for the underlying BigQuery aggregation. All four routes degrade gracefully
# if BQ is unavailable (return empty inner arrays + an error message in meta).
# ---------------------------------------------------------------------------

@app.get("/agents/supply")
def agents_supply() -> dict:
    """Inventory positions + production adherence + raw-material concerns.
    Backs the Supply Planning agent overview page in the v2.3 UI."""
    from data_pipeline import fetch_agents_supply
    return fetch_agents_supply()


@app.get("/agents/demand")
def agents_demand() -> dict:
    """Forecast positions (classified) + promotional calendar.
    Backs the Demand Planning agent overview page in the v2.3 UI."""
    from data_pipeline import fetch_agents_demand
    return fetch_agents_demand()


@app.get("/agents/transport")
def agents_transport() -> dict:
    """Active lanes + carrier league + per-customer OTIF scoreboard.
    Backs the Transportation agent overview page in the v2.3 UI."""
    from data_pipeline import fetch_agents_transport
    return fetch_agents_transport()


@app.get("/agents/retail")
def agents_retail() -> dict:
    """Per-(customer × SKU) demand classifications + 8-week POS trends.
    Backs the Retail Intelligence agent overview page in the v2.3 UI."""
    from data_pipeline import fetch_agents_retail
    return fetch_agents_retail()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0",
                port=int(os.environ.get("PORT", "8080")))

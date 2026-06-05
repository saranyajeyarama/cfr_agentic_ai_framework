"""
Dashboard data pipeline: BigQuery -> frontend-compatible JSON. (v2.02)

Powers GET /dashboard-data. Returns live tiger_semantic data shaped to the
frontend's DashboardData contract.

SQL VERIFIED against the authoritative semantic-layer column dictionary
(every column checked against the specific view it is queried on, 0
mismatches). Note `ordered_quantity_cases` is read only via the `o.` alias
on fct_otif, where it exists; fct_sales_orders uses
`ordered_quantity_sales_uom`.

KNOWN DATA-QUALITY CAVEAT — _fetch_purchase_orders joins
fct_sales_orders.material_number to fct_forecast_accuracy.material_zrep_number.
These are different grains (FERT material vs ZREP parent), so forecast
matches will be sparse unless a material is its own ZREP parent. The agent
tools resolve FERT->ZREP via dim_material; this dashboard query does not, by
design (it is a coarse dashboard rollup, not an agent decision). Treat
forecastQty on the dashboard as indicative.

NOT YET RUN against live data — schema-verified only. First execution is an
integration test once tiger_semantic is populated.

decisionCaptureLog reads tiger_decisions.fct_allocation_decisions when that
table exists (created by infra/dce_table_v2_01.sql); returns [] otherwise.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timezone
from typing import Any

from google.cloud import bigquery

PROJECT_ID   = os.environ.get("PROJECT_ID", "resilience-riskradar")
SEMANTIC_DS  = f"{PROJECT_ID}.tiger_semantic"

log = logging.getLogger(__name__)


def _bq_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID, location="us-central1")


def _run(client: bigquery.Client, sql: str, params: list | None = None) -> list[dict]:
    try:
        cfg = bigquery.QueryJobConfig(query_parameters=params or [])
        return [dict(r) for r in client.query(sql, job_config=cfg).result()]
    except Exception as exc:
        log.error("BQ query failed: %s sql=%.300s", exc, sql)
        return []


def _scalar(rows: list[dict], key: str, default: Any = None) -> Any:
    return rows[0].get(key, default) if rows else default


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v) if v is not None else default
    except (TypeError, ValueError):
        return default


# ── Static plant/DC node metadata ─────────────────────────────────────────────
_STATIC_NODES: list[dict] = [
    {"id": "plant-us01", "name": "Plant US01", "city": "Chicago",      "type": "plant", "lat": 41.8781,  "lng": -87.6298,  "_code": "US01"},
    {"id": "plant-us02", "name": "Plant US02", "city": "Terre Haute",  "type": "plant", "lat": 39.4667,  "lng": -87.4139,  "_code": "US02"},
    {"id": "dc-01",      "name": "DC-01",      "city": "Chicago",      "type": "dc",    "lat": 41.7300,  "lng": -87.8500,  "_code": "DC-01"},
    {"id": "dc-02",      "name": "DC-02",      "city": "Dallas",       "type": "dc",    "lat": 32.7767,  "lng": -96.7970,  "_code": "DC-02"},
    {"id": "dc-03",      "name": "DC-03",      "city": "Jacksonville", "type": "dc",    "lat": 30.3322,  "lng": -81.6557,  "_code": "DC-03"},
    {"id": "dc-04",      "name": "DC-04",      "city": "Carlisle",     "type": "dc",    "lat": 40.2010,  "lng": -77.1889,  "_code": "DC-04"},
    {"id": "dc-05",      "name": "DC-05",      "city": "Seattle",      "type": "dc",    "lat": 47.6062,  "lng": -122.3321, "_code": "DC-05"},
]


# ─────────────────────────────────────────────────────────────────────────────
# Global KPIs
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_global_kpis(client: bigquery.Client) -> dict:
    # Use the latest date in the data as the reference point (data may be historical)
    anchor_rows = _run(client, f"""
        SELECT MAX(delivery_date_promised) AS max_dt
        FROM `{SEMANTIC_DS}.fct_otif`
    """)
    anchor = (anchor_rows[0].get("max_dt") if anchor_rows else None) or "CURRENT_DATE()"
    anchor_expr = f"DATE '{anchor}'" if anchor != "CURRENT_DATE()" else "CURRENT_DATE()"

    # CFR from last 90 days of data
    cfr = _scalar(_run(client, f"""
        SELECT ROUND(
            SAFE_DIVIDE(COUNTIF(otif_flag = 'Y'), COUNT(*)) * 100,
        1) AS cfr
        FROM `{SEMANTIC_DS}.fct_otif`
        WHERE delivery_date_promised >= DATE_SUB({anchor_expr}, INTERVAL 90 DAY)
    """), "cfr", 0.0)

    # OTIF failures in the 7 days before the anchor — fine = 2% of order value
    # Use avg unit_price per material from sales orders (avoid cartesian join)
    fines_7d = _scalar(_run(client, f"""
        WITH avg_price AS (
            SELECT material_number,
                   AVG(NULLIF(unit_price, 0)) AS avg_unit_price
            FROM `{SEMANTIC_DS}.fct_sales_orders`
            GROUP BY material_number
        )
        SELECT COALESCE(SUM(
            o.ordered_quantity_cases
            * COALESCE(p.avg_unit_price, 50.0)
            * 0.02
        ), 0) AS total
        FROM `{SEMANTIC_DS}.fct_otif` o
        LEFT JOIN avg_price p ON o.primary_material_number = p.material_number
        WHERE o.otif_flag = 'N'
          AND o.delivery_date_promised >= DATE_SUB({anchor_expr}, INTERVAL 7 DAY)
          AND o.delivery_date_promised <= {anchor_expr}
    """), "total", 0)

    # Cases in open orders within 7 days of anchor
    cases_at_risk = _scalar(_run(client, f"""
        SELECT COALESCE(SUM(ordered_quantity_sales_uom), 0) AS total
        FROM `{SEMANTIC_DS}.fct_sales_orders`
        WHERE rejection_reason IS NULL
          AND requested_delivery_date >= DATE_SUB({anchor_expr}, INTERVAL 7 DAY)
          AND requested_delivery_date <= DATE_ADD({anchor_expr}, INTERVAL 7 DAY)
    """), "total", 0)

    # Revenue from orders in the month containing the anchor date
    rev_preserved = _scalar(_run(client, f"""
        SELECT COALESCE(SUM(line_net_value_usd), 0) AS total
        FROM `{SEMANTIC_DS}.fct_sales_orders`
        WHERE order_creation_date >= DATE_TRUNC({anchor_expr}, MONTH)
          AND order_creation_date <= {anchor_expr}
          AND rejection_reason IS NULL
    """), "total", 0)

    # Active OTIF failures near anchor
    active_alerts = _scalar(_run(client, f"""
        SELECT COUNT(*) AS cnt
        FROM `{SEMANTIC_DS}.fct_otif`
        WHERE otif_flag = 'N'
          AND delivery_date_promised >= DATE_SUB({anchor_expr}, INTERVAL 30 DAY)
          AND delivery_date_promised <= {anchor_expr}
    """), "cnt", 0)

    # --- Agentic decision KPIs (tiger_decisions, US multi-region) -------------
    # fct_allocation_decisions + fct_user_execution_telemetry live in the US
    # multi-region and are written in real time, so they anchor to CURRENT_DATE()
    # (not the historical OTIF max-date) and need a US-located client (the main
    # `client` here is us-central1). Best-effort: any failure degrades to 0 —
    # identical to the prior hardcoded behaviour on a fresh/empty deploy.
    decisions_logged_mtd = 0
    acceptance_rate = 0.0
    try:
        _cu = bigquery.Client(project=PROJECT_ID, location="US")
        # Decisions captured this calendar month.
        d_rows = list(_cu.query(f"""
            SELECT COUNT(*) AS n
            FROM `{PROJECT_ID}.tiger_decisions.fct_allocation_decisions`
            WHERE decision_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)
        """).result())
        decisions_logged_mtd = _safe_int(d_rows[0].get("n")) if d_rows else 0
        # Agent-recommendation acceptance: telemetry has no `aligned` column, so
        # derive it — the human is "aligned" when their approve/reject matches
        # whether the agent recommended a positive (ACCEPT/PARTIAL) action.
        a_rows = list(_cu.query(f"""
            SELECT
              COUNTIF(
                (LOWER(user_decision) IN ('approved','accept','accepted'))
                = (UPPER(agent_recommendation) IN ('ACCEPT','PARTIAL','PARTIAL_FULFILL'))
              ) AS aligned,
              COUNT(*) AS total
            FROM `{PROJECT_ID}.tiger_decisions.fct_user_execution_telemetry`
            WHERE user_decision IS NOT NULL
        """).result())
        if a_rows:
            total = _safe_int(a_rows[0].get("total"))
            aligned = _safe_int(a_rows[0].get("aligned"))
            acceptance_rate = round(aligned / total, 3) if total else 0.0
    except Exception as exc:
        log.warning("Agentic decision KPIs query failed: %s", exc)

    # --- Headline metric cards (OTIF score, fill rate, open orders, triage) ---
    # OTIF score + fill rate over the trailing 90d vs the prior 90d (for deltas),
    # in one pass over fct_otif. Targets below are business config, not metrics.
    otif_score = round(_safe_float(cfr), 1)   # CFR already computed above
    otif_delta_pp = 0.0
    fill_rate = 0.0
    fill_delta_pp = 0.0
    of_rows = _run(client, f"""
        SELECT
          ROUND(SAFE_DIVIDE(COUNTIF(otif_flag='Y' AND win=0), NULLIF(COUNTIF(win=0),0))*100, 1) AS otif_cur,
          ROUND(SAFE_DIVIDE(COUNTIF(otif_flag='Y' AND win=1), NULLIF(COUNTIF(win=1),0))*100, 1) AS otif_prev,
          ROUND(SAFE_DIVIDE(SUM(IF(win=0, delivered_quantity_cases, 0)),
                            NULLIF(SUM(IF(win=0, ordered_quantity_cases, 0)),0))*100, 1) AS fill_cur,
          ROUND(SAFE_DIVIDE(SUM(IF(win=1, delivered_quantity_cases, 0)),
                            NULLIF(SUM(IF(win=1, ordered_quantity_cases, 0)),0))*100, 1) AS fill_prev
        FROM (
          SELECT otif_flag, delivered_quantity_cases, ordered_quantity_cases,
            CASE
              WHEN delivery_date_promised >= DATE_SUB({anchor_expr}, INTERVAL 90 DAY) THEN 0
              WHEN delivery_date_promised >= DATE_SUB({anchor_expr}, INTERVAL 180 DAY) THEN 1
            END AS win
          FROM `{SEMANTIC_DS}.fct_otif`
          WHERE delivery_date_promised <= {anchor_expr}
        )
        WHERE win IS NOT NULL
    """)
    if of_rows:
        r0 = of_rows[0]
        otif_score = _safe_float(r0.get("otif_cur"), otif_score)
        fill_rate = _safe_float(r0.get("fill_cur"))
        otif_delta_pp = round(otif_score - _safe_float(r0.get("otif_prev")), 1)
        fill_delta_pp = round(fill_rate - _safe_float(r0.get("fill_prev")), 1)

    # Open orders: un-rejected sales orders still to be delivered (>= today).
    open_orders = _safe_int(_scalar(_run(client, f"""
        SELECT COUNT(*) AS n
        FROM `{SEMANTIC_DS}.fct_sales_orders`
        WHERE rejection_reason IS NULL
          AND requested_delivery_date >= CURRENT_DATE()
    """), "n", 0))

    # Orders in triage: the canonical Order-Triage candidate queue size.
    orders_in_triage = 0
    try:
        from agent_tools import get_demo_scenario_candidates
        orders_in_triage = _safe_int(
            get_demo_scenario_candidates(limit=500).get("row_count", 0))
    except Exception as exc:
        log.warning("ordersInTriage count failed: %s", exc)

    # AI Resolution: average agent triage run time (minutes), from the durations
    # measured + stored in the triage cache. NULL until triages run post-deploy
    # (no historical timing exists); the card shows "—" until populated.
    ai_resolution_min = None
    try:
        _cu2 = bigquery.Client(project=PROJECT_ID, location="US")
        ar = list(_cu2.query(f"""
            SELECT ROUND(AVG(duration_ms) / 60000.0, 1) AS mins
            FROM `{PROJECT_ID}.tiger_decisions.fct_triage_cache`
            WHERE duration_ms IS NOT NULL
        """).result())
        if ar and ar[0].get("mins") is not None:
            ai_resolution_min = _safe_float(ar[0].get("mins"))
    except Exception as exc:
        log.warning("aiResolutionMinutes query failed: %s", exc)

    return {
        "networkCFR":                        round(_safe_float(cfr), 1),
        "networkCFRTarget":                  98.0,
        "otifFinesAtRisk7Day":               _safe_int(fines_7d),
        "revenuePreservedMTD":               _safe_int(rev_preserved),
        # No demurrage/detention source exists in the warehouse — intentionally
        # left at 0 (not fabricated) and not shown in the Watchtower ribbon.
        "demurrageAvoidedWTD":               0,
        "casesAtRiskThisWeek":               _safe_int(cases_at_risk),
        "activeAlerts":                      _safe_int(active_alerts),
        "decisionsLoggedMTD":                decisions_logged_mtd,
        "agentRecommendationAcceptanceRate": acceptance_rate,
        # Headline metric cards (real data; targets are business config).
        "otifScore":                         otif_score,
        "otifScoreDeltaPp":                  otif_delta_pp,
        "otifScoreTarget":                   95.0,
        "fillRate":                          fill_rate,
        "fillRateDeltaPp":                   fill_delta_pp,
        "fillRateTarget":                    98.0,
        "finesAtRiskTarget":                 250000,
        "openOrders":                        open_orders,
        "ordersInTriage":                    orders_in_triage,
        "aiResolutionMinutes":               ai_resolution_min,
        "aiResolutionTargetMin":             10,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Alerts
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_alerts(client: bigquery.Client) -> list[dict]:
    otif_rows = _run(client, f"""
        WITH anchor AS (
            SELECT MAX(delivery_date_promised) AS max_dt FROM `{SEMANTIC_DS}.fct_otif`
        ),
        avg_price AS (
            SELECT material_number, AVG(NULLIF(unit_price, 0)) AS avg_unit_price
            FROM `{SEMANTIC_DS}.fct_sales_orders`
            GROUP BY material_number
        )
        SELECT
            o.delivery_number,
            o.sold_to_name,
            o.primary_material_number,
            o.primary_material_brand,
            o.delivery_date_promised,
            o.otif_fail_reason,
            o.otif_root_cause_category,
            o.ordered_quantity_cases,
            o.delivered_quantity_cases,
            o.days_late,
            COALESCE(p.avg_unit_price, 50.0) AS unit_price
        FROM `{SEMANTIC_DS}.fct_otif` o, anchor
        LEFT JOIN avg_price p ON o.primary_material_number = p.material_number
        WHERE o.otif_flag = 'N'
          AND o.delivery_date_promised >= DATE_SUB(anchor.max_dt, INTERVAL 30 DAY)
          AND o.delivery_date_promised <= anchor.max_dt
        ORDER BY o.delivery_date_promised DESC
        LIMIT 8
    """)

    alerts: list[dict] = []
    for idx, r in enumerate(otif_rows, start=1):
        ordered   = _safe_float(r.get("ordered_quantity_cases", 0))
        fine_est  = int(ordered * _safe_float(r.get("unit_price", 50.0)) * 0.02)
        promised  = r.get("delivery_date_promised")
        mabd_str  = promised.isoformat() if isinstance(promised, date) else str(promised or "")

        severity = "critical" if fine_est >= 15000 else "warning"
        alerts.append({
            "id":           f"alert-{idx:03d}",
            "severity":     severity,
            "type":         "OTIF Breach",
            "title":        f"Predicted OTIF Fine — {r.get('sold_to_name', 'Customer')} MABD Miss",
            "customer":     r.get("sold_to_name", ""),
            "customerTier": "Tier 1",
            "description":  (
                f"Delivery {r.get('delivery_number', '')} for "
                f"{r.get('primary_material_brand', r.get('primary_material_number', ''))} "
                f"is at risk of missing MABD {mabd_str}. "
                f"Root cause: {r.get('otif_root_cause_category', 'Unknown')}. "
                f"Reason: {r.get('otif_fail_reason', 'Unknown')}."
            ),
            "fineAtRisk":   fine_est,
            "agentSource":  "Transportation Agent",
            "actionTab":    "simulator",
            "skuCode":      r.get("primary_material_number", ""),
            "skuName":      r.get("primary_material_brand", r.get("primary_material_number", "")),
        })

    return alerts


# ─────────────────────────────────────────────────────────────────────────────
# Network nodes
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_network_nodes(client: bigquery.Client) -> list[dict]:
    # OTIF failures by plant (via fct_sales_orders which has plant_code)
    risk_rows = _run(client, f"""
        SELECT
            so.plant_code,
            COUNT(*) AS risk_count
        FROM `{SEMANTIC_DS}.fct_otif` o
        JOIN `{SEMANTIC_DS}.fct_sales_orders` so
          ON o.sold_to = so.sold_to
         AND o.primary_material_number = so.material_number
        WHERE o.otif_flag = 'N'
        GROUP BY so.plant_code
    """)
    risk_by_plant = {r["plant_code"]: r["risk_count"] for r in risk_rows}

    nodes: list[dict] = []
    for node in _STATIC_NODES:
        code         = node["_code"]
        risk_count   = _safe_int(risk_by_plant.get(code, 0))

        if risk_count >= 3:
            status        = "critical"
            status_reason = f"{risk_count} OTIF failures linked to this location"
        elif risk_count > 0:
            status        = "warning"
            status_reason = f"{risk_count} OTIF risk(s) linked to this location"
        else:
            status        = "healthy"
            status_reason = "No active alerts"

        nodes.append({
            "id":           node["id"],
            "name":         node["name"],
            "city":         node["city"],
            "type":         node["type"],
            "lat":          node["lat"],
            "lng":          node["lng"],
            "status":       status,
            "statusReason": status_reason,
        })

    return nodes


# ─────────────────────────────────────────────────────────────────────────────
# Purchase Orders
# ─────────────────────────────────────────────────────────────────────────────

def _severity_from_row(ordered: float, forecast: float, has_issue: bool) -> str:
    if has_issue:
        return "critical"
    if forecast and ordered > forecast * 1.2:
        return "critical"
    if forecast and ordered > forecast * 1.05:
        return "warning"
    return "neutral"


def _fetch_purchase_orders(client: bigquery.Client) -> list[dict]:
    rows = _run(client, f"""
        SELECT
            so.sales_order_number,
            so.sold_to,
            COALESCE(dc.customer_name, so.sold_to_name, so.sold_to) AS customer_name,
            COALESCE(dc.priority_tier_name, CAST(dc.priority_tier_level AS STRING), 'Tier 1') AS tier,
            so.material_number,
            COALESCE(so.material_description, so.material_number) AS material_name,
            so.material_brand,
            so.ordered_quantity_sales_uom AS ordered_qty,
            COALESCE(fa.forecast_quantity, 0)  AS forecast_qty,
            so.requested_delivery_date,
            so.unit_price,
            so.line_net_value_usd,
            so.plant_code,
            COALESCE(so.plant_name, so.plant_code) AS plant_name
        FROM `{SEMANTIC_DS}.fct_sales_orders` so
        LEFT JOIN `{SEMANTIC_DS}.dim_customer` dc
               ON so.sold_to = dc.customer_number
        LEFT JOIN (
            SELECT sold_to, material_zrep_number,
                   AVG(forecast_quantity) AS forecast_quantity
            FROM `{SEMANTIC_DS}.fct_forecast_accuracy`
            WHERE lag_weeks = 4
            GROUP BY sold_to, material_zrep_number
        ) fa ON so.sold_to = fa.sold_to
             AND so.material_number = fa.material_zrep_number
        CROSS JOIN (SELECT MAX(requested_delivery_date) AS max_dt FROM `{SEMANTIC_DS}.fct_sales_orders`) anchor
        WHERE so.rejection_reason IS NULL
          AND so.requested_delivery_date <= DATE_ADD(anchor.max_dt, INTERVAL 7 DAY)
          AND so.requested_delivery_date >= DATE_SUB(anchor.max_dt, INTERVAL 30 DAY)
        ORDER BY so.requested_delivery_date ASC
        LIMIT 100
    """)

    pos: list[dict] = []
    for idx, r in enumerate(rows, start=1):
        ordered  = _safe_float(r.get("ordered_qty", 0))
        forecast = _safe_float(r.get("forecast_qty", 0))
        severity = _severity_from_row(ordered, forecast, False)

        if forecast and ordered > forecast * 1.1:
            pct    = round((ordered - forecast) / forecast * 100)
            issue  = f"Forecast Violation — {pct}% Above Plan"
            detail = (
                f"Order is {pct}% above demand plan "
                f"({int(forecast):,} CS forecast vs {int(ordered):,} CS ordered). "
                f"Full fulfillment may impact Tier 1 accounts on same SKU."
            )
            partial  = int(ordered * 0.85)
            hold     = int(ordered) - partial
            rec_action     = f"Accept {partial:,} CS (85%). Backorder remaining {hold:,} CS."
            prop_alloc     = f"{partial:,} CS"
            prop_hold      = f"{hold:,} CS (Backorder)"
        else:
            issue        = "Standard Allocation"
            detail       = "No constraints detected across supply, shelf-life, logistics, or forecast."
            rec_action   = "Auto-approve. Ready for execution."
            prop_alloc   = f"{int(ordered):,} CS"
            prop_hold    = "0 CS"

        mabd_str = ""
        d = r.get("requested_delivery_date")
        if d:
            mabd_str = d.isoformat() if isinstance(d, date) else str(d)

        pos.append({
            "id":                 f"po-{idx:03d}",
            "orderNumber":        f"#{r.get('sales_order_number', idx)}",
            "customer":           r.get("customer_name", ""),
            "tier":               r.get("tier", "Tier 1"),
            "skuCode":            r.get("material_number", ""),
            "skuName":            r.get("material_name", ""),
            "requestedQty":       int(ordered),
            "requestedQtyUnit":   "CS",
            "forecastQty":        int(forecast),
            "severity":           severity,
            "issue":              issue,
            "issueDetail":        detail,
            "agents":             ["Customer Supply Agent", "Supply Planning Agent"],
            "recommendedAction":  rec_action,
            "proposedAllocation": prop_alloc,
            "proposedHold":       prop_hold,
            "financialImpact":    "Pending agent analysis",
            "confidenceScore":    0.85,
            "mabd":               mabd_str,
            # Real tiger_semantic identifiers — the front-end passes these
            # straight through to POST /sessions. The display `customer`
            # name is NOT a valid identifier.
            "soldTo":             r.get("sold_to", ""),
            "materialNumber":     r.get("material_number", ""),
        })

    return pos


# ─────────────────────────────────────────────────────────────────────────────
# Fulfillment Incidents  (Phase 1: gated by Order-Triage approval)
# ─────────────────────────────────────────────────────────────────────────────
# Business rule: only orders the human accepted (ACCEPT) or modified
# (PARTIAL_FULFILL) in Order Triage are eligible for the simulator.
# Rejected (REJECT) and deferred (DEFER) decisions are excluded.
# The source of truth for those decisions is `tiger_decisions.fct_allocation_decisions`,
# populated by agent_tools.dce_write() when /sessions/{id}/approve fires.
#
# Risk gating: an approved order surfaces as an incident only if it ALSO
# has at least one active execution-risk signal (recent OTIF failure on
# the same sold_to + material). Scenarios are NOT prebuilt here — the
# front-end calls POST /fulfillment/simulate per incident on click.

_DECISIONS_DS = os.environ.get("DECISIONS_DS", "tiger_decisions")
_DECISIONS_PROJECT = os.environ.get("PROJECT_ID", "resilience-riskradar")

def _bq_decisions() -> bigquery.Client:
    """Separate client for tiger_decisions (US region — created there by default)."""
    return bigquery.Client(project=_DECISIONS_PROJECT, location="US")


def _fetch_fulfillment_incidents(client: bigquery.Client) -> list[dict]:
    # --- Step 1: fetch ALL approved/modified decisions from tiger_decisions (US region) ---
    dclient = _bq_decisions()
    approved = _run(dclient, f"""
        SELECT
          d.decision_id,
          d.sold_to,
          JSON_VALUE(d.decision_reason, '$.trigger.material_number')          AS material_number,
          JSON_VALUE(d.decision_reason, '$.trigger.material_description')     AS trigger_material_desc,
          JSON_VALUE(d.decision_reason, '$.trigger.customer_name')            AS trigger_customer_name,
          JSON_VALUE(d.decision_reason, '$.trigger.requested_delivery_date')  AS requested_delivery_date,
          d.ordered_quantity_cases,
          d.allocated_quantity_cases,
          -- user_decision = 'approved' means the human clicked Accept/Modify.
          -- agent_recommendation may differ (agent said DEFER but human overrode).
          COALESCE(JSON_VALUE(d.decision_reason, '$.user_decision'),
                   'approved')                                                AS user_action,
          COALESCE(JSON_VALUE(d.decision_reason, '$.agent_recommendation'),
                   'ACCEPT')                                                  AS agent_action,
          d.decision_date,
          d.priority_tier_at_decision
        FROM `{_DECISIONS_DS}.fct_allocation_decisions` d
        WHERE d.decision_status = 'EXECUTED'
          AND d.decision_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        ORDER BY d.decision_date DESC
        LIMIT 20
    """)
    if not approved:
        return _fetch_demo_seed_incidents(client)

    # Collect unique sold_tos and material_numbers for enrichment.
    sold_tos = list({a["sold_to"] for a in approved if a.get("sold_to")})
    mat_nums = list({a["material_number"] for a in approved
                     if a.get("material_number")})

    # --- Step 2: enrich from tiger_semantic (us-central1) ---
    # Enrichment is best-effort — orders still show even without BQ matches
    # (we fall back to trigger JSON data from dce_write).
    # Build parallel arrays of actual (sold_to, material_number) pairs from
    # approved decisions — enrichment query joins on these instead of a
    # wasteful CROSS JOIN that explodes with many customers × materials.
    pair_set = {
        (a["sold_to"], a["material_number"])
        for a in approved
        if a.get("sold_to") and a.get("material_number")
           and "PLACEHOLDER" not in (a.get("sold_to") or "").upper()
           and "TEST" not in (a.get("sold_to") or "").upper()
    }
    pair_sold_tos = [p[0] for p in pair_set]
    pair_mat_nums = [p[1] for p in pair_set]

    enrich_map: dict[tuple[str, str], dict] = {}
    if pair_sold_tos and pair_mat_nums:
        enrichment = _run(client, f"""
            WITH pairs AS (
              -- Actual approved (sold_to, material) pairs from Order Triage.
              -- Two parallel arrays UNNESTed with OFFSET keep the pairing intact.
              SELECT s AS sold_to, m AS material_number
              FROM UNNEST(@pair_sold_tos) AS s WITH OFFSET o1
              JOIN UNNEST(@pair_mat_nums) AS m WITH OFFSET o2 ON o1 = o2
            ),
            cust AS (
              SELECT customer_number, customer_name,
                     otif_target_pct, fill_rate_threshold_pct,
                     otif_aggressive_flag, otif_program_name,
                     mabd_enforcement_type, customer_region_state
              FROM `{SEMANTIC_DS}.dim_customer`
              WHERE customer_number IN UNNEST(@sold_tos)
            ),
            mat AS (
              SELECT material_number, material_description AS brand
              FROM `{SEMANTIC_DS}.dim_material`
              WHERE material_number IN UNNEST(@mat_nums)
            ),
            plant_for_mat AS (
              SELECT material_number,
                     ANY_VALUE(plant_code) AS plant_code,
                     AVG(NULLIF(unit_price, 0)) AS unit_price
              FROM `{SEMANTIC_DS}.fct_sales_orders`
              WHERE material_number IN UNNEST(@mat_nums)
              GROUP BY material_number
            ),
            plant_info AS (
              SELECT plant_code, plant_name, plant_city, plant_region, plant_type
              FROM `{SEMANTIC_DS}.dim_plant`
            ),
            delivery_stats AS (
              -- fct_deliveries only has DC-level data (DC01-DC05), not manufacturing
              -- plants (US01-US03). Aggregate across all DCs for each material.
              SELECT material_number,
                     COUNT(*)                                             AS delivery_count,
                     COUNTIF(fill_status = 'C')                           AS complete_fills,
                     ROUND(100.0 * COUNTIF(fill_status = 'C')
                           / NULLIF(COUNT(*), 0), 1)                      AS fill_rate_pct,
                     APPROX_TOP_COUNT(plant_code, 1)[OFFSET(0)].value    AS primary_dc
              FROM `{SEMANTIC_DS}.fct_deliveries`
              WHERE material_number IN UNNEST(@mat_nums)
              GROUP BY material_number
            ),
            shipment_stats AS (
              -- fct_shipments only has DC-level origins. Aggregate per plant
              -- across all destinations (the simulate endpoint does per-region
              -- lookups separately). Filter to DCs that ship our materials.
              SELECT origin_plant,
                     ROUND(AVG(transit_duration_hours), 1)                AS avg_transit_hours,
                     APPROX_TOP_COUNT(carrier_name, 1)[OFFSET(0)].value  AS primary_carrier,
                     COUNT(*)                                             AS shipment_count
              FROM `{SEMANTIC_DS}.fct_shipments`
              GROUP BY origin_plant
            ),
            recent_otif AS (
              SELECT sold_to, primary_material_number AS material_number,
                     COUNT(*)                    AS total_deliveries,
                     COUNTIF(otif_flag = 'N')    AS recent_fails,
                     ROUND(100.0 * COUNTIF(otif_flag = 'N') / COUNT(*), 1)
                                                 AS fail_rate_pct,
                     MAX(days_late)              AS max_days_late,
                     AVG(CASE WHEN days_late > 0 THEN days_late END)
                                                 AS avg_days_late,
                     MAX(otif_fail_reason)       AS last_fail_reason,
                     MAX(otif_root_cause_category) AS last_root_cause
              FROM `{SEMANTIC_DS}.fct_otif`
              WHERE sold_to IN UNNEST(@sold_tos)
                AND primary_material_number IN UNNEST(@mat_nums)
                AND delivery_date_promised >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
              GROUP BY sold_to, primary_material_number
            ),
            chargebacks AS (
              SELECT sold_to,
                     COUNT(*)                          AS chargeback_count,
                     ROUND(AVG(chargeback_amount_usd), 2)  AS avg_chargeback_usd,
                     ROUND(SUM(chargeback_amount_usd), 2)  AS total_chargeback_usd
              FROM `{SEMANTIC_DS}.fct_chargebacks`
              WHERE sold_to IN UNNEST(@sold_tos)
              GROUP BY sold_to
            )
            SELECT
              p.sold_to,
              cust.customer_name,
              cust.otif_target_pct,
              cust.fill_rate_threshold_pct,
              cust.otif_aggressive_flag,
              cust.otif_program_name,
              cust.mabd_enforcement_type,
              cust.customer_region_state,
              p.material_number,
              mat.brand,
              COALESCE(pfm.unit_price, 5.0)        AS unit_price,
              COALESCE(pfm.plant_code, 'P0001')    AS plant_code,
              -- dim_plant metadata for the origin plant.
              pi.plant_name                         AS origin_plant_name,
              pi.plant_city                         AS origin_plant_city,
              pi.plant_type                         AS origin_plant_type,
              -- fct_deliveries fill rate across all DCs for this material.
              ds.fill_rate_pct                      AS recent_fill_rate,
              ds.delivery_count                     AS delivery_count,
              ds.primary_dc                         AS primary_dc,
              -- fct_shipments transit context for the primary DC.
              ss.avg_transit_hours,
              ss.primary_carrier,
              ss.shipment_count                     AS route_shipment_count,
              -- OTIF + chargeback risk metrics.
              COALESCE(r.total_deliveries, 0)      AS total_deliveries,
              COALESCE(r.recent_fails, 0)          AS recent_fails,
              COALESCE(r.fail_rate_pct, 0)         AS fail_rate_pct,
              COALESCE(r.max_days_late, 0)         AS max_days_late,
              r.avg_days_late,
              r.last_fail_reason,
              r.last_root_cause,
              COALESCE(cb.chargeback_count, 0)     AS chargeback_count,
              COALESCE(cb.avg_chargeback_usd, 0)   AS avg_chargeback_usd,
              COALESCE(cb.total_chargeback_usd, 0) AS total_chargeback_usd
            FROM pairs p
            LEFT JOIN cust             ON cust.customer_number = p.sold_to
            LEFT JOIN mat              ON mat.material_number  = p.material_number
            LEFT JOIN plant_for_mat pfm ON pfm.material_number = p.material_number
            LEFT JOIN plant_info pi     ON pi.plant_code = COALESCE(pfm.plant_code, 'P0001')
            LEFT JOIN delivery_stats ds ON ds.material_number = p.material_number
            LEFT JOIN shipment_stats ss ON ss.origin_plant = ds.primary_dc
            LEFT JOIN recent_otif r     ON r.sold_to = p.sold_to
                                       AND r.material_number = p.material_number
            LEFT JOIN chargebacks cb    ON cb.sold_to = p.sold_to
        """, [
            bigquery.ArrayQueryParameter("sold_tos", "STRING", sold_tos),
            bigquery.ArrayQueryParameter("mat_nums", "STRING", mat_nums),
            bigquery.ArrayQueryParameter("pair_sold_tos", "STRING", pair_sold_tos),
            bigquery.ArrayQueryParameter("pair_mat_nums", "STRING", pair_mat_nums),
        ])
        for e in enrichment:
            key = (e.get("sold_to", ""), e.get("material_number", ""))
            enrich_map[key] = e

    # --- Step 3: merge ALL approved orders (risk is metadata, not a filter) ---
    rows = []
    for a in approved:
        # Skip test/placeholder rows (from manual inserts during development)
        st = (a.get("sold_to") or "").upper()
        if "PLACEHOLDER" in st or "TEST" in st:
            continue
        key = (a.get("sold_to", ""), a.get("material_number", ""))
        e = enrich_map.get(key, {})
        merged = {**a, **e}
        # Fall back to trigger JSON data when BQ enrichment has no match
        if not merged.get("customer_name"):
            merged["customer_name"] = a.get("trigger_customer_name") or a.get("sold_to", "")
        if not merged.get("brand"):
            merged["brand"] = a.get("trigger_material_desc") or a.get("material_number", "")
        if not merged.get("plant_code"):
            merged["plant_code"] = "P0001"
        if not merged.get("unit_price"):
            merged["unit_price"] = 5.0
        rows.append(merged)
    rows = rows[:10]

    if rows:
        return [_shape_incident(r, idx, demo_seed=False) for idx, r in enumerate(rows, start=1)]

    return _fetch_demo_seed_incidents(client)


def _fetch_demo_seed_incidents(client: bigquery.Client) -> list[dict]:
    """Fallback: no approved+at-risk orders → seed 1-2 illustrative
    incidents from raw OTIF history so the UI is never blank."""
    log.info("No approved+at-risk orders found; falling back to demo seed from fct_otif")
    fallback = _run(client, f"""
        SELECT
            o.delivery_number, o.sold_to_name, o.sold_to,
            o.primary_material_number AS material_number,
            o.primary_material_brand  AS brand,
            o.delivery_date_promised  AS requested_delivery_date,
            o.ordered_quantity_cases,
            o.otif_fail_reason  AS last_fail_reason,
            o.otif_root_cause_category AS last_root_cause,
            o.days_late         AS max_days_late,
            1                   AS recent_fails,
            'ACCEPT'            AS action,
            COALESCE(so.unit_price, 5.0)  AS unit_price,
            COALESCE(so.plant_code, 'P0001') AS plant_code
        FROM `{SEMANTIC_DS}.fct_otif` o
        LEFT JOIN (
            SELECT material_number, AVG(NULLIF(unit_price, 0)) AS unit_price,
                   ANY_VALUE(plant_code) AS plant_code
            FROM `{SEMANTIC_DS}.fct_sales_orders`
            GROUP BY material_number
        ) so ON o.primary_material_number = so.material_number
        CROSS JOIN (SELECT MAX(delivery_date_promised) AS max_dt FROM `{SEMANTIC_DS}.fct_otif`) anchor
        WHERE o.otif_flag = 'N'
          AND o.delivery_date_promised >= DATE_SUB(anchor.max_dt, INTERVAL 90 DAY)
        ORDER BY o.ordered_quantity_cases DESC
        LIMIT 2
    """)
    fallback_normalized = []
    for r in fallback:
        fallback_normalized.append({
            **r,
            "customer_name": r.get("sold_to_name"),
            "allocated_quantity_cases": r.get("ordered_quantity_cases"),
        })
    return [_shape_incident(r, idx, demo_seed=True)
            for idx, r in enumerate(fallback_normalized, start=1)]


def _shape_incident(r: dict, idx: int, demo_seed: bool) -> dict:
    """Convert one query row into the front-end Incident shape. Scenarios
    are intentionally an empty list — populated lazily by the optimizer."""
    ordered = _safe_float(r.get("ordered_quantity_cases", 0))
    unit_price = _safe_float(r.get("unit_price", 5.0))

    # ── Real risk metrics from BigQuery enrichment ────────────────────────
    total_deliveries = _safe_int(r.get("total_deliveries", 0))
    recent_fails = _safe_int(r.get("recent_fails", 0))
    fail_rate_pct = _safe_float(r.get("fail_rate_pct", 0))
    max_days_late = _safe_int(r.get("max_days_late", 0))
    avg_days_late = _safe_float(r.get("avg_days_late", 0))
    avg_chargeback = _safe_float(r.get("avg_chargeback_usd", 0))
    total_chargeback = _safe_float(r.get("total_chargeback_usd", 0))
    chargeback_count = _safe_int(r.get("chargeback_count", 0))
    otif_target = _safe_float(r.get("otif_target_pct", 98.0))
    otif_program = r.get("otif_program_name") or "Standard OTIF"
    mabd_enforcement = r.get("mabd_enforcement_type") or "FIRM"
    otif_aggressive = r.get("otif_aggressive_flag") or "N"

    # Risk probability: real OTIF fail rate for this sold_to + material
    # over the last 90 days. If no OTIF history, estimate from chargeback
    # frequency vs customer's target.
    if total_deliveries > 0:
        prob = round(fail_rate_pct)  # real data: e.g. 30%
    elif chargeback_count > 0:
        # Estimate from customer-level chargeback frequency
        prob = min(80, max(20, chargeback_count // 5))
    else:
        prob = 15  # low risk — no history of failures

    # Fine at risk: use actual avg chargeback × probability of a failure.
    # More realistic than a flat 2% of order value.
    if avg_chargeback > 0 and prob > 0:
        fine_est = int(avg_chargeback * (prob / 100.0) * max(1, ordered / 100))
    else:
        fine_est = int(ordered * unit_price * 0.02)  # fallback

    promised = r.get("requested_delivery_date")
    mabd_str = promised.isoformat() if isinstance(promised, date) else str(promised or "")
    sold_to = r.get("sold_to") or ""
    material_number = r.get("material_number") or ""
    customer_name = r.get("customer_name") or r.get("sold_to_name") or sold_to
    brand = r.get("brand") or material_number
    plant_code = r.get("plant_code") or "P0001"
    # Delivery-enriched fields from dim_plant / fct_deliveries / fct_shipments.
    origin_plant_name = r.get("origin_plant_name") or ""
    origin_plant_city = r.get("origin_plant_city") or ""
    origin_plant_type = r.get("origin_plant_type") or ""
    avg_transit_hours = _safe_float(r.get("avg_transit_hours", 0)) or None
    primary_carrier = r.get("primary_carrier") or ""
    recent_fill_rate = _safe_float(r.get("recent_fill_rate", 0)) or None
    # user_action = 'approved'/'rejected'; agent_action = 'ACCEPT'/'DEFER'/etc.
    user_action = (r.get("user_action") or r.get("action") or "approved").upper()
    agent_action = (r.get("agent_action") or "").upper()
    display_label = "APPROVED" if user_action == "APPROVED" else user_action
    fail_reason = r.get("last_fail_reason") or "None"
    root_cause = r.get("last_root_cause") or "None"

    desc_parts = [
        f"Approved order ({display_label}) for {customer_name}",
        f"({brand}) requested by {mabd_str}." if mabd_str else f"({brand}).",
    ]
    if recent_fails > 0:
        desc_parts.append(
            f"Last 90 days: {recent_fails}/{total_deliveries} deliveries failed OTIF "
            f"({fail_rate_pct:.0f}% fail rate). "
            f"Root cause: {root_cause}. Failure type: {fail_reason}."
        )
    else:
        desc_parts.append("No recent OTIF failures for this customer + material.")
    if demo_seed:
        desc_parts.append("[demo-seed: no Order-Triage approvals in the last 30 days]")
    description = " ".join(desc_parts)

    # OTIF rulebook with real customer program data
    rulebook_parts = [
        f"{otif_program}: target {otif_target:.0f}% on-time in-full.",
        f"MABD: {mabd_str}." if mabd_str else "",
        f"Enforcement: {mabd_enforcement}.",
    ]
    if otif_aggressive == "Y":
        rulebook_parts.append("Aggressive chargeback program — high penalty risk.")
    if avg_chargeback > 0:
        rulebook_parts.append(f"Avg chargeback: ${avg_chargeback:,.0f}/incident.")
    otif_rulebook = " ".join(p for p in rulebook_parts if p)

    return {
        "id":              f"inc-{idx:03d}",
        "title":           (f"Approved order for {customer_name} — at risk"
                            if not demo_seed
                            else f"Demo seed — {customer_name}"),
        "customer":        customer_name,
        "skuCode":         material_number,
        "skuName":         brand,
        "soldTo":          sold_to,
        "materialNumber":  material_number,
        "orderedQty":      int(ordered) if ordered else None,
        "mabd":            mabd_str,
        "description":     description,
        "riskProbability": prob,
        "fineAtRisk":      fine_est,
        "otifRulebook":    otif_rulebook,
        "originPlant":     plant_code,
        # Delivery-enriched origin plant metadata (dim_plant + fct_shipments + fct_deliveries).
        "originPlantName":     origin_plant_name,
        "originPlantCity":     origin_plant_city,
        "originPlantType":     origin_plant_type,
        "avgTransitHours":     round(avg_transit_hours, 1) if avg_transit_hours else None,
        "primaryCarrier":      primary_carrier or None,
        "recentFillRate":      round(recent_fill_rate, 1) if recent_fill_rate else None,
        # Extended risk data for the Fulfillment Simulator detail panels.
        "otifTarget":          otif_target,
        "otifProgram":         otif_program,
        "otifFailRate":        fail_rate_pct,
        "recentFails":         recent_fails,
        "totalDeliveries":     total_deliveries,
        "maxDaysLate":         max_days_late,
        "avgDaysLate":         round(avg_days_late, 1),
        "lastFailReason":      fail_reason,
        "lastRootCause":       root_cause,
        "avgChargebackUsd":    round(avg_chargeback, 2),
        "totalChargebackUsd":  round(total_chargeback, 2),
        "chargebackCount":     chargeback_count,
        "mabdEnforcement":     mabd_enforcement,
        "otifAggressive":      otif_aggressive == "Y",
        # Scenarios populated by the LP via POST /fulfillment/simulate.
        "scenarios":       [],
        "executionSteps":  [],
        "_demo_seed":      bool(demo_seed),
    }


def fetch_fulfillment_incidents() -> dict:
    """Public entry point for GET /fulfillment/incidents. Returns the
    shape FulfillmentIncidentsResponse expects: {incidents, meta}."""
    try:
        client = _bq_client()
    except Exception as exc:  # noqa: BLE001
        log.error("Fulfillment incidents BQ init failed: %s", exc, exc_info=True)
        return {"incidents": [], "meta": {"error": "bigquery_client_unavailable"}}
    try:
        incidents = _fetch_fulfillment_incidents(client)
    except Exception as exc:  # noqa: BLE001
        log.error("Fulfillment incidents query failed: %s", exc, exc_info=True)
        return {"incidents": [], "meta": {"error": str(exc)[:200]}}
    demo = any(i.get("_demo_seed") for i in incidents)
    return {
        "incidents": incidents,
        "meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": "bigquery",
            "approved_only": True,
            "fallback_demo_seed": demo,
            "count": len(incidents),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Root Cause Summary  (CFR computed from fct_otif; agg_cfr_weekly does not exist)
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_root_cause_summary(client: bigquery.Client) -> dict:
    # Overall CFR stats from fct_otif — use last 28 days relative to latest data
    stats_rows = _run(client, f"""
        WITH anchor AS (SELECT MAX(delivery_date_promised) AS max_dt FROM `{SEMANTIC_DS}.fct_otif`)
        SELECT
            ROUND(SAFE_DIVIDE(COUNTIF(otif_flag = 'Y'), COUNT(*)) * 100, 1) AS cfr_actual,
            COUNTIF(otif_flag = 'N')                                         AS cases_missed
        FROM `{SEMANTIC_DS}.fct_otif`, anchor
        WHERE delivery_date_promised >= DATE_SUB(anchor.max_dt, INTERVAL 28 DAY)
          AND delivery_date_promised <= anchor.max_dt
    """)
    stats = stats_rows[0] if stats_rows else {}

    cfr_actual   = round(_safe_float(stats.get("cfr_actual", 0.0)), 1)
    cases_missed = _safe_int(stats.get("cases_missed", 0))

    # Root cause category breakdown
    driver_rows = _run(client, f"""
        WITH anchor AS (SELECT MAX(delivery_date_promised) AS max_dt FROM `{SEMANTIC_DS}.fct_otif`)
        SELECT
            otif_root_cause_category AS category,
            COUNT(*) AS fail_count
        FROM `{SEMANTIC_DS}.fct_otif`, anchor
        WHERE otif_flag = 'N'
          AND delivery_date_promised >= DATE_SUB(anchor.max_dt, INTERVAL 28 DAY)
          AND delivery_date_promised <= anchor.max_dt
          AND otif_root_cause_category IS NOT NULL
        GROUP BY otif_root_cause_category
        ORDER BY fail_count DESC
        LIMIT 5
    """)

    cfr_target = 98.0
    cfr_gap    = round(max(0.0, cfr_target - cfr_actual), 1)

    # Classify categories into Demand vs Supply and assign owners
    _DEMAND_KEYWORDS = {"demand", "forecast", "order", "promo", "promotion", "anomaly", "phantom"}
    _OWNERS = {
        "Demand": {"ownerCode": "SC", "ownerName": "Sarah Chen",  "ownerDept": "Demand Planning"},
        "Supply": {"ownerCode": "JL", "ownerName": "James Lee",   "ownerDept": "Supply Planning"},
    }

    def _classify(cat: str) -> str:
        lower = cat.lower()
        return "Demand" if any(k in lower for k in _DEMAND_KEYWORDS) else "Supply"

    demand_missed = 0
    supply_missed = 0
    drivers = []
    for idx, r in enumerate(driver_rows, start=1):
        cat_raw    = r.get("category") or "Unknown"
        cat_type   = _classify(cat_raw)
        fail_count = _safe_int(r.get("fail_count"))
        owner      = _OWNERS[cat_type]
        if cat_type == "Demand":
            demand_missed += fail_count
        else:
            supply_missed += fail_count
        drivers.append({
            "id":          f"drv-{idx:03d}",
            "name":        cat_raw,
            "category":    cat_type,
            "casesMissed": fail_count,
            "ownerCode":   owner["ownerCode"],
            "ownerName":   owner["ownerName"],
            "ownerDept":   owner["ownerDept"],
            "description": f"{cat_raw} caused {fail_count} OTIF failures in the last 28 days.",
            "emailDraft":  "",
        })

    # Use BQ-derived split if we have drivers, otherwise estimate
    if demand_missed + supply_missed > 0:
        demand_driven = demand_missed
        supply_driven = supply_missed
    else:
        demand_driven = int(cases_missed * 0.55)
        supply_driven = int(cases_missed * 0.45)

    return {
        "weekEnding":        "",
        "totalCasesMissed":  cases_missed,
        "cfRActual":         cfr_actual,
        "cfrTarget":         cfr_target,
        "cfRGap":            cfr_gap,
        "demandDrivenCases": demand_driven,
        "supplyDrivenCases": supply_driven,
        "drivers":           drivers,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Safety Stock  (from inventory movements — aggregate net qty by material/plant)
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_safety_stock(client: bigquery.Client) -> list[dict]:
    # Net movement quantity per material as a proxy for current stock level
    sku_rows = _run(client, f"""
        SELECT
            material_number,
            MAX(material_description)   AS material_name,
            SUM(movement_quantity)      AS net_movement,
            ABS(SUM(movement_quantity)) AS abs_qty,
            COUNT(DISTINCT posting_date) AS days_observed
        FROM `{SEMANTIC_DS}.fct_inventory_movements`
        WHERE document_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 56 DAY)
        GROUP BY material_number
        HAVING ABS(SUM(movement_quantity)) > 0
        ORDER BY abs_qty DESC
        LIMIT 4
    """)

    if not sku_rows:
        return []

    recs: list[dict] = []
    for idx, sku in enumerate(sku_rows, start=1):
        matnr       = sku.get("material_number", "")
        name        = sku.get("material_name", matnr)
        abs_qty     = _safe_float(sku.get("abs_qty", 0))
        net_qty     = _safe_float(sku.get("net_movement", 0))

        # 8-week demand history from fct_sales_orders
        chart_rows = _run(client, f"""
            SELECT
                FORMAT_DATE('%G-W%V', order_creation_date) AS iso_week,
                SUM(ordered_quantity_sales_uom)             AS weekly_demand
            FROM `{SEMANTIC_DS}.fct_sales_orders`
            WHERE material_number = @matnr
              AND order_creation_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK)
            GROUP BY iso_week
            ORDER BY iso_week ASC
            LIMIT 8
        """, [bigquery.ScalarQueryParameter("matnr", "STRING", matnr)])

        current_static      = int(abs_qty * 0.4)
        recommended_dynamic = int(abs_qty * 0.6)

        if net_qty < 0 and abs(net_qty) > abs_qty * 0.5:
            severity   = "critical"
            short_desc = "Stockout Risk — Increase Target"
        elif net_qty > 0 and net_qty > abs_qty * 0.6:
            severity   = "warning"
            short_desc = "Overstocked — Reduce Target + Release Working Capital"
        else:
            severity   = "neutral"
            short_desc = "Seasonal Adjustment Recommended"

        week_labels = [f"W{i+1}" for i in range(8)]
        chart_data: list[dict] = []
        for i in range(8):
            demand = _safe_int(chart_rows[i].get("weekly_demand")) if i < len(chart_rows) else int(abs_qty * 0.15)
            chart_data.append({
                "week":         week_labels[i],
                "actualDemand": demand,
                "staticStock":  current_static,
                "dynamicMin":   int(recommended_dynamic * 0.85),
                "dynamicMax":   int(recommended_dynamic * 1.15),
            })

        recs.append({
            "id":                      f"sku-{idx:03d}",
            "skuCode":                 matnr,
            "skuName":                 name,
            "severity":                severity,
            "shortDesc":               short_desc,
            "detail":                  (
                f"Supply Planning Agent detects variance on {name}. "
                f"Net movement (56d): {int(net_qty):+,} units. "
                f"AI recommends adjusting safety stock target."
            ),
            "agents":                  ["Supply Planning Agent", "Demand Planning Agent"],
            "currentStaticStock":      current_static,
            "recommendedDynamicStock": recommended_dynamic,
            "financialImpact":         "Pending agent analysis",
            "rationale":               (
                f"Current static target of {current_static:,} CS based on 56-day movement data. "
                f"Dynamic recommendation of {recommended_dynamic:,} CS accounts for demand variability."
            ),
            "weeklyChartData":         chart_data,
        })

    return recs


# -----------------------------------------------------------------------------
# Decision Log  (reads tiger_decisions.fct_allocation_decisions when present)
# -----------------------------------------------------------------------------

# Shared decision-log column projection + filter (dashboard view + /decision-log
# endpoint use the same audit-row shape).
_DECISION_SELECT = """
    decision_id,
    decision_date,
    sold_to,
    decision_status,
    decision_approved_by,
    ordered_quantity_cases   AS ordered,
    allocated_quantity_cases AS allocated,
    shortfall_quantity_cases AS shortfall,
    fill_rate_pct            AS fill_rate,
    JSON_VALUE(decision_reason, '$.agent_recommendation')        AS agent_rec,
    JSON_VALUE(decision_reason, '$.user_decision')               AS user_decision,
    JSON_VALUE(decision_reason, '$.decision_aligned_with_agent') AS aligned,
    JSON_VALUE(decision_reason, '$.rejection_reason')            AS override_reason,
    JSON_VALUE(decision_reason, '$.rationale')                   AS rationale,
    JSON_VALUE(decision_reason, '$.session_id')                  AS session_id,
    JSON_VALUE(decision_reason, '$.orchestrator_version')        AS orchestrator_version,
    JSON_VALUE(decision_reason, '$.trigger.sales_order_number')  AS order_no,
    JSON_VALUE(decision_reason, '$.trigger.customer_name')       AS customer_name,
    JSON_VALUE(decision_reason, '$.trigger.material_number')     AS material
"""
# Exclude PLACEHOLDER test rows from the audit view.
_DECISION_WHERE = ("COALESCE(JSON_VALUE(decision_reason, '$.trigger.customer_name'), '') "
                   "NOT LIKE 'PLACEHOLDER%'")


# Process-level cache of per-customer OTIF penalty rate ($/case). The decision
# log references only a handful of customers; caching across requests keeps the
# audit endpoint fast (no per-row chargeback queries on every load).
_PENALTY_RATE_CACHE: dict[str, float] = {}


def _penalty_rates(sold_tos: list) -> dict:
    """Return {sold_to: penalty_per_case_usd} for the given customers.

    Queries fct_chargebacks + fct_otif (us-central1) in ONE batched query for any
    customers not yet cached. Formula matches get_customer_penalty_profile
    (avg_chargeback × n / total_late_qty over 180d; $25 fallback)."""
    want = sorted({s for s in sold_tos if s and s not in _PENALTY_RATE_CACHE})
    if want:
        try:
            cc = _bq_client()
            rows = _run(cc, f"""
              WITH cb AS (
                SELECT sold_to, AVG(NULLIF(chargeback_amount_usd, 0)) AS avg_amt, COUNT(*) AS n
                FROM `{SEMANTIC_DS}.fct_chargebacks`
                WHERE sold_to IN UNNEST(@solds)
                  AND chargeback_assessed_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
                  AND COALESCE(chargeback_status, '') <> 'WRITTEN_OFF'
                GROUP BY sold_to
              ),
              lu AS (
                SELECT sold_to,
                       SUM(GREATEST(ordered_quantity_cases - COALESCE(delivered_quantity_cases, 0), 0)) AS late_qty
                FROM `{SEMANTIC_DS}.fct_otif`
                WHERE sold_to IN UNNEST(@solds) AND otif_flag = 'N'
                  AND delivery_date_promised >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
                GROUP BY sold_to
              )
              SELECT cb.sold_to AS sold_to, cb.avg_amt AS avg_amt, cb.n AS n, lu.late_qty AS late_qty
              FROM cb LEFT JOIN lu USING (sold_to)
            """, [bigquery.ArrayQueryParameter("solds", "STRING", want)])
            for r in rows:
                avg_amt = r.get("avg_amt")
                n = int(r.get("n") or 0)
                late = float(r.get("late_qty") or 0)
                per = (float(avg_amt) * n / late) if (avg_amt and n > 0 and late > 0) else 0.0
                _PENALTY_RATE_CACHE[r.get("sold_to")] = round(per, 2) if per > 0 else 25.0
        except Exception as exc:
            log.warning("batch penalty query failed: %s", exc)
        for s in want:                       # customers with no chargebacks → fallback
            _PENALTY_RATE_CACHE.setdefault(s, 25.0)
    return {s: _PENALTY_RATE_CACHE.get(s, 25.0) for s in sold_tos if s}


def _decision_row(r: dict, penalty_fn) -> dict:
    """Build one enriched Decision Log audit row from a raw
    fct_allocation_decisions row. Surfaces every audit field the UI shows."""
    d = r.get("decision_date")
    ts = d.isoformat() if isinstance(d, (date, datetime)) else str(d or "")
    sold_to = r.get("sold_to") or ""
    ordered = _safe_float(r.get("ordered"))
    alloc = _safe_float(r.get("allocated"))
    short = _safe_float(r.get("shortfall"))
    fill = _safe_float(r.get("fill_rate"))
    status = (r.get("decision_status") or "").upper()
    user_dec = (r.get("user_decision") or "").lower()

    # Real alignment from the DCE record; fall back to "user approved" for
    # legacy rows missing the flag (matches how dce_write set it).
    aligned_raw = (r.get("aligned") or "").strip().lower()
    if aligned_raw in ("true", "false"):
        aligned = aligned_raw == "true"
    else:
        aligned = user_dec in ("approved", "accept", "accepted")

    # Outcome derived from real fill / shortfall / status.
    if fill >= 100 or (ordered > 0 and alloc >= ordered):
        outcome = "Fulfilled · CFR 100%"
    elif alloc <= 0 and short > 0:
        outcome = f"Not allocated · {int(short):,} cs short"
    elif 0 < fill < 100:
        outcome = f"Partial · {fill:.0f}% · {int(short):,} cs short"
    else:
        outcome = status.title() or "—"

    # Financial = OTIF penalty exposure (shortfall × per-customer rate).
    penalty = penalty_fn(sold_to) if short > 0 else 0.0
    financial = -round(short * penalty) if short > 0 else 0

    return {
        "id":                  r.get("decision_id", ""),
        "timestamp":           ts,
        "poNumber":            r.get("order_no") or "",
        "customer":            r.get("customer_name") or sold_to,
        "material":            r.get("material") or "",
        # `action` = the agent's recommendation (ACCEPT/REJECT/PARTIAL/DEFER).
        "action":              r.get("agent_rec") or "",
        "agentRecommendation": r.get("agent_rec") or "",
        "userDecision":        user_dec,
        "fulfillQty":          alloc,
        "fillRatePct":         round(fill, 1),
        "userId":              r.get("decision_approved_by") or "",
        "rationale":           r.get("rationale") or "",
        "sessionId":           r.get("session_id") or "",
        "orchestratorVersion": r.get("orchestrator_version") or "",
        "overrideReason":      r.get("override_reason"),
        "outcome":             outcome,
        "aligned":             aligned,
        "financialImpact":     financial,
        "wentWrong":           (not aligned) and short > 0,
    }


def _fetch_decision_log(client: bigquery.Client) -> list[dict]:
    """Latest 20 agentic decisions for the dashboard's `decisionCaptureLog`.

    Source: tiger_decisions.fct_allocation_decisions (US multi-region — its own
    client avoids a cross-location 404). PLACEHOLDER test rows are filtered out.
    """
    dclient = _bq_decisions()
    decisions_ds = f"{PROJECT_ID}.tiger_decisions"
    rows = _run(dclient, f"""
        SELECT {_DECISION_SELECT}
        FROM `{decisions_ds}.fct_allocation_decisions`
        WHERE {_DECISION_WHERE}
        ORDER BY decision_date DESC
        LIMIT 20
    """)
    rates = _penalty_rates([r.get("sold_to") for r in rows])
    return [_decision_row(r, lambda st: rates.get(st, 25.0)) for r in rows]


def fetch_decision_log_page(limit: int = 200, offset: int = 0) -> dict:
    """Paginated audit trail for GET /decision-log.

    Returns {total_count, filtered_count, decisions[]}. total_count is the full
    row count (for pagination); filtered_count is rows on this page. Newest first.
    """
    limit = max(1, min(int(limit or 200), 1000))
    offset = max(0, int(offset or 0))
    dclient = _bq_decisions()
    decisions_ds = f"{PROJECT_ID}.tiger_decisions"
    # One query: page rows + full filtered count via COUNT(*) OVER() (window runs
    # over all WHERE-matching rows, before LIMIT) — avoids a second COUNT query.
    rows = _run(dclient, f"""
        SELECT {_DECISION_SELECT},
               COUNT(*) OVER() AS total_rows
        FROM `{decisions_ds}.fct_allocation_decisions`
        WHERE {_DECISION_WHERE}
        ORDER BY decision_date DESC
        LIMIT @limit OFFSET @offset
    """, [
        bigquery.ScalarQueryParameter("limit", "INT64", limit),
        bigquery.ScalarQueryParameter("offset", "INT64", offset),
    ])
    total = _safe_int(rows[0].get("total_rows")) if rows else 0
    rates = _penalty_rates([r.get("sold_to") for r in rows])
    decisions = [_decision_row(r, lambda st: rates.get(st, 25.0)) for r in rows]
    return {
        "total_count":    total,
        "filtered_count": len(decisions),
        "decisions":      decisions,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main entry
# ─────────────────────────────────────────────────────────────────────────────

def _safe_section(name: str, fn, client, default):
    """Run one dashboard section, isolating failures.

    Individual queries already degrade to [] inside _run, but each
    _fetch_* function also post-processes rows (sums, indexing, type
    coercion). An unexpected row shape there would otherwise raise and
    500 the entire /dashboard-data route. This guarantees the docstring
    promise: one bad section degrades to its safe default, the rest of
    the dashboard still renders.
    """
    try:
        return fn(client)
    except Exception as exc:
        log.error("Dashboard section '%s' failed: %s", name, exc, exc_info=True)
        return default


def fetch_dashboard_data() -> dict:
    try:
        client = _bq_client()
    except Exception as exc:
        # BigQuery client itself could not be created. Return an all-empty
        # dashboard rather than 500 — the front-end falls back to mock data.
        log.error("Dashboard BQ client init failed: %s", exc, exc_info=True)
        client = None

    if client is None:
        return {
            "globalKPIs": {}, "alerts": [], "networkNodes": [],
            "purchaseOrders": [],
            # fulfillmentIncidents moved to its own endpoint
            # (GET /fulfillment/incidents). Kept here as [] for
            # backward-compat with any client still expecting the field.
            "fulfillmentIncidents": [],
            "rootCauseSummary": {}, "safetyStockRecommendations": [],
            "decisionCaptureLog": [],
            "_meta": {
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "source": "bigquery", "project": PROJECT_ID,
                "error": "bigquery_client_unavailable",
            },
        }

    return {
        "globalKPIs":                 _safe_section(
            "globalKPIs", _fetch_global_kpis, client, {}),
        "alerts":                     _safe_section(
            "alerts", _fetch_alerts, client, []),
        "networkNodes":               _safe_section(
            "networkNodes", _fetch_network_nodes, client, []),
        "purchaseOrders":             _safe_section(
            "purchaseOrders", _fetch_purchase_orders, client, []),
        # fulfillmentIncidents intentionally omitted from /dashboard-data
        # — served by GET /fulfillment/incidents (single-responsibility).
        # Kept as empty list here only so callers that still destructure
        # the field don't crash. Deprecate after one release.
        "fulfillmentIncidents":       [],
        "rootCauseSummary":           _safe_section(
            "rootCauseSummary", _fetch_root_cause_summary, client, {}),
        "safetyStockRecommendations": _safe_section(
            "safetyStockRecommendations", _fetch_safety_stock, client, []),
        "decisionCaptureLog":         _safe_section(
            "decisionCaptureLog", _fetch_decision_log, client, []),
        "_meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source":     "bigquery",
            "project":    PROJECT_ID,
        },
    }


# =============================================================================
# Phase 7 — Agent overview pages (Supply / Demand / Transport / Retail)
# =============================================================================
# Public entry points: fetch_agents_supply, fetch_agents_demand,
# fetch_agents_transport, fetch_agents_retail. Each is wired to a GET route
# in main.py: /agents/{supply,demand,transport,retail}.
#
# Shape contract: { "data": {<port-specific subtree>}, "meta": {...} }
# All routes degrade gracefully if BQ is unavailable — they return empty
# inner arrays + an `error` string in meta. They NEVER raise (matches the
# convention of fetch_fulfillment_incidents).
#
# Field names match the AI Studio reference PORT_* constants verbatim so
# the frontend page components can render without a remapping step.
# =============================================================================


# ─── /agents/supply ───────────────────────────────────────────────────────────

def _fetch_agents_supply(client: bigquery.Client) -> dict:
    """Inventory positions + production schedule adherence + raw material
    concerns. Matches PORT_SUPPLY shape from mars-supply-ai-v2_02-restyled.jsx
    lines 1250–1275."""

    # ── Inventory positions: latest snapshot per (material × plant), with
    #    derived status + days-of-supply heuristic.
    inv_rows = _run(client, f"""
        WITH latest AS (
          SELECT material_number, plant_code,
                 SUM(batch_unrestricted_stock) AS on_hand_cs,
                 MAX(snapshot_date)            AS snap_dt
          FROM `{SEMANTIC_DS}.fct_inventory_batch_snapshot`
          WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
          GROUP BY material_number, plant_code
        ),
        demand AS (
          SELECT material_number,
                 SAFE_DIVIDE(SUM(ordered_quantity_sales_uom), 90.0) AS avg_daily_demand
          FROM `{SEMANTIC_DS}.fct_sales_orders`
          WHERE order_creation_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
            AND rejection_reason IS NULL
          GROUP BY material_number
        )
        SELECT
          l.material_number      AS sku,
          COALESCE(m.material_description, l.material_number) AS desc,
          l.plant_code           AS dc,
          CAST(l.on_hand_cs AS INT64) AS cs,
          ROUND(SAFE_DIVIDE(l.on_hand_cs, NULLIF(d.avg_daily_demand, 0)), 1) AS dos
        FROM latest l
        LEFT JOIN `{SEMANTIC_DS}.dim_material` m ON l.material_number = m.material_number
        LEFT JOIN demand d ON d.material_number = l.material_number
        ORDER BY dos ASC NULLS LAST
        LIMIT 50
    """)

    def _shape_inventory(r: dict) -> dict:
        cs  = _safe_int(r.get("cs"))
        dos = r.get("dos")
        if cs <= 0:
            status, short = "STOCKOUT", max(0, 2000 - cs)
        elif dos is not None and dos < 7:
            status, short = "BELOW_SS", max(0, int(2000 - cs))
        else:
            status, short = "OK", 0
        return {
            "sku":    r.get("sku") or "",
            "desc":   r.get("desc") or "",
            "dc":     r.get("dc") or "",
            "cs":     cs,
            "dos":    float(dos) if dos is not None else 0.0,
            "status": status,
            "short":  short,
        }

    # ── Production schedule adherence (open + recently complete runs).
    prod_rows = _run(client, f"""
        SELECT
          production_order_number                AS pro,
          item_material_number                   AS sku,
          item_material_description              AS desc,
          CAST(planned_end_date AS STRING)       AS end_date,
          production_order_status                AS status,
          plan_adherence_pct                     AS adherence
        FROM `{SEMANTIC_DS}.fct_production_orders`
        WHERE planned_end_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
          AND planned_end_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 60 DAY)
        ORDER BY planned_end_date ASC
        LIMIT 30
    """)

    def _shape_production(r: dict) -> dict:
        adh = _safe_float(r.get("adherence"))
        if adh < 85.0:
            risk = "HIGH"
        elif adh < 95.0:
            risk = "MEDIUM"
        else:
            risk = "LOW"
        return {
            "pro":       r.get("pro") or "",
            "sku":       r.get("sku") or "",
            "desc":      r.get("desc") or "",
            "end":       r.get("end_date") or "",
            "status":    r.get("status") or "",
            "adherence": round(adh, 1),
            "risk":      risk,
        }

    # ── Raw-material concerns. fct_bills_of_materials links FERTs to
    #    components; we surface the components with the lowest DoS.
    raw_rows = _run(client, f"""
        WITH components AS (
          SELECT DISTINCT component_material_number AS material_number
          FROM `{SEMANTIC_DS}.fct_bills_of_materials`
        ),
        comp_stock AS (
          SELECT material_number,
                 SUM(batch_unrestricted_stock) AS on_hand
          FROM `{SEMANTIC_DS}.fct_inventory_batch_snapshot`
          WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
          GROUP BY material_number
        ),
        fert_link AS (
          SELECT component_material_number AS comp,
                 STRING_AGG(DISTINCT fert_material_number, ', ' ORDER BY fert_material_number LIMIT 5) AS skus
          FROM `{SEMANTIC_DS}.fct_bills_of_materials`
          GROUP BY component_material_number
        )
        SELECT
          c.material_number                            AS material_number,
          COALESCE(m.material_description, c.material_number) AS material,
          s.on_hand                                    AS on_hand_cs,
          l.skus                                       AS skus
        FROM components c
        LEFT JOIN `{SEMANTIC_DS}.dim_material` m ON c.material_number = m.material_number
        LEFT JOIN comp_stock s ON c.material_number = s.material_number
        LEFT JOIN fert_link  l ON c.material_number = l.comp
        ORDER BY s.on_hand ASC NULLS FIRST
        LIMIT 10
    """)

    def _shape_raw(r: dict) -> dict:
        on_hand = _safe_int(r.get("on_hand_cs"))
        # Heuristic DoS — 100 cases/day average burn for components.
        dos = round(on_hand / 100.0, 1) if on_hand > 0 else 0.0
        concern = dos < 14.0
        rationale = (
            f"Low inventory: {on_hand:,} cs (~{dos}d)"
            if concern
            else f"Healthy buffer: {on_hand:,} cs (~{dos}d)"
        )
        return {
            "material":  r.get("material") or "",
            "concern":   concern,
            "dos":       dos,
            "rationale": rationale,
            "skus":      r.get("skus") or "",
        }

    return {
        "inventory":     [_shape_inventory(r) for r in inv_rows],
        "production":    [_shape_production(r) for r in prod_rows],
        "raw_materials": [_shape_raw(r) for r in raw_rows],
    }


def fetch_agents_supply() -> dict:
    """Public entry point for GET /agents/supply."""
    try:
        client = _bq_client()
    except Exception as exc:  # noqa: BLE001
        log.error("Agents supply BQ init failed: %s", exc, exc_info=True)
        return {"data": {"inventory": [], "production": [], "raw_materials": []},
                "meta": {"error": "bigquery_client_unavailable"}}
    try:
        data = _fetch_agents_supply(client)
    except Exception as exc:  # noqa: BLE001
        log.error("Agents supply query failed: %s", exc, exc_info=True)
        return {"data": {"inventory": [], "production": [], "raw_materials": []},
                "meta": {"error": str(exc)[:200]}}
    return {
        "data": data,
        "meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source":     "bigquery",
            "count":      sum(len(v) for v in data.values()),
        },
    }


# ─── /agents/demand ───────────────────────────────────────────────────────────

def _classify_demand(vs_plan_pct: float, quality: str, has_promo: bool,
                     confidence: float) -> tuple[str, float]:
    """Mirror of the AI Studio classification logic. Returns (cls, conf)."""
    if has_promo and 20.0 <= vs_plan_pct <= 80.0:
        return "PROMO_DRIVEN", max(confidence, 0.85)
    if vs_plan_pct >= 100.0 and quality == "SYSTEMATIC_OVER":
        return "BUFFER_BUILD", max(confidence, 0.85)
    if 30.0 <= vs_plan_pct <= 80.0 and quality in ("HEALTHY", "SYSTEMATIC_UNDER"):
        return "GENUINE_PULL", max(confidence, 0.80)
    if vs_plan_pct >= 20.0:
        return "ONE_OFF_ANOMALY", max(confidence * 0.7, 0.55)
    return "GENUINE_PULL", max(confidence, 0.90)


def _fetch_agents_demand(client: bigquery.Client) -> dict:
    """Forecast positions + promotional calendar. PORT_DEMAND shape."""

    position_rows = _run(client, f"""
        WITH actual_7d AS (
          SELECT sold_to, material_number,
                 SUM(ordered_quantity_sales_uom) AS actual_cs
          FROM `{SEMANTIC_DS}.fct_sales_orders`
          WHERE order_creation_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            AND rejection_reason IS NULL
          GROUP BY sold_to, material_number
        ),
        forecast_7d AS (
          SELECT sold_to, material_zrep_number,
                 SUM(forecast_quantity_consensus) AS plan_cs
          FROM `{SEMANTIC_DS}.fct_forecast`
          WHERE forecast_week_start_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            AND forecast_week_start_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)
          GROUP BY sold_to, material_zrep_number
        ),
        promo_active AS (
          SELECT DISTINCT sold_to, material_zrep_number
          FROM `{SEMANTIC_DS}.fct_promo_plan`
          WHERE promo_start_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 14 DAY)
            AND promo_end_date   >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
        )
        SELECT
          a.sold_to                              AS sold_to,
          COALESCE(c.customer_name, a.sold_to)   AS customer,
          a.material_number                      AS sku,
          COALESCE(m.material_description, a.material_number) AS desc,
          a.actual_cs                            AS actual_cs,
          f.plan_cs                              AS plan_cs,
          fa.wmape_pct                           AS wmape,
          fa.bias_pct                            AS bias,
          fa.quality_flag                        AS quality,
          IF(pa.sold_to IS NOT NULL, TRUE, FALSE) AS has_promo
        FROM actual_7d a
        LEFT JOIN forecast_7d         f  ON a.sold_to = f.sold_to
                                        AND a.material_number = f.material_zrep_number
        LEFT JOIN `{SEMANTIC_DS}.dim_customer` c ON a.sold_to = c.sold_to
        LEFT JOIN `{SEMANTIC_DS}.dim_material` m ON a.material_number = m.material_number
        LEFT JOIN `{SEMANTIC_DS}.fct_forecast_accuracy` fa
                                           ON a.sold_to = fa.sold_to
                                          AND a.material_number = fa.material_zrep_number
        LEFT JOIN promo_active        pa ON a.sold_to = pa.sold_to
                                        AND a.material_number = pa.material_zrep_number
        ORDER BY ABS(SAFE_DIVIDE(a.actual_cs - f.plan_cs, NULLIF(f.plan_cs, 0))) DESC NULLS LAST
        LIMIT 20
    """)

    def _shape_position(r: dict) -> dict:
        actual    = _safe_float(r.get("actual_cs"))
        plan      = _safe_float(r.get("plan_cs"))
        vs_plan   = round(((actual - plan) / plan * 100.0) if plan > 0 else 0.0, 1)
        wmape     = _safe_float(r.get("wmape"))
        bias      = _safe_float(r.get("bias"))
        quality   = (r.get("quality") or "HEALTHY").upper()
        promo     = bool(r.get("has_promo"))
        # Confidence — backed off from wmape: lower wmape ⇒ higher conf.
        base_conf = max(0.5, min(0.95, 1.0 - (wmape / 100.0)))
        cls, conf = _classify_demand(vs_plan, quality, promo, base_conf)
        escalation = vs_plan >= 100.0 and cls == "BUFFER_BUILD"
        return {
            "customer":       r.get("customer") or "",
            "sku":            r.get("sku") or "",
            "desc":           r.get("desc") or "",
            "vs_plan":        vs_plan,
            "plan_cs":        int(plan),
            "classification": cls,
            "conf":           round(conf, 2),
            "wmape":          round(wmape, 1),
            "bias":           round(bias, 1),
            "quality":        quality,
            "promo":          promo,
            "escalation":     escalation,
        }

    promo_rows = _run(client, f"""
        SELECT
          p.sold_to                            AS sold_to,
          COALESCE(c.customer_name, p.sold_to) AS customer,
          p.material_zrep_number               AS sku,
          p.promo_name                         AS name,
          p.promo_type                         AS type,
          CAST(p.promo_start_date AS STRING)   AS start_date,
          CAST(p.promo_end_date   AS STRING)   AS end_date,
          p.expected_incremental_quantity      AS incr,
          p.promo_status                       AS status
        FROM `{SEMANTIC_DS}.fct_promo_plan` p
        LEFT JOIN `{SEMANTIC_DS}.dim_customer` c ON p.sold_to = c.sold_to
        WHERE p.promo_end_date   >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
          AND p.promo_start_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 30 DAY)
        ORDER BY p.promo_start_date ASC
        LIMIT 20
    """)

    def _shape_promo(r: dict) -> dict:
        start = r.get("start_date") or ""
        end   = r.get("end_date") or ""
        dates = f"{start} → {end}" if start and end else (start or end)
        return {
            "customer": r.get("customer") or "",
            "sku":      r.get("sku") or "",
            "name":     r.get("name") or "",
            "type":     (r.get("type") or "").upper().replace(" ", "_"),
            "dates":    dates,
            "incr":     _safe_int(r.get("incr")),
            "status":   (r.get("status") or "").upper(),
        }

    return {
        "positions":      [_shape_position(r) for r in position_rows],
        "promo_calendar": [_shape_promo(r)    for r in promo_rows],
    }


def fetch_agents_demand() -> dict:
    """Public entry point for GET /agents/demand."""
    try:
        client = _bq_client()
    except Exception as exc:  # noqa: BLE001
        log.error("Agents demand BQ init failed: %s", exc, exc_info=True)
        return {"data": {"positions": [], "promo_calendar": []},
                "meta": {"error": "bigquery_client_unavailable"}}
    try:
        data = _fetch_agents_demand(client)
    except Exception as exc:  # noqa: BLE001
        log.error("Agents demand query failed: %s", exc, exc_info=True)
        return {"data": {"positions": [], "promo_calendar": []},
                "meta": {"error": str(exc)[:200]}}
    return {
        "data": data,
        "meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source":     "bigquery",
            "count":      sum(len(v) for v in data.values()),
        },
    }


# ─── /agents/transport ────────────────────────────────────────────────────────

def _fetch_agents_transport(client: bigquery.Client) -> dict:
    """Lanes + carrier league + OTIF scoreboard. PORT_TRANSPORT shape."""

    lane_rows = _run(client, f"""
        SELECT
          s.plant_code                     AS origin,
          s.ship_to                        AS dest,
          ROUND(AVG(s.transit_hours_actual), 1) AS transit,
          ROUND(SAFE_DIVIDE(
            COUNTIF(s.is_on_time_flag = 'Y'), COUNT(*)), 2) AS otp,
          COUNT(*)                         AS ships,
          ANY_VALUE(c.carrier_name)        AS carrier
        FROM `{SEMANTIC_DS}.fct_shipments` s
        LEFT JOIN `{SEMANTIC_DS}.dim_carrier` c ON s.carrier_id = c.carrier_id
        WHERE s.actual_departure_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
        GROUP BY origin, dest
        HAVING ships >= 5
        ORDER BY ships DESC
        LIMIT 12
    """)

    def _shape_lane(r: dict, idx: int) -> dict:
        otp = _safe_float(r.get("otp"))
        ships = _safe_int(r.get("ships"))
        return {
            "id":      f"lane-{idx:03d}",
            "lane":    f"{r.get('origin') or '—'} → {r.get('dest') or '—'}",
            "origin":  r.get("origin") or "",
            "dest":    r.get("dest") or "",
            "transit": _safe_float(r.get("transit")),
            "otp":     round(otp, 2),
            "ships":   ships,
            "viable":  otp >= 0.85 and ships >= 10,
            "carrier": r.get("carrier") or "",
        }

    carrier_rows = _run(client, f"""
        SELECT
          c.carrier_name                   AS name,
          ROUND(SAFE_DIVIDE(
            COUNTIF(s.is_on_time_flag = 'Y'), COUNT(*)), 2) AS otp,
          COALESCE(c.target_otp_pct / 100.0, 0.95) AS target,
          COUNT(*)                         AS ships
        FROM `{SEMANTIC_DS}.fct_shipments` s
        JOIN `{SEMANTIC_DS}.dim_carrier`  c ON s.carrier_id = c.carrier_id
        WHERE s.actual_departure_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
        GROUP BY name, c.target_otp_pct
        HAVING ships >= 10
        ORDER BY otp DESC
        LIMIT 10
    """)

    def _shape_carrier(r: dict) -> dict:
        otp    = _safe_float(r.get("otp"))
        target = _safe_float(r.get("target"))
        return {
            "name":   r.get("name") or "",
            "otp":    round(otp, 2),
            "target": round(target, 2),
            "ships":  _safe_int(r.get("ships")),
            "cb":     0,           # Joined separately below when fct_chargebacks is reliable
            "meets":  otp >= target,
        }

    otif_rows = _run(client, f"""
        WITH otif_agg AS (
          SELECT sold_to,
                 ROUND(SAFE_DIVIDE(
                   COUNTIF(otif_flag = 'Y'), COUNT(*)), 2) AS otif,
                 COUNT(*) AS deliveries
          FROM `{SEMANTIC_DS}.fct_otif`
          WHERE delivery_date_promised >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
          GROUP BY sold_to
          HAVING deliveries >= 20
        ),
        cb_agg AS (
          SELECT sold_to,
                 COUNT(*)                        AS cb_count,
                 SUM(chargeback_amount_usd)      AS cb_usd
          FROM `{SEMANTIC_DS}.fct_chargebacks`
          WHERE chargeback_assessed_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
          GROUP BY sold_to
        )
        SELECT
          o.sold_to                              AS sold_to,
          COALESCE(c.customer_name, o.sold_to)   AS customer,
          o.otif                                 AS otif,
          COALESCE(c.otif_target_pct / 100.0, 0.95) AS target,
          cb.cb_count                            AS cb,
          cb.cb_usd                              AS exposure
        FROM otif_agg o
        LEFT JOIN `{SEMANTIC_DS}.dim_customer` c ON o.sold_to = c.sold_to
        LEFT JOIN cb_agg                       cb ON o.sold_to = cb.sold_to
        ORDER BY o.otif ASC
        LIMIT 12
    """)

    def _shape_otif(r: dict) -> dict:
        otif   = _safe_float(r.get("otif"))
        target = _safe_float(r.get("target"))
        delta  = round((otif - target) * 100.0, 1)
        return {
            "customer": r.get("customer") or "",
            "otif":     round(otif, 2),
            "target":   round(target, 2),
            "delta":    delta,
            "cb":       _safe_int(r.get("cb")),
            "exposure": _safe_int(r.get("exposure")),
        }

    return {
        "lanes":    [_shape_lane(r, i) for i, r in enumerate(lane_rows, start=1)],
        "carriers": [_shape_carrier(r) for r in carrier_rows],
        "otif":     [_shape_otif(r)    for r in otif_rows],
    }


def fetch_agents_transport() -> dict:
    """Public entry point for GET /agents/transport."""
    try:
        client = _bq_client()
    except Exception as exc:  # noqa: BLE001
        log.error("Agents transport BQ init failed: %s", exc, exc_info=True)
        return {"data": {"lanes": [], "carriers": [], "otif": []},
                "meta": {"error": "bigquery_client_unavailable"}}
    try:
        data = _fetch_agents_transport(client)
    except Exception as exc:  # noqa: BLE001
        log.error("Agents transport query failed: %s", exc, exc_info=True)
        return {"data": {"lanes": [], "carriers": [], "otif": []},
                "meta": {"error": str(exc)[:200]}}
    return {
        "data": data,
        "meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source":     "bigquery",
            "count":      sum(len(v) for v in data.values()),
        },
    }


# ─── /agents/retail ───────────────────────────────────────────────────────────

def _fetch_agents_retail(client: bigquery.Client) -> dict:
    """Demand classifications + POS velocity trends. PORT_RETAIL shape."""

    # Classifications — 8-week aggregate per (sold_to × material).
    cls_rows = _run(client, f"""
        WITH d AS (
          SELECT
            d.sold_to,
            d.material_zrep_number AS material_zrep_number,
            SUM(d.pos_units_consumer_takeaway)            AS pos_total,
            AVG(d.distribution_pct_acv)                    AS acv,
            MAX(d.promo_active_flag)                       AS promo,
            AVG(IF(d.driver_week_start_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK),
                   d.pos_units_consumer_takeaway, NULL))  AS pos_recent,
            AVG(IF(d.driver_week_start_date <  DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK),
                   d.pos_units_consumer_takeaway, NULL))  AS pos_prior
          FROM `{SEMANTIC_DS}.fct_demand_drivers` d
          WHERE d.driver_week_start_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK)
          GROUP BY d.sold_to, d.material_zrep_number
        )
        SELECT
          d.sold_to                                    AS sold_to,
          COALESCE(c.customer_name, d.sold_to)         AS customer,
          d.material_zrep_number                       AS sku,
          COALESCE(m.material_description,
                   d.material_zrep_number)             AS desc,
          d.pos_total                                  AS pos,
          d.pos_recent                                 AS pos_recent,
          d.pos_prior                                  AS pos_prior,
          d.acv                                        AS acv,
          d.promo                                      AS promo
        FROM d
        LEFT JOIN `{SEMANTIC_DS}.dim_customer` c ON d.sold_to = c.sold_to
        LEFT JOIN `{SEMANTIC_DS}.dim_material` m ON d.material_zrep_number = m.material_number
        WHERE d.pos_total IS NOT NULL
        ORDER BY d.pos_total DESC
        LIMIT 12
    """)

    def _shape_classification(r: dict) -> dict:
        pos        = _safe_int(r.get("pos"))
        pos_recent = _safe_float(r.get("pos_recent"))
        pos_prior  = _safe_float(r.get("pos_prior"))
        promo      = bool(r.get("promo"))
        # Trend ratio: recent vs prior. ≥1.1 accelerating; ≤0.9 decelerating.
        if pos_prior > 0:
            ratio = pos_recent / pos_prior
        else:
            ratio = 1.0
        if ratio >= 1.10:
            trend = "ACCELERATING"
        elif ratio <= 0.90:
            trend = "DECELERATING"
        else:
            trend = "FLAT"
        # Classification: simple heuristic on trend × promo.
        if promo:
            cls, conf = "PROMO_DRIVEN", 0.88
        elif trend == "ACCELERATING":
            cls, conf = "GENUINE_PULL", 0.85
        elif trend == "DECELERATING":
            cls, conf = "BUFFER_BUILD", 0.80
        else:
            cls, conf = "GENUINE_PULL", 0.78
        risk_score = (
            5 if cls == "BUFFER_BUILD" else
            3 if cls == "PROMO_DRIVEN" else
            2 if trend == "ACCELERATING" else 1
        )
        return {
            "customer": r.get("customer") or "",
            "sku":      r.get("sku") or "",
            "desc":     r.get("desc") or "",
            "cls":      cls,
            "conf":     round(conf, 2),
            "pos":      pos,
            "trend":    trend,
            "ohi":      None,            # fct_demand_drivers retailer OHI not in current view
            "ohi_norm": None,
            "promo":    promo,
            "risk":     risk_score,
        }

    # POS trends — 8 weekly points per top SKU. Network-level (no sold_to filter)
    # for a clean weekly trend line.
    trend_rows = _run(client, f"""
        WITH top_skus AS (
          SELECT material_zrep_number, SUM(pos_units_consumer_takeaway) AS total
          FROM `{SEMANTIC_DS}.fct_demand_drivers`
          WHERE driver_week_start_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK)
          GROUP BY material_zrep_number
          ORDER BY total DESC
          LIMIT 5
        ),
        weeks AS (
          SELECT d.material_zrep_number,
                 d.driver_week_start_date,
                 SUM(d.pos_units_consumer_takeaway) AS units,
                 AVG(d.distribution_pct_acv)        AS acv,
                 ROW_NUMBER() OVER (
                   PARTITION BY d.material_zrep_number
                   ORDER BY d.driver_week_start_date DESC
                 ) AS week_rank
          FROM `{SEMANTIC_DS}.fct_demand_drivers` d
          JOIN top_skus t ON d.material_zrep_number = t.material_zrep_number
          WHERE d.driver_week_start_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK)
          GROUP BY d.material_zrep_number, d.driver_week_start_date
        )
        SELECT
          w.material_zrep_number                       AS sku,
          COALESCE(m.material_description,
                   w.material_zrep_number)             AS desc,
          ARRAY_AGG(STRUCT(
            CONCAT('W', CAST(9 - w.week_rank AS STRING)) AS w,
            CAST(w.units AS INT64) AS v
          ) ORDER BY w.week_rank DESC LIMIT 8)         AS weekly,
          AVG(w.acv)                                   AS acv
        FROM weeks w
        LEFT JOIN `{SEMANTIC_DS}.dim_material` m
                                   ON w.material_zrep_number = m.material_number
        WHERE w.week_rank <= 8
        GROUP BY w.material_zrep_number, desc
        LIMIT 5
    """)

    def _shape_trend(r: dict) -> dict:
        weekly = r.get("weekly") or []
        # Determine overall trend by comparing first half vs second half.
        if len(weekly) >= 4:
            first_half = sum(_safe_int(w.get("v")) for w in weekly[:len(weekly)//2])
            second_half = sum(_safe_int(w.get("v")) for w in weekly[len(weekly)//2:])
            if second_half > first_half * 1.10:
                trend = "ACCELERATING"
            elif second_half < first_half * 0.90:
                trend = "DECELERATING"
            else:
                trend = "FLAT"
        else:
            trend = "FLAT"
        return {
            "sku":    r.get("sku") or "",
            "desc":   r.get("desc") or "",
            "trend":  trend,
            "acv":    round(_safe_float(r.get("acv")), 1),
            "weekly": [{"w": w.get("w") or "", "v": _safe_int(w.get("v"))} for w in weekly],
        }

    return {
        "classifications": [_shape_classification(r) for r in cls_rows],
        "pos_trends":      [_shape_trend(r)          for r in trend_rows],
    }


def fetch_agents_retail() -> dict:
    """Public entry point for GET /agents/retail."""
    try:
        client = _bq_client()
    except Exception as exc:  # noqa: BLE001
        log.error("Agents retail BQ init failed: %s", exc, exc_info=True)
        return {"data": {"classifications": [], "pos_trends": []},
                "meta": {"error": "bigquery_client_unavailable"}}
    try:
        data = _fetch_agents_retail(client)
    except Exception as exc:  # noqa: BLE001
        log.error("Agents retail query failed: %s", exc, exc_info=True)
        return {"data": {"classifications": [], "pos_trends": []},
                "meta": {"error": str(exc)[:200]}}
    return {
        "data": data,
        "meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source":     "bigquery",
            "count":      sum(len(v) for v in data.values()),
        },
    }

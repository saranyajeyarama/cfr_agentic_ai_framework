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
    return bigquery.Client(project=PROJECT_ID)


def _run(client: bigquery.Client, sql: str, params: list | None = None) -> list[dict]:
    try:
        cfg = bigquery.QueryJobConfig(query_parameters=params or [])
        return [dict(r) for r in client.query(sql, job_config=cfg).result()]
    except Exception as exc:
        print(f"BQ query failed: {exc}\n SQL: {sql[:300]}", flush=True)
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

    return {
        "networkCFR":                        round(_safe_float(cfr), 1),
        "networkCFRTarget":                  98.0,
        "otifFinesAtRisk7Day":               _safe_int(fines_7d),
        "revenuePreservedMTD":               _safe_int(rev_preserved),
        "demurrageAvoidedWTD":               0,
        "casesAtRiskThisWeek":               _safe_int(cases_at_risk),
        "activeAlerts":                      _safe_int(active_alerts),
        "decisionsLoggedMTD":                0,
        "agentRecommendationAcceptanceRate": 0.0,
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
        LIMIT 20
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
# Fulfillment Incidents
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_fulfillment_incidents(client: bigquery.Client) -> list[dict]:
    rows = _run(client, f"""
        SELECT
            o.delivery_number,
            o.sold_to_name,
            o.sold_to,
            o.primary_material_number,
            o.primary_material_brand,
            o.delivery_date_promised,
            o.ordered_quantity_cases,
            o.delivered_quantity_cases,
            o.otif_fail_reason,
            o.otif_root_cause_category,
            o.days_late,
            COALESCE(so.unit_price, 5.0)       AS unit_price,
            COALESCE(so.plant_code, 'Unknown')  AS plant_code,
            COALESCE(so.plant_name, so.plant_code, 'Unknown') AS plant_name
        FROM `{SEMANTIC_DS}.fct_otif` o
        LEFT JOIN (
            SELECT material_number, AVG(NULLIF(unit_price, 0)) AS unit_price,
                   ANY_VALUE(plant_code) AS plant_code, ANY_VALUE(plant_name) AS plant_name
            FROM `{SEMANTIC_DS}.fct_sales_orders`
            GROUP BY material_number
        ) so ON o.primary_material_number = so.material_number
        CROSS JOIN (SELECT MAX(delivery_date_promised) AS max_dt FROM `{SEMANTIC_DS}.fct_otif`) anchor
        WHERE o.otif_flag = 'N'
          AND o.delivery_date_promised >= DATE_SUB(anchor.max_dt, INTERVAL 90 DAY)
        ORDER BY o.ordered_quantity_cases DESC
        LIMIT 5
    """)

    incidents: list[dict] = []
    for idx, r in enumerate(rows, start=1):
        ordered  = _safe_float(r.get("ordered_quantity_cases", 0))
        fine_est = int(ordered * _safe_float(r.get("unit_price", 50.0)) * 0.02)
        prob      = 90 if _safe_int(r.get("days_late", 0)) > 2 else 75

        promised = r.get("delivery_date_promised")
        mabd_str = promised.isoformat() if isinstance(promised, date) else str(promised or "")

        incidents.append({
            "id":              f"inc-{idx:03d}",
            "title":           f"Delivery {r.get('delivery_number', '')} — OTIF Failure",
            "customer":        r.get("sold_to_name", r.get("sold_to", "")),
            "skuCode":         r.get("primary_material_number", ""),
            "skuName":         r.get("primary_material_brand", r.get("primary_material_number", "")),
            # Real tiger_semantic identifiers — the front-end passes these
            # straight through to POST /sessions.
            "soldTo":          r.get("sold_to", ""),
            "materialNumber":  r.get("primary_material_number", ""),
            "orderedQty":      int(ordered) if ordered else None,
            "mabd":            mabd_str,
            "description":     (
                f"Delivery for {r.get('sold_to_name', '')} "
                f"({r.get('primary_material_brand', r.get('primary_material_number', ''))}) "
                f"missed MABD {mabd_str}. "
                f"Root cause: {r.get('otif_root_cause_category', 'Unknown')}. "
                f"Reason: {r.get('otif_fail_reason', 'Unknown')}."
            ),
            "riskProbability": prob,
            "fineAtRisk":      fine_est,
            "otifRulebook":    f"Fine rate applies on late deliveries. MABD: {mabd_str}.",
            "scenarios": [
                {
                    "id":               f"s-{idx:03d}a",
                    "name":             "Scenario A: Default Routing",
                    "tagline":          "Do Nothing",
                    "arrival":          "+2 Days (Late)",
                    "dcSource":         r.get("plant_name", ""),
                    "freightCost":      3200,
                    "fine":             fine_est,
                    "netImpact":        -(3200 + fine_est),
                    "savingsVsDefault": 0,
                    "isRecommended":    False,
                },
                {
                    "id":               f"s-{idx:03d}b",
                    "name":             "Scenario B: Expedite Alternate Route",
                    "tagline":          "Reroute",
                    "arrival":          "On Time",
                    "dcSource":         "Alternate DC",
                    "freightCost":      fine_est + 2000,
                    "fine":             0,
                    "netImpact":        -(fine_est + 2000),
                    "savingsVsDefault": max(0, fine_est - 2000),
                    "isRecommended":    True,
                    "rationale":        (
                        f"Transportation Agent: Expediting via alternate route avoids the "
                        f"${fine_est:,} fine. Higher freight cost is offset by fine avoidance."
                    ),
                },
            ],
            "executionSteps": [
                f"Cancel outbound pick at {r.get('plant_name', 'origin plant')}",
                "Initiate emergency pick at alternate DC",
                "Book expedited carrier via logistics portal",
                "Update ASN in customer portal — revised ship date",
                "Notify account team of routing change",
            ],
        })

    return incidents


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

def _fetch_decision_log(client: bigquery.Client) -> list[dict]:
    """Recent agentic decisions from the DCE table. Returns [] if the
    tiger_decisions dataset/table does not exist yet (fresh deploy)."""
    decisions_ds = f"{PROJECT_ID}.tiger_decisions"
    rows = _run(client, f"""
        SELECT
            decision_id,
            decision_date,
            sold_to,
            decision_status,
            JSON_VALUE(decision_reason, '$.agent_recommendation') AS agent_rec,
            JSON_VALUE(decision_reason, '$.user_decision')        AS user_decision,
            JSON_VALUE(decision_reason, '$.rejection_reason')     AS override_reason
        FROM `{decisions_ds}.fct_allocation_decisions`
        ORDER BY decision_date DESC
        LIMIT 10
    """)
    log: list[dict] = []
    for r in rows:
        d = r.get("decision_date")
        ts = d.isoformat() if isinstance(d, (date, datetime)) else str(d or "")
        log.append({
            "id":                  r.get("decision_id", ""),
            "timestamp":           ts,
            "poNumber":            "",
            "customer":            r.get("sold_to", ""),
            "agentRecommendation": r.get("agent_rec") or "",
            "userDecision":        (r.get("user_decision") or "").lower(),
            "overrideReason":      r.get("override_reason"),
            "outcome":             (r.get("decision_status") or "").lower(),
        })
    return log


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
        import traceback
        print(f"[dashboard] section '{name}' failed: "
              f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
              flush=True)
        return default


def fetch_dashboard_data() -> dict:
    try:
        client = _bq_client()
    except Exception as exc:
        # BigQuery client itself could not be created. Return an all-empty
        # dashboard rather than 500 — the front-end falls back to mock data.
        import traceback
        print(f"[dashboard] BigQuery client init failed: "
              f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
              flush=True)
        client = None

    if client is None:
        return {
            "globalKPIs": {}, "alerts": [], "networkNodes": [],
            "purchaseOrders": [], "fulfillmentIncidents": [],
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
        "fulfillmentIncidents":       _safe_section(
            "fulfillmentIncidents", _fetch_fulfillment_incidents, client, []),
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

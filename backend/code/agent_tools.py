"""
Tiger Foods Customer Supply agentic AI — agent tools (v2.01).

STANDALONE. This file is the complete tool layer for the 5-agent build.
It is NOT a patch on any earlier version — it replaces adk_tools.py +
adk_tools_v2.py wholesale. There is no v1 import; everything the agents
need is in this one module.

Every tool is parameterized SQL against the REAL tiger_semantic schema
(34 views, 569 columns) as defined in the semantic-layer column
dictionary. No assumed view or column names. SKU-agnostic: every tool
takes sold_to / material_number as parameters and never hardcodes a
customer or material.

GCP project:  resilience-riskradar
Datasets:     tiger_semantic   (read-only for agents)
              tiger_decisions  (write — DCE only, orchestrator-invoked)

Agent → tool surface (defined at the bottom of this file):

  Customer Supply (synthesizer)  CUSTOMER_SUPPLY_TOOLS
  Supply Planning                SUPPLY_PLANNING_TOOLS
  Demand Planning                DEMAND_PLANNING_TOOLS
  Transportation                 TRANSPORTATION_TOOLS
  Retail Intelligence            RETAIL_INTELLIGENCE_TOOLS

Trigger adapter (CustomerOrderEvent) lives at the top: the orchestrator
only ever sees a normalized order event, never knows the transport.

---------------------------------------------------------------------------
VALIDATION STATUS: tools are schema-correct against the column dictionary.
They have NOT been executed against live data — the tiger_semantic views
must be populated first. First run is an integration test owned by the
AI/ML team. See CHANGELOG_v2_01.md.
---------------------------------------------------------------------------
"""

# NOTE: `from __future__ import annotations` is intentionally NOT used here.
# It stringizes all annotations, and google-adk 1.0.0's automatic function
# calling cannot parse stringized parameter annotations — every tool's
# declaration build would fail at agent run time. Annotations in this file
# must stay as real objects. (There are no forward references that would
# need lazy evaluation — CustomerOrderEvent is defined before every use.)

import json as _json
import os
import uuid
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Optional

from google.adk.tools import FunctionTool
from google.cloud import bigquery

# ---------------------------------------------------------------------------
# Connection constants
# ---------------------------------------------------------------------------
PROJECT_ID = os.environ.get("PROJECT_ID", "resilience-riskradar")
SEMANTIC_DS = f"{PROJECT_ID}.tiger_semantic"
DECISIONS_DS = f"{PROJECT_ID}.tiger_decisions"

# Demo anchor — see resolve_demo_scenario(). Pinned via env once chosen.
DEMO_SOLD_TO = os.environ.get("DEMO_SOLD_TO")        # e.g. "0001000245"
DEMO_MATERIAL = os.environ.get("DEMO_MATERIAL")      # e.g. "MAT-..."

_bq = bigquery.Client(project=PROJECT_ID, location="us-central1")


# Tool results are kept in the ADK session memory for the duration of the
# agent run. Without a cap, large views (forecasts, demand drivers, etc.)
# can push the container over its memory budget across all the tool calls
# a multi-agent run makes. Cap row counts globally so the agent gets
# representative context without ballooning RAM.
_ROW_CAP = int(os.environ.get("TOOL_ROW_CAP", "100"))


def _run_query(sql: str, params: list) -> list[dict]:
    """Single chokepoint to BigQuery. All read tools route through this so
    tool calls can be audited via the orchestrator's Firestore step writes.
    Returns up to _ROW_CAP rows as a list of plain dicts (dates ISO-stringified)."""
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    job = _bq.query(sql, job_config=job_config)
    rows = job.result(max_results=_ROW_CAP)
    out: list[dict] = []
    for r in rows:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        out.append(d)
        if len(out) >= _ROW_CAP:
            break
    return out


def _p(name: str, type_: str, value) -> bigquery.ScalarQueryParameter:
    """Short ScalarQueryParameter constructor."""
    return bigquery.ScalarQueryParameter(name, type_, value)


# ===========================================================================
# TRIGGER ADAPTER
# ===========================================================================
# The orchestrator entry point takes a normalized CustomerOrderEvent. It does
# NOT know or care where the order came from. Three constructors feed it:
#
#   from_demo_payload(dict)        HTTP POST body — the demo path (now)
#   resolve_demo_scenario()        data-derived demo anchor (preferred)
#   from_edi_purchase_order(id)    reads fct_edi_purchase_orders — future path
#
# A v3 trigger (pub/sub or polling fct_edi_purchase_orders for
# transaction_status='RECEIVED') would add a fourth constructor with zero
# change to any agent or tool.
# ===========================================================================
@dataclass
class CustomerOrderEvent:
    """Normalized inbound order. The single internal contract every agent
    reasons over. Field names match the real tiger_semantic schema."""
    sold_to: str
    material_number: str
    ordered_quantity_cases: float
    requested_delivery_date: str                 # ISO date
    ship_to: Optional[str] = None
    customer_po_number: Optional[str] = None
    sales_order_number: Optional[str] = None     # nullable: may not exist yet
    customer_name: Optional[str] = None
    material_description: Optional[str] = None
    trigger_source: str = "demo_payload"         # demo_payload | edi_850
    _is_placeholder: bool = False                # True if static fallback used

    def to_dict(self) -> dict:
        return asdict(self)


def from_demo_payload(payload: dict) -> CustomerOrderEvent:
    """Build a CustomerOrderEvent from an HTTP POST body (demo path).

    The payload uses real schema field names. Missing optional fields are
    tolerated. If the payload is empty OR is missing a required SAP
    identifier (sold_to / material_number) — e.g. the front-end is on
    bundled mock data with no real IDs — falls back to
    resolve_demo_scenario() and then to a clearly-marked static
    placeholder.
    """
    if (not payload
            or not payload.get("sold_to")
            or not payload.get("material_number")):
        return resolve_demo_scenario()
    return CustomerOrderEvent(
        sold_to=payload["sold_to"],
        material_number=payload["material_number"],
        ordered_quantity_cases=float(payload["ordered_quantity_cases"]),
        requested_delivery_date=payload["requested_delivery_date"],
        ship_to=payload.get("ship_to"),
        customer_po_number=payload.get("customer_po_number"),
        sales_order_number=payload.get("sales_order_number"),
        customer_name=payload.get("customer_name"),
        material_description=payload.get("material_description"),
        trigger_source="demo_payload",
    )


def from_edi_purchase_order(isa_control_id: str) -> CustomerOrderEvent:
    """Build a CustomerOrderEvent from one fct_edi_purchase_orders row
    (EDI 850). This is the FUTURE production path — written now so the
    internal contract is honest, but not on the demo path.

    Resolves the first line's material via the linked SAP sales order when
    one exists; otherwise material_number is left blank for the caller to
    resolve. The EDI 850 header carries total quantity and requested date.
    """
    params = [_p("isa", "STRING", isa_control_id)]
    sql = f"""
      SELECT isa_control_id, sold_to, sold_to_name,
             customer_po_number, sap_sales_order_number,
             total_quantity_requested_cases, requested_delivery_date,
             transaction_status
      FROM `{SEMANTIC_DS}.fct_edi_purchase_orders`
      WHERE isa_control_id = @isa
      LIMIT 1
    """
    rows = _run_query(sql, params)
    if not rows:
        raise ValueError(
            f"No fct_edi_purchase_orders row for isa_control_id={isa_control_id}")
    r = rows[0]
    return CustomerOrderEvent(
        sold_to=r["sold_to"],
        material_number="",   # header-level EDI 850; line resolution = caller
        ordered_quantity_cases=float(r.get("total_quantity_requested_cases") or 0),
        requested_delivery_date=r.get("requested_delivery_date"),
        customer_po_number=r.get("customer_po_number"),
        sales_order_number=r.get("sap_sales_order_number"),
        customer_name=r.get("sold_to_name"),
        trigger_source="edi_850",
    )


# Static fallback — used ONLY when the dataset is not yet loaded so the code
# is runnable/testable today. NOT REAL DATA. The values are structurally
# valid but the sold_to / material_number are placeholders; resolve_demo_
# scenario() replaces them the moment tiger_semantic is populated.
_STATIC_DEMO_PLACEHOLDER = CustomerOrderEvent(
    sold_to="PLACEHOLDER_SOLD_TO",
    material_number="PLACEHOLDER_MATERIAL",
    ordered_quantity_cases=1000.0,
    requested_delivery_date=(date.today()).isoformat(),
    customer_name="PLACEHOLDER — dataset not loaded",
    material_description="PLACEHOLDER — run resolve_demo_scenario()",
    trigger_source="demo_payload",
    _is_placeholder=True,
)


def get_demo_scenario_candidates(limit: int = 10) -> dict:
    """Return a shortlist of real, structurally-strong demo scenarios.

    A good demo scenario = a tier-1 (high priority) customer with an open
    sales order whose ordered quantity sits ABOVE the consensus forecast,
    on a SKU whose forward inventory projection is tight. That recreates
    the 'demand spike vs constrained supply' tension without assuming any
    specific SKU — the data selects it.

    The caller (or the data chat) eyeballs the shortlist and pins the
    chosen anchor via DEMO_SOLD_TO / DEMO_MATERIAL env vars.
    """
    params = [_p("lim", "INT64", limit)]
    sql = f"""
      WITH open_orders AS (
        SELECT so.sold_to, so.sold_to_name, so.material_number,
               so.material_description, so.material_brand,
               so.ordered_quantity_sales_uom AS ordered_qty,
               so.requested_delivery_date, so.sold_to_priority_tier,
               m.zrep_parent_material
        FROM `{SEMANTIC_DS}.fct_sales_orders` so
        JOIN `{SEMANTIC_DS}.dim_material` m
          ON so.material_number = m.material_number
        WHERE so.rejection_reason IS NULL
          AND so.sold_to_priority_tier = 1
          AND so.requested_delivery_date >= CURRENT_DATE()
      ),
      fcst AS (
        SELECT material_zrep_number, sold_to,
               SUM(consensus_quantity) AS consensus_qty
        FROM `{SEMANTIC_DS}.fct_forecast`
        GROUP BY material_zrep_number, sold_to
      ),
      proj AS (
        SELECT material_fert_number, MIN(days_of_supply) AS min_dos,
               ANY_VALUE(projection_status) AS projection_status
        FROM `{SEMANTIC_DS}.fct_inventory_projection`
        WHERE projection_week_start_date >= CURRENT_DATE()
        GROUP BY material_fert_number
      )
      SELECT o.sold_to, o.sold_to_name, o.material_number,
             o.material_description, o.material_brand,
             o.ordered_qty, o.requested_delivery_date,
             f.consensus_qty,
             SAFE_DIVIDE(o.ordered_qty - f.consensus_qty, f.consensus_qty)
               AS above_forecast_pct,
             p.min_dos AS forward_days_of_supply,
             p.projection_status
      FROM open_orders o
      LEFT JOIN fcst f
        ON o.zrep_parent_material = f.material_zrep_number
       AND o.sold_to = f.sold_to
      LEFT JOIN proj p
        ON o.material_number = p.material_fert_number
      WHERE f.consensus_qty IS NOT NULL
        AND o.ordered_qty > f.consensus_qty
      ORDER BY above_forecast_pct DESC, p.min_dos ASC
      LIMIT @lim
    """
    try:
        rows = _run_query(sql, params)
    except Exception as exc:
        return {"data_available": False,
                "candidates": [],
                "rationale": f"Demo scenario discovery failed: {exc}",
                "view_queried": ("tiger_semantic.fct_sales_orders + "
                                 "fct_forecast + fct_inventory_projection")}
    return {"data_available": bool(rows),
            "candidates": rows,
            "row_count": len(rows),
            "view_queried": ("tiger_semantic.fct_sales_orders + "
                             "fct_forecast + fct_inventory_projection")}


def resolve_demo_scenario() -> CustomerOrderEvent:
    """Return a real, data-derived CustomerOrderEvent for the demo.

    Resolution order:
      1. If DEMO_SOLD_TO + DEMO_MATERIAL env vars are pinned → load that
         exact open order from fct_sales_orders.
      2. Else → take the top candidate from get_demo_scenario_candidates().
      3. Else (dataset not loaded) → the marked static placeholder.
    """
    # 1. Pinned anchor
    if DEMO_SOLD_TO and DEMO_MATERIAL:
        params = [_p("sold_to", "STRING", DEMO_SOLD_TO),
                  _p("matnr", "STRING", DEMO_MATERIAL)]
        sql = f"""
          SELECT sold_to, sold_to_name, material_number,
                 material_description,
                 ordered_quantity_sales_uom AS ordered_qty,
                 requested_delivery_date, ship_to,
                 customer_po_number, sales_order_number
          FROM `{SEMANTIC_DS}.fct_sales_orders`
          WHERE sold_to = @sold_to AND material_number = @matnr
            AND rejection_reason IS NULL
          ORDER BY requested_delivery_date
          LIMIT 1
        """
        try:
            rows = _run_query(sql, params)
            if rows:
                r = rows[0]
                return CustomerOrderEvent(
                    sold_to=r["sold_to"],
                    material_number=r["material_number"],
                    ordered_quantity_cases=float(r["ordered_qty"]),
                    requested_delivery_date=r["requested_delivery_date"],
                    ship_to=r.get("ship_to"),
                    customer_po_number=r.get("customer_po_number"),
                    sales_order_number=r.get("sales_order_number"),
                    customer_name=r.get("sold_to_name"),
                    material_description=r.get("material_description"),
                    trigger_source="demo_payload",
                )
        except Exception:
            pass  # fall through

    # 2. Top discovered candidate
    try:
        disc = get_demo_scenario_candidates(limit=1)
        if disc.get("data_available") and disc["candidates"]:
            c = disc["candidates"][0]
            return CustomerOrderEvent(
                sold_to=c["sold_to"],
                material_number=c["material_number"],
                ordered_quantity_cases=float(c["ordered_qty"]),
                requested_delivery_date=c["requested_delivery_date"],
                customer_name=c.get("sold_to_name"),
                material_description=c.get("material_description"),
                trigger_source="demo_payload",
            )
    except Exception:
        pass  # fall through

    # 3. Static placeholder — dataset not loaded
    return _STATIC_DEMO_PLACEHOLDER


# ===========================================================================
# SALES & ORDERS  →  fct_sales_orders, fct_otif
# ===========================================================================
def get_open_sales_orders(
    sold_to: Optional[str] = None,
    material_number: Optional[str] = None,
    horizon_days: Optional[int] = None,
) -> dict:
    """Open sales orders for a customer x SKU within a forward horizon.

    'Open' = not rejected (rejection_reason IS NULL) and the requested
    delivery date is still in the forward window. fct_sales_orders has no
    status column; rejection_reason is the real signal.

    Args:
        sold_to: SAP sold-to customer number. None = all customers.
        material_number: SAP material number. None = all materials.
        horizon_days: forward window from today. Defaults to 30.
    """
    if horizon_days is None:
        horizon_days = 30
    where = ["rejection_reason IS NULL",
             "requested_delivery_date BETWEEN CURRENT_DATE() "
             "AND DATE_ADD(CURRENT_DATE(), INTERVAL @days DAY)"]
    params = [_p("days", "INT64", horizon_days)]
    if sold_to:
        where.append("sold_to = @sold_to")
        params.append(_p("sold_to", "STRING", sold_to))
    if material_number:
        where.append("material_number = @matnr")
        params.append(_p("matnr", "STRING", material_number))

    sql = f"""
      SELECT sales_order_number, sales_order_item,
             sold_to, sold_to_name, ship_to,
             material_number, material_description, material_brand,
             ordered_quantity_sales_uom, sales_uom,
             requested_delivery_date, customer_po_number,
             plant_code, line_net_value_usd
      FROM `{SEMANTIC_DS}.fct_sales_orders`
      WHERE {' AND '.join(where)}
      ORDER BY requested_delivery_date ASC
      LIMIT 100
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_sales_orders",
            "row_count": len(rows)}


def get_order_history(
    sold_to: str,
    material_number: str,
    lookback_weeks: Optional[int] = None,
) -> dict:
    """Historical weekly order pattern for a customer x SKU.
    Used by Demand Planning for above-forecast classification.
    """
    if lookback_weeks is None:
        lookback_weeks = 12
    params = [
        _p("sold_to", "STRING", sold_to),
        _p("matnr", "STRING", material_number),
        _p("weeks", "INT64", lookback_weeks),
    ]
    sql = f"""
      SELECT FORMAT_DATE('%G-W%V', order_creation_date) AS iso_week,
             SUM(ordered_quantity_sales_uom)            AS ordered_qty,
             COUNT(*)                                   AS order_lines
      FROM `{SEMANTIC_DS}.fct_sales_orders`
      WHERE sold_to = @sold_to
        AND material_number = @matnr
        AND order_creation_date >=
            DATE_SUB(CURRENT_DATE(), INTERVAL @weeks WEEK)
      GROUP BY iso_week
      ORDER BY iso_week DESC
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_sales_orders",
            "row_count": len(rows)}


def classify_order_vs_forecast(
    sold_to: str,
    material_number: str,
) -> dict:
    """Compare an ordered quantity against the consensus demand plan for the
    same customer x SKU.

    The forecast (fct_forecast) keys on material_zrep_number — the ZREP
    parent SKU — so we resolve the ordered FERT material to its ZREP parent
    via dim_material.zrep_parent_material first. Returns the consensus plan
    quantity and an above_forecast flag (>10% over plan).

    Used by Demand Planning and the Customer Supply synthesizer.
    """
    params = [
        _p("sold_to", "STRING", sold_to),
        _p("matnr", "STRING", material_number),
    ]
    sql = f"""
      WITH zrep AS (
        SELECT COALESCE(zrep_parent_material, material_number) AS zrep_id
        FROM `{SEMANTIC_DS}.dim_material`
        WHERE material_number = @matnr
        LIMIT 1
      ),
      plan AS (
        SELECT SUM(f.consensus_quantity) AS consensus_plan_qty
        FROM `{SEMANTIC_DS}.fct_forecast` f, zrep
        WHERE f.material_zrep_number = zrep.zrep_id
          AND f.sold_to = @sold_to
          AND f.forecast_week_start_date >=
              DATE_SUB(CURRENT_DATE(), INTERVAL 1 WEEK)
          AND f.forecast_week_start_date <
              DATE_ADD(CURRENT_DATE(), INTERVAL 4 WEEK)
      ),
      actual AS (
        SELECT SUM(ordered_quantity_sales_uom) AS recent_ordered_qty
        FROM `{SEMANTIC_DS}.fct_sales_orders`
        WHERE sold_to = @sold_to
          AND material_number = @matnr
          AND order_creation_date >=
              DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
      )
      SELECT
        COALESCE(plan.consensus_plan_qty, 0)   AS consensus_plan_qty,
        COALESCE(actual.recent_ordered_qty, 0) AS recent_ordered_qty,
        SAFE_DIVIDE(actual.recent_ordered_qty - plan.consensus_plan_qty,
                    plan.consensus_plan_qty)   AS above_forecast_pct,
        COALESCE(actual.recent_ordered_qty, 0) >
            COALESCE(plan.consensus_plan_qty, 0) * 1.10
                                               AS is_above_forecast
      FROM plan, actual
    """
    rows = _run_query(sql, params)
    if not rows:
        return {"error": "No plan or actual data found",
                "view_queried": ("tiger_semantic.fct_forecast + "
                                 "fct_sales_orders + dim_material")}
    r = rows[0]
    r["view_queried"] = ("tiger_semantic.fct_forecast + "
                         "fct_sales_orders + dim_material")
    return r


def get_otif_performance(
    sold_to: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    lookback_days: Optional[int] = None,
    group_by: Optional[Literal["customer", "carrier", "week"]] = None,
) -> dict:
    """OTIF performance from fct_otif, aggregated.

    fct_otif carries on_time_flag / in_full_flag / otif_flag as 'Y'/'N'
    strings, and denormalizes otif_target_pct from dim_customer onto every
    row. ship_date_actual is used as the time axis.

    Args:
        sold_to: SAP sold-to. None = all customers.
        start_date / end_date: ISO dates, inclusive. Default = current month.
        lookback_days: alternative to start_date — N days back from today.
            Overrides start_date if both are given.
        group_by: customer | carrier | week.
    """
    if group_by is None:
        group_by = "customer"
    if lookback_days is not None and lookback_days > 0:
        start_date = (date.today() - timedelta(days=int(lookback_days))).isoformat()
    where = ["ship_date_actual BETWEEN @start AND @end"]
    params = [
        _p("start", "DATE",
           start_date or date.today().replace(day=1).isoformat()),
        _p("end", "DATE", end_date or date.today().isoformat()),
    ]
    if sold_to:
        where.append("sold_to = @sold_to")
        params.append(_p("sold_to", "STRING", sold_to))

    group_col = {
        "customer": "sold_to, sold_to_name",
        "carrier":  "carrier_number, carrier_name",
        "week":     "FORMAT_DATE('%G-W%V', ship_date_actual) AS iso_week",
    }[group_by]

    sql = f"""
      SELECT {group_col},
             COUNT(*)                                      AS deliveries_total,
             COUNTIF(otif_flag = 'Y')                       AS deliveries_otif,
             SAFE_DIVIDE(COUNTIF(otif_flag = 'Y'), COUNT(*)) AS otif_rate,
             COUNTIF(on_time_flag = 'Y')                    AS deliveries_on_time,
             COUNTIF(in_full_flag = 'Y')                    AS deliveries_in_full,
             AVG(fill_rate_pct)                             AS avg_fill_rate_pct,
             AVG(otif_target_pct)                           AS otif_target_pct,
             COUNTIF(otif_fail_reason = 'LATE')             AS fails_late,
             COUNTIF(otif_fail_reason = 'SHORT')            AS fails_short
      FROM `{SEMANTIC_DS}.fct_otif`
      WHERE {' AND '.join(where)}
      GROUP BY {group_col}
      ORDER BY deliveries_total DESC
      LIMIT 100
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_otif",
            "row_count": len(rows)}


def get_active_alerts(
    sold_to: Optional[str] = None,
    lookback_days: Optional[int] = None,
    limit: Optional[int] = None,
) -> dict:
    """Recent OTIF failures ranked by financial exposure.

    Rebuilt for the real schema: fct_otif has no is_at_risk or fine-exposure
    column, so 'active alerts' = recent rows where otif_flag = 'N'. Dollar
    exposure is joined from fct_chargebacks on the delivery_number where a
    chargeback actually posted; rows with no chargeback show 0 exposure.

    Args:
        sold_to: optional customer filter.
        lookback_days: trailing window of ship dates.
        limit: max alerts.
    """
    if lookback_days is None:
        lookback_days = 14
    if limit is None:
        limit = 20
    where = ["o.otif_flag = 'N'",
             "o.ship_date_actual >= "
             "DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)"]
    params = [_p("days", "INT64", lookback_days),
              _p("lim", "INT64", limit)]
    if sold_to:
        where.append("o.sold_to = @sold_to")
        params.append(_p("sold_to", "STRING", sold_to))

    sql = f"""
      SELECT
        CONCAT('alert_', GENERATE_UUID())          AS alert_id,
        'OTIF_FAIL'                                AS alert_type,
        o.delivery_number, o.sold_to, o.sold_to_name,
        o.primary_material_number, o.primary_material_brand,
        o.otif_fail_reason, o.days_late, o.fill_rate_pct,
        o.ship_date_actual,
        COALESCE(cb.exposure_usd, 0.0)             AS financial_exposure_usd,
        CASE
          WHEN COALESCE(cb.exposure_usd, 0) >= 20000 THEN 'CRITICAL'
          WHEN COALESCE(cb.exposure_usd, 0) >= 10000 THEN 'HIGH'
          WHEN COALESCE(cb.exposure_usd, 0) >= 2500  THEN 'MEDIUM'
          ELSE 'LOW'
        END                                        AS severity
      FROM `{SEMANTIC_DS}.fct_otif` o
      LEFT JOIN (
        SELECT source_delivery_number,
               SUM(chargeback_amount_usd) AS exposure_usd
        FROM `{SEMANTIC_DS}.fct_chargebacks`
        GROUP BY source_delivery_number
      ) cb ON o.delivery_number = cb.source_delivery_number
      WHERE {' AND '.join(where)}
      ORDER BY financial_exposure_usd DESC, o.days_late DESC
      LIMIT @lim
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_otif + fct_chargebacks",
            "row_count": len(rows)}


# ===========================================================================
# INVENTORY  →  fct_inventory_projection (primary), fct_inventory_batch_snapshot
# ===========================================================================
def get_finished_goods_inventory(
    material_number: str,
    plant_code: Optional[str] = None,
    requested_delivery_date: Optional[str] = None,
) -> dict:
    """Forward available-to-promise position for a FERT SKU.

    PRIMARY source is fct_inventory_projection (OMP, weekly, forward-looking)
    — opening/ending inventory, days_of_supply, projection_status — because
    the SAP snapshot tables are only month-end (storage-loc) / quarter-end
    (batch) and are stale for an ATP decision. Returns the current and next
    few projection weeks.

    Args:
        material_number: FERT material number.
        plant_code: optional plant filter.
        requested_delivery_date: optional ISO date 'YYYY-MM-DD'. When
            provided, the projection window is anchored on this date as
            [delivery - 4 weeks, delivery + 1 week]. If omitted or invalid,
            the tool falls back to the original CURRENT_DATE() window.
    """
    # ───────── DEBUG-RDD: tool entry log ─────────
    print(f"[DEBUG-RDD][get_finished_goods_inventory] called with "
          f"material_number={material_number!r}, plant_code={plant_code!r}, "
          f"requested_delivery_date={requested_delivery_date!r}")

    # Original behavior preserved EXACTLY — runs as the default and is only
    # overridden inside the try block below if a valid delivery date arrives.
    where = ["material_fert_number = @matnr",
             "projection_week_start_date BETWEEN "
             "DATE_SUB(CURRENT_DATE(), INTERVAL 1 WEEK) "
             "AND DATE_ADD(CURRENT_DATE(), INTERVAL 4 WEEK)"]
    params = [_p("matnr", "STRING", material_number)]
    _window_strategy = "fallback_current_date"  # for debug logging

    # ───────── DEBUG-RDD: rdd-anchored window override ─────────
    if requested_delivery_date:
        try:
            from datetime import date as _date
            _date.fromisoformat(requested_delivery_date)  # validate format
            where = ["material_fert_number = @matnr",
                     "projection_week_start_date BETWEEN "
                     "DATE_SUB(DATE(@rdd), INTERVAL 4 WEEK) "
                     "AND DATE_ADD(DATE(@rdd), INTERVAL 1 WEEK)"]
            params = [_p("matnr", "STRING", material_number),
                      _p("rdd", "STRING", requested_delivery_date)]
            _window_strategy = "rdd_anchored"
            print(f"[DEBUG-RDD][get_finished_goods_inventory] using "
                  f"rdd-anchored window: [{requested_delivery_date} - 4w, "
                  f"{requested_delivery_date} + 1w]")
        except Exception as e:
            print(f"[DEBUG-RDD][get_finished_goods_inventory] rdd "
                  f"validation failed ({e!r}); falling back to "
                  f"CURRENT_DATE() window")
    else:
        print(f"[DEBUG-RDD][get_finished_goods_inventory] no rdd "
              f"provided; using CURRENT_DATE() window")

    if plant_code:
        where.append("plant_code = @plant")
        params.append(_p("plant", "STRING", plant_code))

    sql = f"""
      SELECT plan_version_id, material_fert_number,
             plant_code, storage_location,
             projection_week_start_date,
             opening_inventory_cases, production_receipts_cases,
             transfer_receipts_cases, shipments_demand_cases,
             ending_inventory_cases, days_of_supply,
             safety_stock_target_cases, projection_status
      FROM `{SEMANTIC_DS}.fct_inventory_projection`
      WHERE {' AND '.join(where)}
      ORDER BY plant_code, projection_week_start_date ASC
      LIMIT 100
    """
    try:
        rows = _run_query(sql, params)
    except Exception as e:
        # ───────── DEBUG-RDD: query failed; fall back to original ─────────
        print(f"[DEBUG-RDD][get_finished_goods_inventory] query failed "
              f"with strategy={_window_strategy}, error={e!r}; "
              f"retrying with original CURRENT_DATE() window")
        where = ["material_fert_number = @matnr",
                 "projection_week_start_date BETWEEN "
                 "DATE_SUB(CURRENT_DATE(), INTERVAL 1 WEEK) "
                 "AND DATE_ADD(CURRENT_DATE(), INTERVAL 4 WEEK)"]
        params = [_p("matnr", "STRING", material_number)]
        if plant_code:
            where.append("plant_code = @plant")
            params.append(_p("plant", "STRING", plant_code))
        sql = f"""
          SELECT plan_version_id, material_fert_number,
                 plant_code, storage_location,
                 projection_week_start_date,
                 opening_inventory_cases, production_receipts_cases,
                 transfer_receipts_cases, shipments_demand_cases,
                 ending_inventory_cases, days_of_supply,
                 safety_stock_target_cases, projection_status
          FROM `{SEMANTIC_DS}.fct_inventory_projection`
          WHERE {' AND '.join(where)}
          ORDER BY plant_code, projection_week_start_date ASC
          LIMIT 100
        """
        rows = _run_query(sql, params)
        _window_strategy = "fallback_after_error"

    # ───────── DEBUG-RDD: result log ─────────
    print(f"[DEBUG-RDD][get_finished_goods_inventory] returned "
          f"row_count={len(rows)}, strategy={_window_strategy}")

    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_inventory_projection",
            "row_count": len(rows)}


def get_safety_stock_position(
    material_number: str,
    plant_code: Optional[str] = None,
    requested_delivery_date: Optional[str] = None,
) -> dict:
    """Forward inventory vs safety-stock target, current projection week.

    Reads fct_inventory_projection: ending_inventory_cases against
    safety_stock_target_cases, with projection_status (OK / BELOW_SS /
    STOCKOUT) as the headline flag.

    Args:
        material_number: FERT material number.
        plant_code: optional plant filter.
        requested_delivery_date: optional ISO date 'YYYY-MM-DD'. When
            provided, the projection window is anchored on this date as
            [delivery - 4 weeks, delivery + 1 week]. If omitted or invalid,
            the tool falls back to projection_week_start_date >= CURRENT_DATE().
    """
    # ───────── DEBUG-RDD: tool entry log ─────────
    print(f"[DEBUG-RDD][get_safety_stock_position] called with "
          f"material_number={material_number!r}, plant_code={plant_code!r}, "
          f"requested_delivery_date={requested_delivery_date!r}")

    # Original behavior preserved EXACTLY — runs as the default and is only
    # overridden inside the try block below if a valid delivery date arrives.
    where = ["material_fert_number = @matnr",
             "projection_week_start_date >= CURRENT_DATE()"]
    params = [_p("matnr", "STRING", material_number)]
    _window_strategy = "fallback_current_date"

    # ───────── DEBUG-RDD: rdd-anchored window override ─────────
    if requested_delivery_date:
        try:
            from datetime import date as _date
            _date.fromisoformat(requested_delivery_date)
            where = ["material_fert_number = @matnr",
                     "projection_week_start_date BETWEEN "
                     "DATE_SUB(DATE(@rdd), INTERVAL 4 WEEK) "
                     "AND DATE_ADD(DATE(@rdd), INTERVAL 1 WEEK)"]
            params = [_p("matnr", "STRING", material_number),
                      _p("rdd", "STRING", requested_delivery_date)]
            _window_strategy = "rdd_anchored"
            print(f"[DEBUG-RDD][get_safety_stock_position] using "
                  f"rdd-anchored window: [{requested_delivery_date} - 4w, "
                  f"{requested_delivery_date} + 1w]")
        except Exception as e:
            print(f"[DEBUG-RDD][get_safety_stock_position] rdd "
                  f"validation failed ({e!r}); falling back to "
                  f"CURRENT_DATE() window")
    else:
        print(f"[DEBUG-RDD][get_safety_stock_position] no rdd "
              f"provided; using CURRENT_DATE() window")

    if plant_code:
        where.append("plant_code = @plant")
        params.append(_p("plant", "STRING", plant_code))

    sql = f"""
      SELECT plant_code, material_fert_number,
             projection_week_start_date,
             ending_inventory_cases, safety_stock_target_cases,
             days_of_supply, projection_status,
             ending_inventory_cases < safety_stock_target_cases
                AS below_safety_stock
      FROM `{SEMANTIC_DS}.fct_inventory_projection`
      WHERE {' AND '.join(where)}
      ORDER BY plant_code, projection_week_start_date ASC
      LIMIT 50
    """
    try:
        rows = _run_query(sql, params)
    except Exception as e:
        # ───────── DEBUG-RDD: query failed; fall back to original ─────────
        print(f"[DEBUG-RDD][get_safety_stock_position] query failed "
              f"with strategy={_window_strategy}, error={e!r}; "
              f"retrying with original CURRENT_DATE() window")
        where = ["material_fert_number = @matnr",
                 "projection_week_start_date >= CURRENT_DATE()"]
        params = [_p("matnr", "STRING", material_number)]
        if plant_code:
            where.append("plant_code = @plant")
            params.append(_p("plant", "STRING", plant_code))
        sql = f"""
          SELECT plant_code, material_fert_number,
                 projection_week_start_date,
                 ending_inventory_cases, safety_stock_target_cases,
                 days_of_supply, projection_status,
                 ending_inventory_cases < safety_stock_target_cases
                    AS below_safety_stock
          FROM `{SEMANTIC_DS}.fct_inventory_projection`
          WHERE {' AND '.join(where)}
          ORDER BY plant_code, projection_week_start_date ASC
          LIMIT 50
        """
        rows = _run_query(sql, params)
        _window_strategy = "fallback_after_error"

    # ───────── DEBUG-RDD: result log ─────────
    print(f"[DEBUG-RDD][get_safety_stock_position] returned "
          f"row_count={len(rows)}, strategy={_window_strategy}")

    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_inventory_projection",
            "row_count": len(rows)}


def get_shelf_life_risk(
    material_number: str,
    plant_code: Optional[str] = None,
) -> dict:
    """Batch-level shelf-life position for a SKU — REPORT ONLY.

    Reads fct_inventory_batch_snapshot (days_to_expiry, batch_expiry_date).
    There is NO customer MRSL (minimum remaining shelf life) requirement
    field in dim_customer, so this tool reports batch expiry as information;
    it does NOT compute a customer pass/fail. 'Customer MRSL requirement' is
    a known schema gap flagged for the data team to add to dim_customer.

    Note: fct_inventory_batch_snapshot is a QUARTER-END snapshot — treat
    days_to_expiry as directional, not real-time.

    Args:
        material_number: material number.
        plant_code: optional plant filter.
    """
    where = ["material_number = @matnr"]
    params = [_p("matnr", "STRING", material_number)]
    if plant_code:
        where.append("plant_code = @plant")
        params.append(_p("plant", "STRING", plant_code))

    sql = f"""
      SELECT material_number, plant_code, storage_location,
             batch_number, snapshot_date,
             batch_unrestricted_stock,
             batch_production_date, batch_expiry_date, days_to_expiry
      FROM `{SEMANTIC_DS}.fct_inventory_batch_snapshot`
      WHERE {' AND '.join(where)}
      ORDER BY days_to_expiry ASC
      LIMIT 100
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "report_only": True,
            "note": ("Batch expiry reported as information. No customer "
                     "MRSL requirement field exists in dim_customer — "
                     "no pass/fail computed. Snapshot is quarter-end."),
            "view_queried": "tiger_semantic.fct_inventory_batch_snapshot",
            "row_count": len(rows)}


# ===========================================================================
# SUPPLY & PRODUCTION  →  fct_production_orders, fct_bills_of_materials
# ===========================================================================
def get_production_orders(
    material_number: str,
    horizon_days: Optional[int] = None,
    status_filter: Optional[Literal["CRTD", "REL", "TECO"]] = None,
) -> dict:
    """Upcoming/recent production orders for a SKU.

    fct_production_orders.production_order_status uses SAP system statuses:
    CRTD (created), REL (released), TECO (technically complete). Quantity
    fields: item_planned_quantity (planned), actual_yield_quantity_total
    (confirmed good), with plan_adherence_pct / yield_pct / scrap_pct
    pre-derived in the view.

    Args:
        material_number: material number (matched on item_material_number).
        horizon_days: window around planned_end_date.
        status_filter: optional CRTD | REL | TECO.
    """
    if horizon_days is None:
        horizon_days = 21
    where = ["item_material_number = @matnr",
             "planned_end_date BETWEEN "
             "DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) "
             "AND DATE_ADD(CURRENT_DATE(), INTERVAL @days DAY)"]
    params = [_p("matnr", "STRING", material_number),
              _p("days", "INT64", horizon_days)]
    if status_filter:
        where.append("production_order_status = @status")
        params.append(_p("status", "STRING", status_filter))

    sql = f"""
      SELECT production_order_number, production_order_item,
             plant_code, plant_name,
             item_material_number, item_material_description, item_brand,
             production_order_status,
             planned_start_date, planned_end_date,
             actual_start_date, actual_end_date,
             item_planned_quantity, item_delivered_quantity,
             actual_yield_quantity_total, actual_scrap_quantity_total,
             plan_adherence_pct, yield_pct, scrap_pct,
             is_fully_confirmed_flag
      FROM `{SEMANTIC_DS}.fct_production_orders`
      WHERE {' AND '.join(where)}
      ORDER BY planned_end_date ASC
      LIMIT 50
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_production_orders",
            "row_count": len(rows)}


def get_raw_materials_status(
    material_number: str,
) -> dict:
    """Directional raw-material adequacy for a FERT SKU.

    Resolves the SKU's component (ROH/VERP) materials from
    fct_bills_of_materials, then checks each component's forward inventory
    projection. Many-to-many — no production-order lot linkage — so this is
    a directional signal, not a hard reservation check.
    """
    params = [_p("matnr", "STRING", material_number)]
    sql = f"""
      WITH components AS (
        SELECT DISTINCT component_material_number
        FROM `{SEMANTIC_DS}.fct_bills_of_materials`
        WHERE header_material_number = @matnr
      ),
      comp_proj AS (
        SELECT material_fert_number AS component_material_number,
               MIN(ending_inventory_cases) AS min_ending_inventory,
               MIN(days_of_supply)         AS min_days_of_supply,
               ANY_VALUE(projection_status) AS projection_status
        FROM `{SEMANTIC_DS}.fct_inventory_projection`
        WHERE projection_week_start_date BETWEEN CURRENT_DATE()
              AND DATE_ADD(CURRENT_DATE(), INTERVAL 3 WEEK)
        GROUP BY material_fert_number
      )
      SELECT c.component_material_number,
             cp.min_ending_inventory,
             cp.min_days_of_supply,
             cp.projection_status
      FROM components c
      LEFT JOIN comp_proj cp USING (component_material_number)
    """
    try:
        rows = _run_query(sql, params)
    except Exception as exc:
        return {"rows": [], "directional_concern": False,
                "rationale": f"BOM/projection lookup unavailable: {exc}",
                "view_queried": ("tiger_semantic.fct_bills_of_materials + "
                                 "fct_inventory_projection")}
    concern = any((r.get("projection_status") in ("BELOW_SS", "STOCKOUT"))
                  or (r.get("min_days_of_supply") is not None
                      and r["min_days_of_supply"] < 7)
                  for r in rows)
    return {"rows": rows,
            "directional_concern": concern,
            "rationale": ("One or more components project below safety "
                          "stock or under 7 days of supply"
                          if concern else "Component supply adequate"),
            "view_queried": ("tiger_semantic.fct_bills_of_materials + "
                             "fct_inventory_projection"),
            "row_count": len(rows)}


# ===========================================================================
# PROCUREMENT  →  fct_purchase_orders
# ===========================================================================
def get_procurement_orders(
    material_number: Optional[str] = None,
    vendor_number: Optional[str] = None,
    horizon_days: Optional[int] = None,
) -> dict:
    """Open inbound procurement POs — forward raw-material ETA visibility.

    Reads the dedicated fct_purchase_orders view (EKKO+EKPO+EKET). 'Open'
    = delivery_complete_flag is not 'X' and not deletion-flagged. ETA =
    scheduled_delivery_date; received_total_quantity vs po_quantity shows
    how much is still outstanding.

    Args:
        material_number: optional component material filter.
        vendor_number: optional vendor filter.
        horizon_days: window on scheduled_delivery_date.
    """
    if horizon_days is None:
        horizon_days = 45
    where = ["(delivery_complete_flag IS NULL OR delivery_complete_flag != 'X')",
             "(deletion_indicator IS NULL OR deletion_indicator != 'X')",
             "scheduled_delivery_date <= "
             "DATE_ADD(CURRENT_DATE(), INTERVAL @days DAY)"]
    params = [_p("days", "INT64", horizon_days)]
    if material_number:
        where.append("material_number = @matnr")
        params.append(_p("matnr", "STRING", material_number))
    if vendor_number:
        where.append("vendor_number = @vendor")
        params.append(_p("vendor", "STRING", vendor_number))

    sql = f"""
      SELECT purchase_order_number, purchase_order_item,
             vendor_number, vendor_name,
             material_number, plant_code, storage_location,
             po_quantity, po_uom, received_total_quantity,
             po_quantity - received_total_quantity AS outstanding_quantity,
             scheduled_delivery_date, statistical_delivery_date,
             delivery_complete_flag, po_line_net_value
      FROM `{SEMANTIC_DS}.fct_purchase_orders`
      WHERE {' AND '.join(where)}
      ORDER BY scheduled_delivery_date ASC
      LIMIT 50
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_purchase_orders",
            "row_count": len(rows)}


# ===========================================================================
# MASTER DATA  →  dim_customer
# ===========================================================================
def get_customer_compliance_rules(
    sold_to: str,
) -> dict:
    """Customer-specific compliance profile. Source of truth: dim_customer.

    Real fields: otif_target_pct, fill_rate_threshold_pct, the on-time
    window (days early/late), mabd_enforcement_type (FIRM/SOFT),
    priority_tier_level, otif_aggressive_flag, otif_program_name.

    There is NO chargeback fine-rate field and NO MRSL field on
    dim_customer — fine exposure comes from fct_chargebacks (see
    get_chargeback_risk); MRSL is a known gap.
    """
    params = [_p("sold_to", "STRING", sold_to)]
    sql = f"""
      SELECT customer_number, customer_name, customer_type,
             priority_tier_level, priority_tier_name, revenue_rank,
             otif_aggressive_flag, otif_target_pct,
             fill_rate_threshold_pct,
             on_time_window_days_early, on_time_window_days_late,
             mabd_enforcement_type, otif_program_name,
             strategic_notes
      FROM `{SEMANTIC_DS}.dim_customer`
      WHERE customer_number = @sold_to
      LIMIT 1
    """
    rows = _run_query(sql, params)
    if not rows:
        return {"error": f"Customer {sold_to} not found in dim_customer",
                "view_queried": "tiger_semantic.dim_customer"}
    r = rows[0]
    r["view_queried"] = "tiger_semantic.dim_customer"
    return r


# ===========================================================================
# CHARGEBACKS  →  fct_chargebacks
# ===========================================================================
def get_chargeback_risk(
    sold_to: str,
    lookback_days: Optional[int] = None,
) -> dict:
    """Customer chargeback exposure from fct_chargebacks.

    Real schema: chargeback_amount_usd, chargeback_type, charge_basis,
    chargeback_status (POSTED/DISPUTED/WRITTEN_OFF), and dispute fields
    (recovered_amount_usd). There is no per-customer fine RATE in the
    schema — exposure is measured from posted chargebacks, not a rate card.

    Args:
        sold_to: SAP sold-to customer number.
        lookback_days: trailing window on chargeback_assessed_date.
    """
    if lookback_days is None:
        lookback_days = 90
    params = [_p("sold_to", "STRING", sold_to),
              _p("days", "INT64", lookback_days)]
    sql = f"""
      WITH cb AS (
        SELECT chargeback_type, charge_basis, chargeback_status,
               chargeback_amount_usd, recovered_amount_usd,
               chargeback_root_cause_category
        FROM `{SEMANTIC_DS}.fct_chargebacks`
        WHERE sold_to = @sold_to
          AND chargeback_assessed_date >=
              DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
      )
      SELECT
        COUNT(*)                                     AS chargeback_count,
        SUM(chargeback_amount_usd)                   AS total_chargeback_usd,
        SUM(IF(chargeback_status = 'POSTED',
               chargeback_amount_usd, 0))            AS posted_usd,
        SUM(IF(chargeback_status = 'DISPUTED',
               chargeback_amount_usd, 0))            AS disputed_usd,
        SUM(COALESCE(recovered_amount_usd, 0))       AS recovered_usd,
        ARRAY(
          SELECT AS STRUCT chargeback_type AS type,
                 SUM(chargeback_amount_usd) AS amount_usd
          FROM cb GROUP BY chargeback_type
          ORDER BY amount_usd DESC LIMIT 5
        )                                            AS top_chargeback_types,
        ARRAY(
          SELECT AS STRUCT chargeback_root_cause_category AS root_cause,
                 SUM(chargeback_amount_usd) AS amount_usd
          FROM cb GROUP BY chargeback_root_cause_category
          ORDER BY amount_usd DESC LIMIT 5
        )                                            AS top_root_causes
      FROM cb
    """
    rows = _run_query(sql, params)
    r = rows[0] if rows else {}
    r["sold_to"] = sold_to
    r["view_queried"] = "tiger_semantic.fct_chargebacks"
    return r


# ===========================================================================
# LOGISTICS  →  fct_shipments, fct_otif, dim_carrier
# ===========================================================================
def get_carrier_otp(
    origin_plant: Optional[str] = None,
    destination_region: Optional[str] = None,
    trailing_days: Optional[int] = None,
) -> dict:
    """Carrier on-time performance on a lane, from fct_shipments.

    On-time is derived: actual_arrival_date <= planned_arrival_date.
    dim_carrier.on_time_performance_target_pct gives the contracted target
    to compare against. fct_shipments has origin_plant and
    destination_region for lane filtering.

    Args:
        origin_plant: optional origin plant filter.
        destination_region: optional destination region filter.
        trailing_days: window on actual_departure_date.
    """
    if trailing_days is None:
        trailing_days = 60
    where = ["s.actual_departure_date >= "
             "DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)"]
    params = [_p("days", "INT64", trailing_days)]
    if origin_plant:
        where.append("s.origin_plant = @origin")
        params.append(_p("origin", "STRING", origin_plant))
    if destination_region:
        where.append("s.destination_region = @dest")
        params.append(_p("dest", "STRING", destination_region))

    sql = f"""
      SELECT s.carrier_number, s.carrier_name, s.carrier_scac_code,
             c.on_time_performance_target_pct AS contracted_otp_target,
             COUNT(*)                          AS shipments,
             COUNTIF(s.actual_arrival_date <= s.planned_arrival_date)
                                               AS on_time_shipments,
             SAFE_DIVIDE(
               COUNTIF(s.actual_arrival_date <= s.planned_arrival_date),
               COUNT(*))                       AS trailing_otp_pct,
             AVG(s.transit_duration_hours)     AS avg_transit_hours
      FROM `{SEMANTIC_DS}.fct_shipments` s
      LEFT JOIN `{SEMANTIC_DS}.dim_carrier` c
        ON s.carrier_number = c.carrier_number
      WHERE {' AND '.join(where)}
      GROUP BY s.carrier_number, s.carrier_name, s.carrier_scac_code,
               c.on_time_performance_target_pct
      ORDER BY shipments DESC
      LIMIT 10
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_shipments + dim_carrier",
            "row_count": len(rows)}


def get_lane_transit_profile(
    origin_plant: str,
    destination_region: str,
    trailing_days: Optional[int] = None,
) -> dict:
    """Historical transit-time profile for an origin → destination lane.

    Replaces the old get_transfer_cost_comparison: the real schema has no
    freight-cost column on any shipment/delivery view, so this tool reports
    transit feasibility (duration, departure/arrival reliability) rather
    than cost. fct_shipments carries the stage durations and planned vs
    actual dates.

    Args:
        origin_plant: origin plant code.
        destination_region: destination region.
        trailing_days: trailing window on actual_departure_date.
    """
    if trailing_days is None:
        trailing_days = 90
    params = [
        _p("origin", "STRING", origin_plant),
        _p("dest", "STRING", destination_region),
        _p("days", "INT64", trailing_days),
    ]
    sql = f"""
      SELECT
        @origin AS origin_plant,
        @dest   AS destination_region,
        COUNT(*)                              AS shipment_count,
        AVG(transit_duration_hours)           AS avg_transit_hours,
        MAX(transit_duration_hours)           AS max_transit_hours,
        AVG(loading_duration_hours)           AS avg_loading_hours,
        AVG(unloading_duration_hours)         AS avg_unloading_hours,
        COUNTIF(actual_arrival_date <= planned_arrival_date)
                                              AS on_time_arrivals,
        SAFE_DIVIDE(
          COUNTIF(actual_arrival_date <= planned_arrival_date),
          COUNT(*))                           AS on_time_arrival_pct
      FROM `{SEMANTIC_DS}.fct_shipments`
      WHERE origin_plant = @origin
        AND destination_region = @dest
        AND actual_departure_date >=
            DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    """
    rows = _run_query(sql, params)
    r = rows[0] if rows else {"origin_plant": origin_plant,
                              "destination_region": destination_region,
                              "shipment_count": 0}
    r["view_queried"] = "tiger_semantic.fct_shipments"
    return r


# ===========================================================================
# RETAIL INTELLIGENCE  →  fct_demand_drivers
# ===========================================================================
# Repointed for v2.01. The four v3 retail stubs (DC inventory, store
# inventory, velocity, promo calendar) are REMOVED — retailer data is out
# of scope. Retail Intelligence now does real work against fct_demand_drivers
# (Anaplan-sourced consumer-takeaway / ACV distribution).
# ===========================================================================
def get_consumer_takeaway(
    sold_to: str,
    material_number: str,
    weeks_back: Optional[int] = None,
) -> dict:
    """Consumer-takeaway (POS-style) signal for a customer x SKU.

    Reads fct_demand_drivers (Anaplan): pos_units_consumer_takeaway,
    pos_dollars_consumer_takeaway, distribution_pct_acv, avg_retail_price,
    promo_active_flag. fct_demand_drivers keys on material_zrep_number, so
    the FERT material is resolved to its ZREP parent via dim_material.

    Used by Retail Intelligence to judge whether an order reflects genuine
    consumer pull or a buffer build (ordered qty rising while takeaway flat).

    Args:
        sold_to: SAP sold-to customer number.
        material_number: FERT material number.
        weeks_back: trailing window of demand-driver weeks.
    """
    if weeks_back is None:
        weeks_back = 8
    params = [
        _p("sold_to", "STRING", sold_to),
        _p("matnr", "STRING", material_number),
        _p("weeks", "INT64", weeks_back),
    ]
    sql = f"""
      WITH zrep AS (
        SELECT COALESCE(zrep_parent_material, material_number) AS zrep_id
        FROM `{SEMANTIC_DS}.dim_material`
        WHERE material_number = @matnr
        LIMIT 1
      )
      SELECT d.driver_week_start_date,
             d.pos_units_consumer_takeaway,
             d.pos_dollars_consumer_takeaway,
             d.distribution_pct_acv,
             d.avg_retail_price,
             d.promo_active_flag,
             d.pos_units_consumer_takeaway -
               LAG(d.pos_units_consumer_takeaway)
                 OVER (ORDER BY d.driver_week_start_date)
                                               AS wow_takeaway_change
      FROM `{SEMANTIC_DS}.fct_demand_drivers` d, zrep
      WHERE d.material_zrep_number = zrep.zrep_id
        AND d.sold_to = @sold_to
        AND d.driver_week_start_date >=
            DATE_SUB(CURRENT_DATE(), INTERVAL @weeks WEEK)
      ORDER BY d.driver_week_start_date ASC
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_demand_drivers + dim_material",
            "row_count": len(rows)}


def get_promotional_context(
    sold_to: str,
    material_number: str,
) -> dict:
    """Active/upcoming promotions for a customer x SKU.

    Reads fct_promo_plan (Anaplan): promo_type, promo_start/end_date,
    baseline_lift_pct, expected_incremental_quantity, promo_status. Keys on
    material_zrep_number — resolved from the FERT via dim_material.

    Lets Retail Intelligence and Demand Planning attribute an above-forecast
    order to a known promotional event rather than treating it as anomalous.
    """
    params = [
        _p("sold_to", "STRING", sold_to),
        _p("matnr", "STRING", material_number),
    ]
    sql = f"""
      WITH zrep AS (
        SELECT COALESCE(zrep_parent_material, material_number) AS zrep_id
        FROM `{SEMANTIC_DS}.dim_material`
        WHERE material_number = @matnr
        LIMIT 1
      )
      SELECT p.promo_id, p.promo_name, p.promo_type, p.promo_season,
             p.promo_start_date, p.promo_end_date,
             p.baseline_lift_pct, p.expected_incremental_quantity,
             p.promo_status
      FROM `{SEMANTIC_DS}.fct_promo_plan` p, zrep
      WHERE p.material_zrep_number = zrep.zrep_id
        AND p.sold_to = @sold_to
        AND p.promo_end_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
      ORDER BY p.promo_start_date ASC
      LIMIT 20
    """
    rows = _run_query(sql, params)
    return {"rows": rows,
            "view_queried": "tiger_semantic.fct_promo_plan + dim_material",
            "row_count": len(rows)}


# ===========================================================================
# DEMAND PLANNING  →  fct_forecast_accuracy
# ===========================================================================
def get_forecast_accuracy(
    sold_to: str,
    material_number: Optional[str] = None,
    lag_weeks: Optional[int] = None,
) -> dict:
    """Forecast accuracy / bias for a customer (x SKU) at a given lag.

    Reads fct_forecast_accuracy (Anaplan): wmape_pct and forecast_bias_pct
    are pre-computed in the view. Keys on material_zrep_number — resolved
    from the FERT via dim_material when a material is supplied.

    Args:
        sold_to: SAP sold-to customer number.
        material_number: optional FERT material; None = all SKUs for customer.
        lag_weeks: forecast lag to evaluate.
    """
    if lag_weeks is None:
        lag_weeks = 4
    params = [
        _p("sold_to", "STRING", sold_to),
        _p("lag", "INT64", lag_weeks),
    ]
    if material_number:
        params.append(_p("matnr", "STRING", material_number))
        zrep_cte = f"""
          WITH zrep AS (
            SELECT COALESCE(zrep_parent_material, material_number) AS zrep_id
            FROM `{SEMANTIC_DS}.dim_material`
            WHERE material_number = @matnr
            LIMIT 1
          )
        """
        zrep_filter = ("AND fa.material_zrep_number = "
                       "(SELECT zrep_id FROM zrep)")
    else:
        zrep_cte = ""
        zrep_filter = ""

    sql = f"""
      {zrep_cte}
      SELECT @sold_to AS sold_to,
             @lag     AS lag_weeks,
             AVG(fa.wmape_pct)        AS avg_wmape_pct,
             AVG(fa.forecast_bias_pct) AS avg_bias_pct,
             COUNT(*)                 AS n_observations
      FROM `{SEMANTIC_DS}.fct_forecast_accuracy` fa
      WHERE fa.sold_to = @sold_to
        AND fa.lag_weeks = @lag
        {zrep_filter}
    """
    rows = _run_query(sql, params)
    r = rows[0] if rows else {"sold_to": sold_to, "n_observations": 0}
    r["view_queried"] = "tiger_semantic.fct_forecast_accuracy"
    return r


# ===========================================================================
# ALLOCATION HISTORY  →  fct_allocation_decisions (semantic + decisions)
# ===========================================================================
def get_allocation_history(
    sold_to: Optional[str] = None,
    lookback_days: Optional[int] = None,
) -> dict:
    """Prior allocation decisions for similar contexts.

    Reads BOTH the historical tiger_semantic.fct_allocation_decisions (from
    SAP Z-tables) and this system's own tiger_decisions.fct_allocation_
    decisions. Real columns only: ordered/allocated/delivered quantity_cases,
    fill_rate_pct, decision_status (PLANNED/EXECUTED/ACTIVE), decision_reason.

    Args:
        sold_to: optional customer filter.
        lookback_days: trailing window on decision_date.
    """
    if lookback_days is None:
        lookback_days = 90
    where_sem = ["decision_date >= "
                 "DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)"]
    where_dec = ["decision_date >= "
                 "DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)"]
    params = [_p("days", "INT64", lookback_days)]
    if sold_to:
        where_sem.append("sold_to = @sold_to")
        where_dec.append("sold_to = @sold_to")
        params.append(_p("sold_to", "STRING", sold_to))

    # Historical decisions live in tiger_semantic (us-central1);
    # agentic decisions live in tiger_decisions (US multi-region).
    # Can't UNION across regions in one query, so we run two and merge.
    sql_hist = f"""
      SELECT decision_date, sold_to, priority_tier_at_decision,
             ordered_quantity_cases, allocated_quantity_cases,
             delivered_quantity_cases, fill_rate_pct,
             decision_status, decision_reason,
             'historical' AS source
      FROM `{SEMANTIC_DS}.fct_allocation_decisions`
      WHERE {' AND '.join(where_sem)}
      ORDER BY decision_date DESC
      LIMIT 50
    """
    sql_agent = f"""
      SELECT decision_date, sold_to, priority_tier_at_decision,
             ordered_quantity_cases, allocated_quantity_cases,
             delivered_quantity_cases, fill_rate_pct,
             decision_status, decision_reason,
             'agentic' AS source
      FROM `{DECISIONS_DS}.fct_allocation_decisions`
      WHERE {' AND '.join(where_dec)}
      ORDER BY decision_date DESC
      LIMIT 50
    """
    rows: list[dict] = []
    try:
        rows.extend(_run_query(sql_hist, params))
    except Exception:
        pass  # historical view may not exist
    try:
        # tiger_decisions is in the US region — use a US-located client.
        _bq_us = bigquery.Client(project=PROJECT_ID, location="US")
        cfg = bigquery.QueryJobConfig(query_parameters=params or [])
        agent_rows = [dict(r) for r in _bq_us.query(sql_agent, job_config=cfg).result()]
        rows.extend(agent_rows[:_ROW_CAP])
    except Exception:
        pass  # tiger_decisions table may not exist on a fresh deploy
    rows.sort(key=lambda r: str(r.get("decision_date", "")), reverse=True)
    rows = rows[:100]
    return {"rows": rows,
            "view_queried": ("tiger_semantic.fct_allocation_decisions + "
                             "tiger_decisions.fct_allocation_decisions"),
            "row_count": len(rows)}


# ===========================================================================
# DCE WRITE  →  tiger_decisions.fct_allocation_decisions
# ===========================================================================
# Option A (confirmed): the agent writes ONLY the real fct_allocation_
# decisions columns. Agent-specific fields (agent_recommendation,
# agent_confidence_score, user_decision, decision_aligned_with_agent,
# cdm_domains_referenced, conflicts, specialist signals) are packed as a
# JSON object into the native decision_reason column. stockout_event_id is
# nullable for agent-originated rows.
#
# If the data team later wants those agent fields as first-class columns,
# it is a clean ALTER TABLE ADD COLUMN + a one-line change here — the JSON
# approach does not paint anyone into a corner.
#
# Called by the orchestrator AFTER human approval — never bound to an
# agent's tool surface.
# ===========================================================================
def dce_write(
    session_id: str,
    decision_payload_json: str,
    user_decision: Literal["approved", "rejected", "cancelled"],
    user_id: Optional[str] = None,
    rejection_reason: Optional[str] = None,
) -> dict:
    """Write one Decision Capture Engine record into the real
    fct_allocation_decisions schema (Option A — JSON in decision_reason)."""
    decision_id = str(uuid.uuid4())
    payload = _json.loads(decision_payload_json)

    order = payload.get("order", {}) or {}
    rec = payload.get("recommendation", {}) or {}
    dce = payload.get("dce_payload", {}) or {}
    signals = payload.get("specialist_signals", {}) or {}
    conflicts = payload.get("conflicts_detected", []) or []

    cs_action = rec.get("action")
    aligned = bool(cs_action) and user_decision == "approved"

    ordered = order.get("ordered_quantity_cases")
    allocated = rec.get("fulfill_qty_cs")
    delivered = None  # populated retrospectively once the delivery posts
    shortfall = (ordered - allocated
                 if isinstance(ordered, (int, float))
                 and isinstance(allocated, (int, float)) else None)
    fill_rate = (round(100.0 * allocated / ordered, 2)
                 if isinstance(ordered, (int, float)) and ordered
                 and isinstance(allocated, (int, float)) else None)

    # Agent-specific payload packed into decision_reason as JSON (Option A).
    # `trigger` packs the original order context — fct_allocation_decisions
    # has only `sold_to`, so downstream consumers (Fulfillment Simulator)
    # JSON_VALUE the material_number / customer_name / mabd from here.
    decision_reason_obj = {
        "_dce_schema": "agent_v2_01",
        "rationale": rec.get("expected_outcome"),
        "agent_recommendation": cs_action,
        "agent_confidence_score": rec.get("confidence"),
        "user_decision": user_decision,
        "decision_aligned_with_agent": aligned,
        "rejection_reason": rejection_reason,
        "cdm_domains_referenced": dce.get("cdm_domains_referenced", []),
        "scenario_tag": dce.get("scenario_tag"),
        "conflicts_detected": [
            {"type": c.get("type"),
             "disputants": c.get("disputants"),
             "resolution": c.get("resolution")}
            for c in conflicts
        ],
        "specialist_dispositions": {
            name: {"disposition": s.get("disposition"),
                   "confidence": s.get("confidence")}
            for name, s in signals.items()
        },
        "trigger": {
            "material_number": order.get("material_number"),
            "material_description": order.get("material_description"),
            "customer_name": order.get("customer_name"),
            "requested_delivery_date": order.get("requested_delivery_date"),
            "sales_order_number": order.get("sales_order_number"),
            "trigger_source": order.get("trigger_source"),
        },
        "trigger_source": order.get("trigger_source"),
        "session_id": session_id,
        "orchestrator_version": payload.get("orchestrator_version",
                                            "v2.01.0"),
        "agent_model_versions": payload.get(
            "agent_model_versions", "gemini-2.5-pro,gemini-2.5-flash"),
    }

    rules_applied = ";".join(
        f"{c.get('type')}:{c.get('resolution')}" for c in conflicts) or None

    # Real fct_allocation_decisions columns ONLY.
    row = {
        "decision_id":              decision_id,
        "stockout_event_id":        None,   # nullable for agent-originated
        "sold_to":                  order.get("sold_to"),
        "priority_tier_at_decision": order.get("priority_tier_level"),
        "affected_orders_count":    1,
        "ordered_quantity_cases":   ordered,
        "allocated_quantity_cases": allocated,
        "allocation_pct_planned":   fill_rate,
        "delivered_quantity_cases": delivered,
        "shortfall_quantity_cases": shortfall,
        "fill_rate_pct":            fill_rate,
        "decision_date":            date.today().isoformat(),
        "rules_applied":            rules_applied,
        "decision_reason":          _json.dumps(decision_reason_obj),
        "decision_approved_by":     user_id,
        "decision_status": ("EXECUTED" if user_decision == "approved"
                            else "PLANNED"),
    }
    table_ref = f"{DECISIONS_DS}.fct_allocation_decisions"
    errors = _bq.insert_rows_json(table_ref, [row])
    if errors:
        return {"error": str(errors)}
    return {"decision_id": decision_id,
            "table": table_ref,
            "inserted_at": datetime.now(timezone.utc).isoformat(),
            "dce_schema": "agent_v2_01"}


# ===========================================================================
# FULFILLMENT SIMULATOR  →  per-plant ATP across the network + per-customer
# penalty rate. Used by the LP optimizer in fulfillment_optimizer.py.
# ===========================================================================
def get_network_inventory(material_number: str, sold_to: Optional[str] = None) -> dict:
    """Per-plant available finished-goods position across the network.

    For each plant carrying this FERT, returns the most recent forward
    projection week's ending_inventory_cases (tiger_semantic.fct_inventory_
    projection) as `available`.

    Phase 1 limitation: this does NOT subtract open commitments from
    tiger_decisions.fct_allocation_decisions yet. The decision log lives
    in a separate dataset and the cross-dataset join needs a location
    fix (BQ picks the wrong region when both are referenced). Until the
    location handling is in, `committed` is reported as 0 and `available`
    equals `ending`. This is safe for the demo (decision log is empty)
    and gives the LP correctly-bounded plant capacities; once Phase 2
    wires real commitments, only the `committed` and `available` columns
    change — the caller surface is stable.

    Args:
        material_number: FERT material number.
        sold_to: accepted but unused in Phase 1 (commits are not subtracted).

    Returns:
        {
          "rows": [{plant_code, ending, committed, available}, ...],
          "view_queried": "tiger_semantic.fct_inventory_projection",
          "row_count": int,
          "note": "commitments not subtracted in Phase 1"
        }
    """
    params = [_p("matnr", "STRING", material_number)]
    # The projection table in this demo dataset covers a future window
    # (~2026-07 → 2027-07), not necessarily anchored to today. Rather than
    # gate by a wall-clock window, take the EARLIEST available projection
    # row per plant — that's the freshest forward ATP regardless of when
    # "today" is on the container clock.
    sql = f"""
      WITH per_plant AS (
        SELECT plant_code,
               ARRAY_AGG(STRUCT(projection_week_start_date,
                                ending_inventory_cases)
                         ORDER BY projection_week_start_date ASC LIMIT 1)[OFFSET(0)] AS first_proj
        FROM `{SEMANTIC_DS}.fct_inventory_projection`
        WHERE material_fert_number = @matnr
        GROUP BY plant_code
      )
      SELECT plant_code,
             COALESCE(first_proj.ending_inventory_cases, 0) AS ending,
             CAST(0 AS FLOAT64) AS committed,
             COALESCE(first_proj.ending_inventory_cases, 0) AS available
      FROM per_plant
      WHERE COALESCE(first_proj.ending_inventory_cases, 0) > 0
      ORDER BY plant_code
    """
    rows = _run_query(sql, params)
    return {
        "rows": rows,
        "view_queried": "tiger_semantic.fct_inventory_projection",
        "row_count": len(rows),
        "note": "commitments not subtracted in Phase 1",
        "sold_to_filter_applied": False,
    }


def get_customer_penalty_profile(sold_to: str) -> dict:
    """Per-customer fine rate ($/case) for OTIF failures.

    Combines:
      - dim_customer.otif_target_pct (SLA threshold; informational)
      - fct_chargebacks (last 180 days): avg posted chargeback amount per
        late case → usable as penalty_per_case in the LP.

    Falls back to a conservative default ($25/case) if no chargeback
    history exists for this customer.

    Args:
        sold_to: SAP sold-to customer number.

    Returns:
        {
          "sold_to": ...,
          "otif_target_pct": ...,
          "avg_chargeback_per_late_case_usd": ...,
          "sample_size_chargebacks": ...,
          "penalty_per_case_usd": ...,   # the value the LP uses
          "is_fallback": bool,
          "view_queried": "tiger_semantic.dim_customer + fct_chargebacks"
        }
    """
    params = [_p("sold_to", "STRING", sold_to)]
    sql = f"""
      WITH cust AS (
        SELECT customer_number, otif_target_pct, priority_tier_name
        FROM `{SEMANTIC_DS}.dim_customer`
        WHERE customer_number = @sold_to
        LIMIT 1
      ),
      cb AS (
        SELECT AVG(NULLIF(c.chargeback_amount_usd, 0))
                 AS avg_amount_usd,
               COUNT(*) AS n
        FROM `{SEMANTIC_DS}.fct_chargebacks` c
        WHERE c.sold_to = @sold_to
          AND c.chargeback_assessed_date >=
              DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
          AND COALESCE(c.chargeback_status, '') <> 'WRITTEN_OFF'
      ),
      late_units AS (
        SELECT SUM(GREATEST(o.ordered_quantity_cases
                            - COALESCE(o.delivered_quantity_cases, 0), 0))
                 AS late_qty
        FROM `{SEMANTIC_DS}.fct_otif` o
        WHERE o.sold_to = @sold_to
          AND o.otif_flag = 'N'
          AND o.delivery_date_promised >=
              DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
      )
      SELECT cust.customer_number, cust.otif_target_pct, cust.priority_tier_name,
             cb.avg_amount_usd, cb.n AS sample_size_chargebacks,
             late_units.late_qty
      FROM cust, cb, late_units
    """
    rows = _run_query(sql, params)
    if not rows:
        return {
            "sold_to": sold_to,
            "otif_target_pct": None,
            "avg_chargeback_per_late_case_usd": None,
            "sample_size_chargebacks": 0,
            "penalty_per_case_usd": 25.0,
            "is_fallback": True,
            "view_queried": "tiger_semantic.dim_customer + fct_chargebacks",
        }
    r = rows[0]
    avg_amt = r.get("avg_amount_usd")
    n_cb = int(r.get("sample_size_chargebacks") or 0)
    late_qty = float(r.get("late_qty") or 0)
    per_case = None
    if avg_amt and late_qty > 0 and n_cb > 0:
        # Total posted chargebacks ÷ total late case-volume in the same window.
        per_case = float(avg_amt) * n_cb / late_qty
    if not per_case or per_case <= 0:
        per_case = 25.0
        is_fallback = True
    else:
        is_fallback = False
    return {
        "sold_to": sold_to,
        "otif_target_pct": r.get("otif_target_pct"),
        "priority_tier_name": r.get("priority_tier_name"),
        "avg_chargeback_per_late_case_usd": round(float(avg_amt), 2) if avg_amt else None,
        "sample_size_chargebacks": n_cb,
        "penalty_per_case_usd": round(per_case, 2),
        "is_fallback": is_fallback,
        "view_queried": "tiger_semantic.dim_customer + fct_chargebacks",
    }


# ===========================================================================
# TOOL SURFACES PER AGENT
# ===========================================================================
# invoke_specialist is exposed by the orchestrator runtime, not as a
# BigQuery tool. dce_write is NOT bound to any agent — the orchestrator
# calls it after human approval.
# ===========================================================================
import inspect as _inspect
import functools as _functools


def _tolerant(fn):
    """Wrap a tool function so unknown kwargs are dropped (not raised).
    Gemini occasionally hallucinates parameter names that look plausible
    but don't exist on the actual function — without this wrapper, those
    raise TypeError inside ADK and 500 the whole session. With it, we log
    the unknown kwarg in the return value and call the function with what
    we recognized.
    """
    sig = _inspect.signature(fn)
    accepted = set(sig.parameters.keys())
    accepts_var_kw = any(
        p.kind is _inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
    )

    @_functools.wraps(fn)
    def wrapper(**kwargs):
        if accepts_var_kw:
            return fn(**kwargs)
        recognized = {k: v for k, v in kwargs.items() if k in accepted}
        ignored = sorted(set(kwargs) - accepted)
        result = fn(**recognized) or {}
        if ignored and isinstance(result, dict):
            result.setdefault("_ignored_kwargs", ignored)
        return result

    return wrapper


def _T(fn):
    """FunctionTool wrapper that uses the kwarg-tolerant shim."""
    return FunctionTool(func=_tolerant(fn))


CUSTOMER_SUPPLY_TOOLS = [
    _T(get_open_sales_orders),
    _T(get_finished_goods_inventory),
    _T(get_customer_compliance_rules),
    _T(classify_order_vs_forecast),
    _T(get_allocation_history),
]

SUPPLY_PLANNING_TOOLS = [
    _T(get_finished_goods_inventory),
    _T(get_safety_stock_position),
    _T(get_production_orders),
    _T(get_raw_materials_status),
    _T(get_procurement_orders),
    _T(get_shelf_life_risk),
]

DEMAND_PLANNING_TOOLS = [
    _T(get_order_history),
    _T(classify_order_vs_forecast),
    _T(get_forecast_accuracy),
    _T(get_promotional_context),
]

TRANSPORTATION_TOOLS = [
    _T(get_otif_performance),
    _T(get_carrier_otp),
    _T(get_lane_transit_profile),
    _T(get_chargeback_risk),
    _T(get_active_alerts),
]

RETAIL_INTELLIGENCE_TOOLS = [
    _T(get_consumer_takeaway),
    _T(get_promotional_context),
    _T(get_order_history),
    _T(get_customer_compliance_rules),
]

# Registry — every callable tool by name (excludes dce_write by design).
ALL_TOOLS = {
    "get_open_sales_orders":        get_open_sales_orders,
    "get_order_history":            get_order_history,
    "classify_order_vs_forecast":   classify_order_vs_forecast,
    "get_otif_performance":         get_otif_performance,
    "get_active_alerts":            get_active_alerts,
    "get_finished_goods_inventory": get_finished_goods_inventory,
    "get_safety_stock_position":    get_safety_stock_position,
    "get_shelf_life_risk":          get_shelf_life_risk,
    "get_production_orders":        get_production_orders,
    "get_raw_materials_status":     get_raw_materials_status,
    "get_procurement_orders":       get_procurement_orders,
    "get_customer_compliance_rules": get_customer_compliance_rules,
    "get_chargeback_risk":          get_chargeback_risk,
    "get_carrier_otp":              get_carrier_otp,
    "get_lane_transit_profile":     get_lane_transit_profile,
    "get_consumer_takeaway":        get_consumer_takeaway,
    "get_promotional_context":      get_promotional_context,
    "get_forecast_accuracy":        get_forecast_accuracy,
    "get_allocation_history":       get_allocation_history,
    # Fulfillment Simulator (Phase 1) — used by fulfillment_optimizer.py.
    # Not bound to any agent yet; future agents can register them via _T().
    "get_network_inventory":        get_network_inventory,
    "get_customer_penalty_profile": get_customer_penalty_profile,
}





# ───────────────────────────────────────────────────────────────────────────
# Data Health — freshness of every tiger_semantic view the agents read.
#
# Queries the views themselves (not INFORMATION_SCHEMA) so that:
#   1. We measure actual business-data freshness (MAX(business_date_col)),
#      not BigQuery metadata. This catches the class of bug Dinesh fixed
#      in v2.1 — where fct_inventory_projection was last_modified=recent
#      but its data only projected forward from 2026-07-20.
#   2. We confirm views are not empty (row_count > 0). An empty view is
#      a different failure mode than a stale one.
#
# All 18 view probes are consolidated into a single UNION ALL query so
# the call costs one BigQuery job, not 18. Sub-second total.
# ───────────────────────────────────────────────────────────────────────────
_DATA_HEALTH_VIEW_CONFIG = [
    # (view_name, agent_owner, freshness_anchor, expected_lag_days,
    #  max_forward_lag_days, source_system)
    #
    # freshness_anchor = None  → dim/master data; only row_count matters
    # expected_lag_days        → how far behind today MAX(anchor) can be
    #                            before WARNING / STALE (none = future-only data)
    # max_forward_lag_days     → how far AHEAD of today MIN(anchor) can be
    #                            before MISALIGNED. None = no upper limit
    #                            (legitimately forward-looking, e.g. forecast).
    #
    # max_forward_lag_days catches the v2.1 bug class — fct_inventory_projection
    # was loaded with data starting 2026-07-20 while the agents queried
    # today ± 4 weeks, returning 0 rows. MIN(anchor) check surfaces this.
    ("dim_carrier",                  "Transportation",        None,                                 None,  None,  "SAP"),
    ("dim_customer",                 "Customer Supply",       None,                                 None,  None,  "SAP"),
    ("dim_material",                 "Supply Planning",       "material_creation_date",             365,   None,  "SAP"),
    ("fct_allocation_decisions",     "Customer Supply",       "decision_date",                       7,    7,     "Decision Log"),
    ("fct_bills_of_materials",       "Supply Planning",       "bom_valid_from_date",                 90,   None,  "SAP"),
    ("fct_chargebacks",              "Transportation",        "chargeback_assessed_date",            14,   7,     "Customer Portal"),
    ("fct_demand_drivers",           "Retail Intelligence",   "driver_week_start_date",              14,   14,    "POS / IRI"),
    ("fct_edi_purchase_orders",      "Trigger Adapter",       "transaction_date",                     2,   2,     "EDI 850 stream"),
    ("fct_forecast",                 "Demand Planning",       "forecast_week_start_date",            14,   None,  "OMP"),
    ("fct_forecast_accuracy",        "Demand Planning",       None,                                 None,  None,  "OMP / derived"),
    ("fct_inventory_batch_snapshot", "Supply Planning",       "snapshot_date",                        2,   2,     "SAP"),
    ("fct_inventory_projection",     "Supply Planning",       "projection_week_start_date",          14,   7,     "OMP"),
    ("fct_otif",                     "Transportation",        "delivery_date_actual_at_customer",    7,    7,     "Customer Portal"),
    ("fct_production_orders",        "Supply Planning",       "actual_end_date",                     7,    14,    "SAP"),
    ("fct_promo_plan",               "Demand Planning",       "promo_start_date",                    30,   None,  "TPM"),
    ("fct_purchase_orders",          "Supply Planning",       "po_document_date",                    7,    7,     "SAP"),
    ("fct_sales_orders",             "Customer Supply",       "order_creation_date",                  2,   2,     "SAP"),
    ("fct_shipments",                "Transportation",        "actual_departure_date",                3,   3,     "SAP"),
]


def get_data_health() -> dict:
    """Live freshness snapshot of every tiger_semantic view the agents
    depend on. Queries each view directly (no INFORMATION_SCHEMA lookup)
    so the answer reflects business-data freshness, not metadata.

    For each view in _DATA_HEALTH_VIEW_CONFIG, runs ONE consolidated
    UNION ALL query returning MAX(anchor), MIN(anchor), COUNT(*) per view.
    Individual view-not-found errors are caught and reported as MISSING
    status without aborting the entire route.

    Status values:
      FRESH       latest data within expected lag, no forward misalignment
      WARNING     latest data 1-2× expected lag old
      STALE       latest data >2× expected lag old
      EMPTY       view exists but contains no rows (or all NULLs)
      MISALIGNED  data exists but starts too far in the future for the
                  agent's query window (catches the v2.1 Dinesh bug class)
      MISSING     view does not exist or query failed unrecoverably
      LOADED      dim/master view has rows (no freshness anchor expected)

    Cost: one BigQuery job, ~18 partition-pruned aggregations. Sub-second.
    Service-account permission required: bigquery.dataViewer on
    tiger_semantic (same permission the existing agent tools already use —
    no new role required).
    """
    # Build ONE consolidated UNION query probing every configured view.
    # We do NOT query INFORMATION_SCHEMA — we already know which views
    # exist (they're in _DATA_HEALTH_VIEW_CONFIG). If a configured view
    # is genuinely missing from the dataset, the UNION query will fail
    # on that branch; we handle that via a fallback per-view loop below.
    parts = []
    for view, _agent, anchor, _lag, _max_fwd, _src in _DATA_HEALTH_VIEW_CONFIG:
        if anchor:
            parts.append(
                f"SELECT '{view}' AS view_name, "
                f"CAST(MAX({anchor}) AS STRING) AS max_date_iso, "
                f"CAST(MIN({anchor}) AS STRING) AS min_date_iso, "
                f"COUNT(*) AS total_rows "
                f"FROM `{SEMANTIC_DS}.{view}`")
        else:
            parts.append(
                f"SELECT '{view}' AS view_name, "
                f"CAST(NULL AS STRING) AS max_date_iso, "
                f"CAST(NULL AS STRING) AS min_date_iso, "
                f"COUNT(*) AS total_rows "
                f"FROM `{SEMANTIC_DS}.{view}`")
    union_sql = "\nUNION ALL\n".join(parts)

    by_name: dict[str, dict] = {}
    union_failed_reason: str | None = None

    try:
        probe_rows = _run_query(union_sql, params=[])
        by_name = {r.get("view_name"): r for r in probe_rows}
    except Exception as exc:
        # UNION failed — fall back to per-view probing so one missing
        # table doesn't blank out the entire health check.
        union_failed_reason = str(exc)
        for view, _agent, anchor, _lag, _max_fwd, _src in _DATA_HEALTH_VIEW_CONFIG:
            try:
                if anchor:
                    sql = (
                        f"SELECT "
                        f"CAST(MAX({anchor}) AS STRING) AS max_date_iso, "
                        f"CAST(MIN({anchor}) AS STRING) AS min_date_iso, "
                        f"COUNT(*) AS total_rows "
                        f"FROM `{SEMANTIC_DS}.{view}`")
                else:
                    sql = (
                        f"SELECT "
                        f"CAST(NULL AS STRING) AS max_date_iso, "
                        f"CAST(NULL AS STRING) AS min_date_iso, "
                        f"COUNT(*) AS total_rows "
                        f"FROM `{SEMANTIC_DS}.{view}`")
                rows = _run_query(sql, params=[])
                if rows:
                    rows[0]["view_name"] = view
                    by_name[view] = rows[0]
                # If empty result, leave absent → MISSING below
            except Exception:
                # This specific view doesn't exist or isn't readable.
                # Leave absent → MISSING in the scoring step.
                pass

    today = date.today()
    sources = []
    for view, agent, anchor, expected_lag, max_fwd, source_sys in _DATA_HEALTH_VIEW_CONFIG:
        probe = by_name.get(view)
        if not probe:
            sources.append({
                "name": view, "agent": agent, "source_system": source_sys,
                "freshness_anchor": anchor,
                "earliest_data_date": None,
                "latest_data_date": None,
                "age_days": None, "total_rows": 0,
                "expected_lag_days": expected_lag,
                "max_forward_lag_days": max_fwd,
                "status": "MISSING",
                "status_reason": (
                    f"View not found in {SEMANTIC_DS} or query failed"),
            })
            continue

        total_rows = int(probe.get("total_rows") or 0)

        if total_rows == 0:
            sources.append({
                "name": view, "agent": agent, "source_system": source_sys,
                "freshness_anchor": anchor,
                "earliest_data_date": None,
                "latest_data_date": None,
                "age_days": None, "total_rows": 0,
                "expected_lag_days": expected_lag,
                "max_forward_lag_days": max_fwd,
                "status": "EMPTY",
                "status_reason": "View exists but contains no rows",
            })
            continue

        if not anchor:
            # Dim/master table — having rows is sufficient
            sources.append({
                "name": view, "agent": agent, "source_system": source_sys,
                "freshness_anchor": None,
                "earliest_data_date": None,
                "latest_data_date": None,
                "age_days": None, "total_rows": total_rows,
                "expected_lag_days": None,
                "max_forward_lag_days": None,
                "status": "LOADED",
                "status_reason": "Reference/master data — no freshness anchor",
            })
            continue

        # Date-anchored view — score by age vs expected_lag, and check
        # for forward misalignment via MIN.
        max_date_raw = probe.get("max_date_iso")
        min_date_raw = probe.get("min_date_iso")
        if not max_date_raw:
            sources.append({
                "name": view, "agent": agent, "source_system": source_sys,
                "freshness_anchor": anchor,
                "earliest_data_date": None,
                "latest_data_date": None,
                "age_days": None, "total_rows": total_rows,
                "expected_lag_days": expected_lag,
                "max_forward_lag_days": max_fwd,
                "status": "EMPTY",
                "status_reason": f"All {anchor} values are NULL",
            })
            continue

        try:
            max_dt = date.fromisoformat(str(max_date_raw)[:10])
            min_dt = (date.fromisoformat(str(min_date_raw)[:10])
                      if min_date_raw else None)
        except Exception:
            sources.append({
                "name": view, "agent": agent, "source_system": source_sys,
                "freshness_anchor": anchor,
                "earliest_data_date": str(min_date_raw) if min_date_raw else None,
                "latest_data_date": str(max_date_raw),
                "age_days": None, "total_rows": total_rows,
                "expected_lag_days": expected_lag,
                "max_forward_lag_days": max_fwd,
                "status": "MISSING",
                "status_reason": f"Unparseable date: {max_date_raw}",
            })
            continue

        age_days = (today - max_dt).days

        # MIN-aware forward-alignment check (catches Dinesh bug class)
        if min_dt and max_fwd is not None:
            min_forward_days = (min_dt - today).days
            if min_forward_days > max_fwd:
                sources.append({
                    "name": view, "agent": agent, "source_system": source_sys,
                    "freshness_anchor": anchor,
                    "earliest_data_date": min_dt.isoformat(),
                    "latest_data_date": max_dt.isoformat(),
                    "age_days": age_days,
                    "total_rows": total_rows,
                    "expected_lag_days": expected_lag,
                    "max_forward_lag_days": max_fwd,
                    "status": "MISALIGNED",
                    "status_reason": (
                        f"Data starts {min_forward_days}d in the future — "
                        f"agents querying [today ± window] will return 0 rows. "
                        f"Earliest data should be within {max_fwd}d of today."),
                })
                continue

        if age_days < 0:
            status, reason = "FRESH", (
                f"Latest {anchor} is {-age_days}d in the future "
                f"(forward-looking data — healthy)")
        elif age_days <= expected_lag:
            status, reason = "FRESH", (
                f"Latest {anchor} is {age_days}d old "
                f"(within {expected_lag}d expected lag)")
        elif age_days <= expected_lag * 2:
            status, reason = "WARNING", (
                f"Latest {anchor} is {age_days}d old "
                f"(past {expected_lag}d expected lag)")
        else:
            status, reason = "STALE", (
                f"Latest {anchor} is {age_days}d old — "
                f"more than 2× the {expected_lag}d expected lag")

        sources.append({
            "name": view, "agent": agent, "source_system": source_sys,
            "freshness_anchor": anchor,
            "earliest_data_date": min_dt.isoformat() if min_dt else None,
            "latest_data_date": max_dt.isoformat(),
            "age_days": age_days,
            "total_rows": total_rows,
            "expected_lag_days": expected_lag,
            "max_forward_lag_days": max_fwd,
            "status": status,
            "status_reason": reason,
        })

    by_status: dict[str, int] = {}
    for s in sources:
        by_status[s["status"]] = by_status.get(s["status"], 0) + 1

    return {
        "data_available": True,
        "sources": sources,
        "summary": {
            "total": len(sources),
            "fresh": by_status.get("FRESH", 0),
            "warning": by_status.get("WARNING", 0),
            "stale": by_status.get("STALE", 0),
            "empty": by_status.get("EMPTY", 0),
            "misaligned": by_status.get("MISALIGNED", 0),
            "missing": by_status.get("MISSING", 0),
            "loaded": by_status.get("LOADED", 0),
        },
        "reference_date": today.isoformat(),
        "view_queried": f"{SEMANTIC_DS}.* (direct view probes, no metadata lookup)",
        "union_query_fallback_reason": union_failed_reason,
    }

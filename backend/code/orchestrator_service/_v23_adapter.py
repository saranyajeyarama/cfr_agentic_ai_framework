"""v2.3 Adapter — backend-shape ↔ v2.3 UI shape conversions.

The v2.3 release upgrades the front-end while preserving the v2.1 backend
contract intact. The new UI was developed standalone (in AI Studio) and
uses a slightly different field-naming convention than the v2.1 contract:

  v2.3 UI field      v2.1 backend field
  ─────────────────  ──────────────────────────────
  id                 sales_order_number
  po                 customer_po_number
  customer           sold_to_name
  sku                material_number
  desc               material_description
  qty                ordered_quantity_cases
  mabd               requested_delivery_date
  priority           sold_to_priority_tier
  flag               (DERIVED — see _derive_flag below)
  flag_type          (DERIVED — see _derive_flag below)

  fill_pct           partial_fill_pct
  qty (on rec)       fulfill_qty_cs

This module is the ONLY place that knows about these differences. It is
additive — the v2.1 contract is unchanged, the v2.1 frontend keeps
working unmodified during the parallel transition. Two new HTTP routes
(/v23/orders, /v23/triage/{order_id}) are the only callers.

Move of intent worth noting: in the v2.1 frontend, the "flag" string and
"flag_type" enum were derived client-side. In v2.3, the derivation moves
backend-side via _derive_flag(). Both UIs ultimately benefit because the
rule lives in one place.
"""
from __future__ import annotations
from typing import Any
import hashlib


# ──────────────────────────────────────────────────────────────────────────
# Synthetic ID derivation
#
# The v2.3 UI needs stable, unique order identifiers. v2.1's
# get_demo_scenario_candidates returns rows that DO NOT include
# sales_order_number or customer_po_number — those are only resolvable
# via a second query against fct_sales_orders. To keep /v23/orders fast
# (one query, not N+1), we synthesize stable IDs from (sold_to,
# material_number, requested_delivery_date). The v2.3 UI uses these for
# display; the /v23/triage/{order_id} route accepts them back along
# with the backing (sold_to, material_number) for the triage call.
#
# When the team wants REAL SO/PO numbers in v2.3, the cleanest fix is
# to add an enrichment query to /v23/orders that joins back to
# fct_sales_orders. Not done here to keep the first cut minimal.
# ──────────────────────────────────────────────────────────────────────────
def _synthetic_id(sold_to: str, material: str, delivery: str | None,
                  prefix: str = "SO") -> str:
    """Stable hash-based ID. Same inputs → same output → safe to use as a
    React key and as an opaque order identifier the v2.3 UI round-trips
    back to /v23/triage/{order_id}."""
    h = hashlib.md5(
        f"{sold_to}|{material}|{delivery or ''}".encode()).hexdigest()[:6]
    return f"{prefix}-{h.upper()}"


# ──────────────────────────────────────────────────────────────────────────
# Flag derivation — formerly client-side in v2.1 frontend
# ──────────────────────────────────────────────────────────────────────────
def _derive_flag(candidate: dict[str, Any]) -> tuple[str, str]:
    """Return (flag_message, flag_type). flag_type is one of:
       above_forecast | promo | hard_block | buffer_build | clean

    Rule order matters — the first matching rule wins.
    """
    above_pct = candidate.get("above_forecast_pct") or 0.0
    proj_status = (candidate.get("projection_status") or "").upper()
    days_of_supply = candidate.get("forward_days_of_supply")

    # Rule 1 — hard supply constraint (most severe)
    if proj_status == "STOCKOUT" or (
            days_of_supply is not None and days_of_supply < 3.0):
        ship_to = candidate.get("ship_to") or "network"
        return (f"Hard supply constraint — {ship_to}", "hard_block")

    # Rule 2 — buffer build (very large above-forecast — likely stockpile)
    if above_pct >= 1.0:  # 100%+ over plan
        pct = round(above_pct * 100)
        return (f"Buffer build? {pct + 100}% of consensus", "buffer_build")

    # Rule 3 — promo spike (moderate above-forecast with promo context)
    # NOTE: get_demo_scenario_candidates does not currently surface promo
    # context. When the candidate query is enriched to include
    # active_promo, this branch will fire. Until then, all above-forecast
    # rows fall through to Rule 4.
    if candidate.get("active_promo") and above_pct >= 0.20:
        return ("Promo spike — above weekly run rate", "promo")

    # Rule 4 — above forecast (moderate spike, no other signal)
    if above_pct >= 0.20:
        pct = round(above_pct * 100)
        return (f"{pct}% above forecast", "above_forecast")

    # Rule 5 — clean (default)
    return ("Aligned to forecast — routine reorder", "clean")


# ──────────────────────────────────────────────────────────────────────────
# Candidate → v2.3 order shape
# ──────────────────────────────────────────────────────────────────────────
def candidate_to_v23_order(candidate: dict[str, Any]) -> dict[str, Any]:
    """Convert one row from get_demo_scenario_candidates() into the v2.3
    UI ORDERS[] shape. The v2.3 UI consumes this for its order-triage
    queue.

    Returns a dict with the v2.3 UI's expected field names plus a
    `_backend` sub-dict containing the real v2.1 field names. The UI
    uses the top-level v2.3 fields for display and passes the _backend
    dict back to /v23/triage/{order_id} as the canonical resolution
    payload.
    """
    sold_to = candidate.get("sold_to", "")
    material = candidate.get("material_number", "")
    delivery = candidate.get("requested_delivery_date")
    order_id = _synthetic_id(sold_to, material, delivery, prefix="SO")
    po_id = _synthetic_id(sold_to, material, delivery, prefix="PO")
    flag, flag_type = _derive_flag(candidate)

    return {
        # ─── v2.3 UI-facing fields ───
        "id": order_id,
        "po": po_id,
        "sold_to": sold_to,
        "customer": candidate.get("sold_to_name") or sold_to,
        "sku": material,
        "desc": candidate.get("material_description") or "",
        "qty": float(candidate.get("ordered_qty") or 0),
        "mabd": delivery,
        "ship_to": candidate.get("ship_to") or "—",
        "priority": int(candidate.get("sold_to_priority_tier") or 3),
        "flag": flag,
        "flag_type": flag_type,
        # ─── Round-trip payload for /v23/triage/{id} ───
        # The v2.3 UI passes this dict back unchanged so the backend can
        # resolve to a CustomerOrderEvent without re-querying the
        # candidate shortlist.
        "_backend": {
            "sold_to": sold_to,
            "material_number": material,
            "ordered_quantity_cases": float(
                candidate.get("ordered_qty") or 0),
            "requested_delivery_date": delivery,
            "customer_name": candidate.get("sold_to_name"),
            "material_description": candidate.get("material_description"),
            "consensus_plan_qty_cases": float(
                candidate.get("consensus_qty") or 0)
                if candidate.get("consensus_qty") is not None else None,
            "above_forecast_pct": candidate.get("above_forecast_pct"),
            "forward_days_of_supply": candidate.get(
                "forward_days_of_supply"),
            "projection_status": candidate.get("projection_status"),
        },
    }


# ──────────────────────────────────────────────────────────────────────────
# Specialist signal → v2.3 signal shape
# ──────────────────────────────────────────────────────────────────────────
def _specialist_to_v23_signal(agent_key: str,
                              signal_doc: dict[str, Any]) -> dict[str, Any]:
    """Convert a v2.1 specialist signal (the dict at
    CustomerSupplyDecision.specialist_signals[agent_key]) into the v2.3
    UI's expected shape.

    v2.3 expects: { disposition, confidence, hard_block, summary,
                    evidence: [{tool, finding, point}, ...],
                    full_signal: {...} }
    """
    evidence_in = signal_doc.get("evidence") or []
    evidence_out = [
        {
            "tool": e.get("tool_called", ""),
            "finding": e.get("key_finding", ""),
            "point": e.get("data_point", ""),
        }
        for e in evidence_in
    ]
    return {
        "disposition": signal_doc.get("disposition", "CAUTION"),
        "confidence": float(signal_doc.get("confidence") or 0.0),
        "hard_block": bool(signal_doc.get("hard_block", False)),
        "summary": signal_doc.get("reasoning_summary", ""),
        "evidence": evidence_out,
        "full_signal": signal_doc.get("signal", {}) or {},
    }


# ──────────────────────────────────────────────────────────────────────────
# CustomerSupplyDecision → v2.3 SYNTHESIS shape
# ──────────────────────────────────────────────────────────────────────────
def decision_to_v23_synthesis(decision: dict[str, Any]) -> dict[str, Any]:
    """Convert a v2.1 CustomerSupplyDecision into the v2.3 UI's SYNTHESIS
    entry shape. The v2.3 UI keys SYNTHESIS by order id; the caller
    (route handler) does that wrapping.
    """
    order = decision.get("order", {}) or {}
    rec = decision.get("recommendation", {}) or {}
    chain = decision.get("reasoning_chain", {}) or {}
    escalations = decision.get("escalations", {}) or {}
    conflicts_in = decision.get("conflicts_detected") or []
    signals_in = decision.get("specialist_signals", {}) or {}

    # Specialist signals — v2.3 expects fixed 4-key dict
    signals_out = {}
    for agent_key in ("supply_planning", "demand_planning",
                      "transportation", "retail_intelligence"):
        if agent_key in signals_in:
            signals_out[agent_key] = _specialist_to_v23_signal(
                agent_key, signals_in[agent_key])

    # Conflicts — v2.3's lighter shape
    conflicts_out = [
        {
            "type": c.get("type", ""),
            "disputants": c.get("disputants", []),
            "summary": c.get("summary", ""),
            "debate_rounds": c.get("debate_rounds_used", 0),
            "resolution": c.get("resolution", "RESOLVED"),
        }
        for c in conflicts_in
    ]

    # Recommendation — v2.3 field-name mapping
    alts_in = rec.get("alternative_options") or []
    alts_out = [
        {
            "label": a.get("label", ""),
            "qty": float(a.get("fulfill_qty_cs") or 0),
            "outcome": a.get("estimated_outcome", ""),
        }
        for a in alts_in
    ]
    rec_out = {
        "action": rec.get("action", "DEFER"),
        "qty": float(rec.get("fulfill_qty_cs") or 0),
        "fill_pct": float(rec.get("partial_fill_pct") or 0),
        "confidence": float(rec.get("confidence") or 0.0),
        "outcome": rec.get("expected_outcome", ""),
        "alternatives": alts_out,
    }

    # Reasoning chain — v2.3 names
    chain_out = {
        "drivers": chain.get("which_specialists_drove_decision", []),
        "tradeoffs": chain.get("key_trade_offs", []),
        "flip": chain.get("what_would_change_the_decision", ""),
    }

    # Escalations — v2.3 expects {team_key: {summary, severity, action}}
    # Backend schema has 3 fixed keys; explicit mapping is safer than
    # the naive "to_" prefix strip because "to_transportation_manager"
    # otherwise becomes "transportation_manager_team" which the v2.3 UI
    # doesn't recognise. v2.3 UI's convention is <domain>_team.
    BACKEND_TO_V23_ESCALATION = {
        "to_transportation_manager": "transportation_team",
        "to_demand_planning_team": "demand_planning_team",
        "to_supply_planning_team": "supply_planning_team",
    }
    escalations_out: dict[str, Any] = {}
    for backend_key, v in escalations.items():
        if not v or not isinstance(v, dict):
            continue
        v23_key = BACKEND_TO_V23_ESCALATION.get(backend_key)
        if not v23_key:
            # Unknown future escalation key — pass through as-is rather
            # than silently drop. Better visible than missing.
            v23_key = backend_key.replace("to_", "")
        escalations_out[v23_key] = {
            "summary": v.get("summary", ""),
            "severity": v.get("severity", "LOW"),
            "action": v.get("recommended_action", ""),
        }

    return {
        # Order-level fields the v2.3 UI reads off SYNTHESIS[id]
        "forecast_classification": order.get("forecast_classification",
                                              "UNKNOWN"),
        "above_forecast_pct": order.get("above_forecast_pct"),
        "plan_qty": order.get("consensus_plan_qty_cases"),
        # The deep fields
        "signals": signals_out,
        "conflicts": conflicts_out,
        "rec": rec_out,
        "chain": chain_out,
        "escalations": escalations_out,
    }

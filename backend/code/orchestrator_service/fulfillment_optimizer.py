"""
Fulfillment Simulator — Phase 1 LP optimizer.

Pure-Python, deterministic, no LLM. Given an at-risk approved order and
the network's inventory + lane costs + penalty profile, solves a linear
program that decides how many cases to ship from each candidate plant,
minimizing total freight + OTIF-penalty cost. Returns two UI-shaped
scenarios (Default Route + Optimal Alternate Route) that the
FulfillmentSimulator front-end renders directly.

LP formulation (see plan file):
    Decision vars   x_p ≥ 0 per plant, s ≥ 0 (shortfall slack)
    Constraint      Σ x_p + s = D
    Constraint      x_p ≤ A_p
    Constraint      x_p = 0 ∀ p ∈ blocked
    Objective       min Σ (C_p · x_p) + K · s
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Iterable

import pulp

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Freight-cost config (loaded once at import)
# ---------------------------------------------------------------------------
_FALLBACK_USD_PER_CASE = 4.5

_DEFAULT_CONFIG_PATH = Path(__file__).parent / "config" / "freight_costs.json"


def _load_freight_config() -> dict[str, Any]:
    path = Path(os.environ.get("FREIGHT_COSTS_PATH", str(_DEFAULT_CONFIG_PATH)))
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        log.warning("freight_costs.json not found at %s — using fallback %.2f $/case",
                    path, _FALLBACK_USD_PER_CASE)
        return {"_default_usd_per_case": _FALLBACK_USD_PER_CASE, "plants": {}}
    except json.JSONDecodeError as e:
        log.error("freight_costs.json parse error: %s — using fallback", e)
        return {"_default_usd_per_case": _FALLBACK_USD_PER_CASE, "plants": {}}


_FREIGHT_CONFIG = _load_freight_config()

# Map US state abbreviations (from dim_customer.customer_region_state) to the
# region keys used in freight_costs.json.
_STATE_TO_REGION: dict[str, str] = {
    # NORTHEAST
    "CT": "NORTHEAST", "DE": "NORTHEAST", "MA": "NORTHEAST", "MD": "NORTHEAST",
    "ME": "NORTHEAST", "NH": "NORTHEAST", "NJ": "NORTHEAST", "NY": "NORTHEAST",
    "PA": "NORTHEAST", "RI": "NORTHEAST", "VT": "NORTHEAST",
    # SOUTHEAST
    "AL": "SOUTHEAST", "FL": "SOUTHEAST", "GA": "SOUTHEAST", "NC": "SOUTHEAST",
    "SC": "SOUTHEAST", "VA": "SOUTHEAST", "WV": "SOUTHEAST",
    # SOUTH
    "AR": "SOUTH", "KY": "SOUTH", "LA": "SOUTH", "MS": "SOUTH",
    "OK": "SOUTH", "TN": "SOUTH", "TX": "SOUTH",
    # MIDWEST
    "IA": "MIDWEST", "IL": "MIDWEST", "IN": "MIDWEST", "KS": "MIDWEST",
    "MI": "MIDWEST", "MN": "MIDWEST", "MO": "MIDWEST", "ND": "MIDWEST",
    "NE": "MIDWEST", "OH": "MIDWEST", "SD": "MIDWEST", "WI": "MIDWEST",
    # WEST
    "AK": "WEST", "AZ": "WEST", "CA": "WEST", "CO": "WEST", "HI": "WEST",
    "ID": "WEST", "MT": "WEST", "NM": "WEST", "NV": "WEST", "OR": "WEST",
    "UT": "WEST", "WA": "WEST", "WY": "WEST",
    # DC
    "DC": "NORTHEAST",
}


def _normalize_region(raw: str | None) -> str | None:
    """Accept either a region key ('SOUTH') or a state abbreviation ('AR') and
    return the canonical region key for freight_costs.json lookup."""
    if not raw:
        return None
    up = raw.strip().upper()
    # Already a region key?
    if up in ("NORTHEAST", "SOUTHEAST", "SOUTH", "MIDWEST", "WEST"):
        return up
    # State abbreviation?
    return _STATE_TO_REGION.get(up)


def lookup_freight_cost(origin_plant: str, customer_region: str | None) -> float:
    """plant → region → $/case, falling through to plant default, then global default."""
    plants = _FREIGHT_CONFIG.get("plants", {})
    p = plants.get(origin_plant) or plants.get((origin_plant or "").upper()) or {}
    region = _normalize_region(customer_region)
    if region:
        regions = p.get("regions") or {}
        v = regions.get(region)
        if v is not None:
            return float(v)
    if "_default" in p:
        return float(p["_default"])
    return float(_FREIGHT_CONFIG.get("_default_usd_per_case", _FALLBACK_USD_PER_CASE))


# ---------------------------------------------------------------------------
# Pure LP — no I/O
# ---------------------------------------------------------------------------
def _solve_lp(
    *,
    ordered_qty: float,
    available_by_plant: dict[str, float],
    freight_by_plant: dict[str, float],
    penalty_per_case: float,
    blocked_plants: Iterable[str] = (),
    fix_zero: str | None = None,
) -> dict[str, Any]:
    """Solve the LP and return {status, shipped: {plant: qty}, shortfall,
    freight_cost, penalty_cost, total_cost}. `fix_zero` (if provided)
    forces x[fix_zero] = 0 — used to obtain a next-best alternate when
    the unconstrained optimum is the origin plant itself."""
    blocked = set(blocked_plants or ())
    if fix_zero:
        blocked = blocked | {fix_zero}

    plants = [p for p in available_by_plant if available_by_plant.get(p, 0) > 0]
    prob = pulp.LpProblem("fulfillment_lp", pulp.LpMinimize)

    x = {p: pulp.LpVariable(f"x_{p}", lowBound=0) for p in plants}
    s = pulp.LpVariable("shortfall", lowBound=0)

    # Demand satisfaction (with slack)
    prob += pulp.lpSum(x.values()) + s == float(ordered_qty), "demand"

    # Per-plant capacity
    for p in plants:
        prob += x[p] <= float(available_by_plant[p]), f"cap_{p}"
        if p in blocked:
            prob += x[p] == 0, f"blk_{p}"

    # Objective
    prob += (
        pulp.lpSum(freight_by_plant.get(p, _FALLBACK_USD_PER_CASE) * x[p] for p in plants)
        + float(penalty_per_case) * s
    )

    solver = pulp.PULP_CBC_CMD(msg=False)
    prob.solve(solver)

    log.debug("LP status=%s ordered_qty=%s", pulp.LpStatus[prob.status], ordered_qty)
    if pulp.LpStatus[prob.status] != "Optimal":
        log.warning("LP non-optimal status=%s ordered_qty=%s",
                    pulp.LpStatus[prob.status], ordered_qty)

    status = pulp.LpStatus[prob.status]
    if status != "Optimal":
        return {"status": status, "shipped": {}, "shortfall": float(ordered_qty),
                "freight_cost": 0.0, "penalty_cost": float(ordered_qty) * float(penalty_per_case),
                "total_cost": float(ordered_qty) * float(penalty_per_case)}

    shipped = {p: round(float(x[p].value() or 0), 2) for p in plants if (x[p].value() or 0) > 1e-6}
    shortfall = round(float(s.value() or 0), 2)
    freight_cost = round(
        sum(freight_by_plant.get(p, _FALLBACK_USD_PER_CASE) * qty for p, qty in shipped.items()),
        2,
    )
    penalty_cost = round(shortfall * float(penalty_per_case), 2)
    return {
        "status": status,
        "shipped": shipped,
        "shortfall": shortfall,
        "freight_cost": freight_cost,
        "penalty_cost": penalty_cost,
        "total_cost": round(freight_cost + penalty_cost, 2),
    }


# ---------------------------------------------------------------------------
# UI-shaped scenario builders
# ---------------------------------------------------------------------------
def _format_plant_label(code: str, meta: dict[str, Any] | None) -> str:
    """E.g. 'US01 (Houston Mfg)' or just 'DC02' when no metadata."""
    if not meta:
        return code
    name = meta.get("name") or ""
    city = meta.get("city") or ""
    ptype = meta.get("type") or ""
    short_type = {"Manufacturing": "Mfg", "DC": "DC", "Distribution Center": "DC"}.get(ptype, "")
    if city and short_type:
        return f"{code} ({city} {short_type})"
    if city:
        return f"{code} ({city})"
    if name:
        return f"{code} ({name})"
    return code


def _plant_detail_list(shipped: dict[str, float], plant_meta: dict[str, dict]) -> list[dict]:
    """Build the plantDetails array for the scenario response."""
    details = []
    for p, qty in sorted(shipped.items()):
        m = plant_meta.get(p, {})
        details.append({
            "code": p,
            "name": m.get("name", ""),
            "city": m.get("city", ""),
            "type": m.get("type", ""),
            "qty": qty,
            "transitHours": m.get("avg_transit_hours"),
            "carrier": m.get("primary_carrier"),
        })
    return details


def _scenario_default(
    *,
    origin_plant: str,
    ordered_qty: float,
    available_by_plant: dict[str, float],
    freight_by_plant: dict[str, float],
    penalty_per_case: float,
    plant_meta: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Scenario A: ship as much as possible from the origin plant, accept
    OTIF penalty on whatever shortfall remains. Never split, never reroute."""
    pm = plant_meta or {}
    avail_origin = float(available_by_plant.get(origin_plant, 0))
    shipped = min(float(ordered_qty), avail_origin)
    shortfall = max(0.0, float(ordered_qty) - shipped)
    freight = round(shipped * freight_by_plant.get(origin_plant, _FALLBACK_USD_PER_CASE), 2)
    fine = round(shortfall * float(penalty_per_case), 2)
    net_impact = -round(freight + fine, 2)

    # Transit time from fct_shipments for the origin plant. Manufacturing
    # plants often lack direct shipment data — fall back to the first DC
    # in plant_meta that has transit info.
    origin_meta = pm.get(origin_plant, {})
    transit_hours = origin_meta.get("avg_transit_hours")
    carrier = origin_meta.get("primary_carrier")
    if not transit_hours:
        for p_code, p_meta in pm.items():
            if p_meta.get("avg_transit_hours"):
                transit_hours = p_meta["avg_transit_hours"]
                carrier = carrier or p_meta.get("primary_carrier")
                break

    if shortfall == 0 and transit_hours:
        arrival = f"On Time (~{int(transit_hours)}h transit)"
    elif shortfall == 0:
        arrival = "On Time"
    else:
        arrival = f"{int(shortfall)} cs short"

    origin_label = _format_plant_label(origin_plant, origin_meta)
    shipped_dict = {origin_plant: shipped} if shipped > 0 else {}

    return {
        "id": "scenario-a-default",
        "name": "Scenario A: Default Route",
        "tagline": "Do Nothing",
        "arrival": arrival,
        "dcSource": origin_label,
        "freightCost": freight,
        "fine": fine,
        "netImpact": net_impact,
        "savingsVsDefault": 0,
        "isRecommended": False,
        "rationale": (
            f"Ship from origin {origin_label}. "
            f"{'Order fully covered.' if shortfall == 0 else f'Origin can only cover {int(shipped)} of {int(ordered_qty)} cases; the remaining {int(shortfall)} incur an OTIF penalty.'}"
            + (f" Est. transit: ~{int(transit_hours)}h via {carrier}." if transit_hours and carrier else "")
        ),
        "transitHours": round(transit_hours, 1) if transit_hours else None,
        "carrierName": carrier,
        "plantDetails": _plant_detail_list(shipped_dict, pm),
    }


def _scenario_optimal(
    *,
    origin_plant: str,
    ordered_qty: float,
    available_by_plant: dict[str, float],
    freight_by_plant: dict[str, float],
    penalty_per_case: float,
    blocked_plants: Iterable[str] = (),
    default_net_impact: float = 0.0,
    plant_meta: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Scenario B: LP-optimal route. May split across plants. If the
    unconstrained LP picks origin only (Scenario B would equal A), re-solve
    with x[origin] = 0 to surface a meaningful next-best alternate.
    Returns None if no alternate is feasible."""
    pm = plant_meta or {}
    sol = _solve_lp(
        ordered_qty=ordered_qty,
        available_by_plant=available_by_plant,
        freight_by_plant=freight_by_plant,
        penalty_per_case=penalty_per_case,
        blocked_plants=blocked_plants,
    )
    # If LP's optimum routes everything through origin, force an alternate.
    only_origin = (set(sol["shipped"]) == {origin_plant}) or not sol["shipped"]
    if only_origin:
        if not (origin_plant and origin_plant in available_by_plant):
            return None
        alt = _solve_lp(
            ordered_qty=ordered_qty,
            available_by_plant=available_by_plant,
            freight_by_plant=freight_by_plant,
            penalty_per_case=penalty_per_case,
            blocked_plants=blocked_plants,
            fix_zero=origin_plant,
        )
        if alt["status"] != "Optimal" or not alt["shipped"]:
            return None
        sol = alt

    if sol["status"] != "Optimal" or not sol["shipped"]:
        return None

    shipped = sol["shipped"]
    shortfall = sol["shortfall"]
    plants_used = sorted(shipped.keys())

    # Build human-readable dc_source with plant names from dim_plant.
    dc_labels = [_format_plant_label(p, pm.get(p)) for p in plants_used]
    dc_source = " + ".join(dc_labels) if len(dc_labels) <= 3 else f"{len(dc_labels)} plants"

    # Transit time: use the max across all sourcing plants (bottleneck).
    transit_hours_list = [
        pm.get(p, {}).get("avg_transit_hours")
        for p in plants_used if pm.get(p, {}).get("avg_transit_hours")
    ]
    transit_hours = max(transit_hours_list) if transit_hours_list else None
    # Primary carrier: prefer the plant with carrier data that ships the most.
    # Manufacturing plants typically don't have direct shipment/carrier data.
    plants_with_carrier = [
        p for p in plants_used if pm.get(p, {}).get("primary_carrier")
    ]
    if plants_with_carrier:
        top_carrier_plant = max(plants_with_carrier, key=lambda p: shipped.get(p, 0))
        carrier = pm[top_carrier_plant]["primary_carrier"]
    else:
        carrier = None

    if shortfall == 0 and transit_hours:
        arrival = f"On Time (~{int(transit_hours)}h transit)"
    elif shortfall == 0:
        arrival = "On Time"
    else:
        arrival = f"{int(shortfall)} cs short"

    freight = sol["freight_cost"]
    fine = sol["penalty_cost"]
    net_impact = -round(freight + fine, 2)
    savings = round(net_impact - default_net_impact, 2)
    is_recommended = savings > 0
    if savings < 0:
        savings = 0

    parts = ", ".join(
        f"{int(q)} cs from {_format_plant_label(p, pm.get(p))}"
        for p, q in shipped.items()
    )
    if is_recommended:
        default_freight = -default_net_impact
        freight_diff = round(default_freight - freight, 2)
        if fine == 0 and freight_diff > 0:
            reason = f"reducing freight by ${int(freight_diff):,} via regional DCs closer to the customer"
        elif fine == 0:
            reason = f"optimizing freight across multiple sourcing nodes"
        else:
            reason = f"{'avoiding' if fine == 0 else 'reducing'} the OTIF penalty"
        rationale = (
            f"Ships {parts}. "
            f"Saves ${int(savings):,} vs Default by {reason}. "
            f"Total freight: ${int(freight):,}."
        )
    else:
        rationale = (
            f"Alternate route: ships {parts}. "
            f"Costs more than Default — use only if origin plant is unavailable."
        )
    if transit_hours and carrier:
        rationale += f" Est. transit: ~{int(transit_hours)}h via {carrier}."

    return {
        "id": "scenario-b-optimal",
        "name": "Scenario B: Optimal Alternate Route",
        "tagline": "LP Optimized" if is_recommended else "Alternate (if origin unavailable)",
        "arrival": arrival,
        "dcSource": dc_source,
        "freightCost": freight,
        "fine": fine,
        "netImpact": net_impact,
        "savingsVsDefault": savings,
        "isRecommended": is_recommended,
        "rationale": rationale,
        "transitHours": round(transit_hours, 1) if transit_hours else None,
        "carrierName": carrier,
        "plantDetails": _plant_detail_list(shipped, pm),
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def simulate(
    *,
    ordered_qty: float,
    origin_plant: str,
    customer_region: str | None,
    available_by_plant: dict[str, float],
    penalty_per_case: float,
    blocked_plants: Iterable[str] = (),
    plant_meta: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the two UI scenario cards for one at-risk order.

    Parameters:
      plant_meta — optional dict of {plant_code: {name, city, type,
        avg_transit_hours, primary_carrier}} from dim_plant + fct_shipments.
        When supplied the scenario cards include transit times, carrier
        names, and human-readable plant labels.

    Returns:
      {
        "scenarios":  [scenario_default, (scenario_optimal if found)],
        "meta": { ... }
      }
    """
    pm = plant_meta or {}
    _t0_sim = time.monotonic()
    log.info("LP solve start ordered_qty=%s origin=%s region=%s plants=%s",
             ordered_qty, origin_plant, customer_region,
             list(available_by_plant.keys()))
    t0 = time.time()
    freight_by_plant = {
        p: lookup_freight_cost(p, customer_region) for p in available_by_plant
    }
    default = _scenario_default(
        origin_plant=origin_plant,
        ordered_qty=ordered_qty,
        available_by_plant=available_by_plant,
        freight_by_plant=freight_by_plant,
        penalty_per_case=penalty_per_case,
        plant_meta=pm,
    )
    optimal = _scenario_optimal(
        origin_plant=origin_plant,
        ordered_qty=ordered_qty,
        available_by_plant=available_by_plant,
        freight_by_plant=freight_by_plant,
        penalty_per_case=penalty_per_case,
        blocked_plants=blocked_plants,
        default_net_impact=default["netImpact"],
        plant_meta=pm,
    )

    scenarios = [default]
    no_alternate_reason: str | None = None
    if optimal:
        scenarios.append(optimal)
    else:
        no_alternate_reason = (
            "No alternate plant has sufficient inventory or undercuts the "
            "OTIF penalty cost — origin plant remains optimal."
        )

    elapsed_ms = int((time.time() - t0) * 1000)
    _elapsed_ms = int((time.monotonic() - _t0_sim) * 1000)
    log.info("LP solve complete elapsed_ms=%d scenarios=%d no_alternate=%s",
             _elapsed_ms, len(scenarios), bool(no_alternate_reason))
    return {
        "scenarios": scenarios,
        "meta": {
            "solver_status": "Optimal",
            "elapsed_ms": elapsed_ms,
            "no_alternate_reason": no_alternate_reason,
            "freight_costs_used": freight_by_plant,
            "penalty_per_case": float(penalty_per_case),
            "ordered_qty": float(ordered_qty),
            "origin_plant": origin_plant,
            "customer_region": customer_region,
        },
    }

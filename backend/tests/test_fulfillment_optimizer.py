"""
Pure-function tests for the Phase 1 fulfillment LP.

No BigQuery, no Firestore, no LLM — exercises only fulfillment_optimizer.py.

Run inside the backend container after copy-in:
    docker cp .../backend/tests/test_fulfillment_optimizer.py <ctr>:/app/
    docker exec <ctr> python /app/test_fulfillment_optimizer.py
"""
from __future__ import annotations

import sys
import traceback

sys.path.insert(0, "/app")

from fulfillment_optimizer import simulate, _solve_lp  # noqa: E402


# ─── tiny harness ───────────────────────────────────────────────────────────
_results: list[tuple[str, bool, str]] = []


def case(name):
    def deco(fn):
        try:
            fn()
            _results.append((name, True, ""))
        except AssertionError as e:
            _results.append((name, False, f"AssertionError: {e}"))
        except Exception:  # noqa: BLE001
            _results.append((name, False, traceback.format_exc()))
        return fn
    return deco


# ─── scenarios ──────────────────────────────────────────────────────────────

@case("origin fully covers demand → optimum is origin, alternate forced from non-origin")
def _():
    out = simulate(
        ordered_qty=100,
        origin_plant="P1",
        customer_region="WEST",
        available_by_plant={"P1": 200, "P2": 200, "P3": 200},
        penalty_per_case=20.0,
    )
    scenarios = out["scenarios"]
    assert len(scenarios) == 2, scenarios
    a, b = scenarios
    assert a["isRecommended"] is False
    assert a["dcSource"] == "P1"
    assert a["fine"] == 0  # origin had enough inventory
    assert b["isRecommended"] is True
    # Optimal must use at least one non-origin plant (since LP optimum
    # would have been P1; we force x[P1]=0 to surface a meaningful alt).
    assert "P1" not in b["dcSource"], b
    assert out["meta"]["solver_status"] == "Optimal"


@case("origin short-on-inventory → optimal splits or routes to cheaper plant")
def _():
    out = simulate(
        ordered_qty=100,
        origin_plant="P1",
        customer_region="WEST",
        # Origin has only 30; LP must source 70 elsewhere.
        available_by_plant={"P1": 30, "P2": 100, "P3": 100},
        penalty_per_case=50.0,  # high enough to make routing cheaper than penalty
    )
    a, b = out["scenarios"]
    assert a["fine"] > 0, "Default scenario must show a penalty for the shortfall"
    assert b["isRecommended"], b
    assert b["fine"] == 0, "Optimal should cover the order fully when inventory exists"
    assert b["netImpact"] >= a["netImpact"], "Optimal must not be worse than Default"


@case("all alternates blocked → only Scenario A returned, no_alternate_reason set")
def _():
    out = simulate(
        ordered_qty=100,
        origin_plant="P1",
        customer_region="WEST",
        available_by_plant={"P1": 200, "P2": 200},
        penalty_per_case=20.0,
        blocked_plants=["P2"],  # only the alternate is blocked
    )
    # With P2 blocked and P1 sufficient, the forced-alternate retry must
    # fail (origin is the only feasible plant), so length=1.
    assert len(out["scenarios"]) == 1, out["scenarios"]
    assert out["scenarios"][0]["isRecommended"] is False
    assert out["meta"]["no_alternate_reason"], out["meta"]


@case("zero ordered qty → trivial 0-cost solution, no shortfall, no alternate")
def _():
    out = simulate(
        ordered_qty=0,
        origin_plant="P1",
        customer_region="WEST",
        available_by_plant={"P1": 50, "P2": 50},
        penalty_per_case=20.0,
    )
    a = out["scenarios"][0]
    assert a["freightCost"] == 0
    assert a["fine"] == 0
    assert a["netImpact"] == 0


@case("zero inventory everywhere → all shortfall in default, no feasible alternate")
def _():
    out = simulate(
        ordered_qty=100,
        origin_plant="P1",
        customer_region="WEST",
        available_by_plant={"P1": 0, "P2": 0},
        penalty_per_case=10.0,
    )
    a = out["scenarios"][0]
    assert a["fine"] > 0, a
    # No alternate inventory either → scenarios length 1
    assert len(out["scenarios"]) == 1, out["scenarios"]


@case("LP solver agrees with manual cost calc on a small problem")
def _():
    res = _solve_lp(
        ordered_qty=100,
        available_by_plant={"P1": 30, "P2": 100},
        freight_by_plant={"P1": 2.0, "P2": 5.0},
        penalty_per_case=50.0,
    )
    # Optimal: ship 30 from P1 ($60), 70 from P2 ($350) → $410, no shortfall.
    assert res["status"] == "Optimal"
    assert res["shortfall"] == 0
    assert abs(res["total_cost"] - 410.0) < 1e-2, res
    assert res["shipped"].get("P1") == 30
    assert res["shipped"].get("P2") == 70


# ─── runner ─────────────────────────────────────────────────────────────────
def main():
    passed = sum(1 for _, ok, _ in _results if ok)
    failed = len(_results) - passed
    for name, ok, msg in _results:
        marker = "PASS" if ok else "FAIL"
        print(f"[{marker}] {name}")
        if not ok:
            for line in msg.splitlines():
                print(f"        {line}")
    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

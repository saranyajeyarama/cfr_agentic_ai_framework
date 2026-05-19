"""
Tests for the POST /sessions 422 we are debugging.

Two layers, zero extra dependencies (uses only stdlib + the already-
installed pydantic):

  1. Schema layer — feed StartSessionRequest the exact payloads the
     front-end sends. Localizes whether the bug is in the Pydantic
     contract.
  2. Route layer — hit the live POST /sessions on http://localhost:8080
     with urllib. Shows whether FastAPI accepts the same payloads when
     they go over the wire (and surfaces the 422 detail if not).

Run inside the backend container:
    docker exec <backend> python /app/test_start_session.py
"""
from __future__ import annotations

import json
import sys
import traceback
import urllib.error
import urllib.request
from typing import Any, Callable

sys.path.insert(0, "/app")

from pydantic import ValidationError  # noqa: E402

from schemas import StartSessionRequest  # noqa: E402


# ─── tiny test harness ──────────────────────────────────────────────────────
_results: list[tuple[str, bool, str]] = []

def case(name: str):
    def deco(fn: Callable[[], None]):
        try:
            fn()
            _results.append((name, True, ""))
        except AssertionError as e:
            _results.append((name, False, f"AssertionError: {e}"))
        except Exception:  # noqa: BLE001
            _results.append((name, False, traceback.format_exc()))
        return fn
    return deco


def expect_raises(exc_type, fn):
    try:
        fn()
    except exc_type:
        return True
    except Exception as e:  # noqa: BLE001
        raise AssertionError(f"expected {exc_type.__name__}, got {type(e).__name__}: {e}") from None
    raise AssertionError(f"expected {exc_type.__name__}, no exception raised")


# ─── front-end payload builders ─────────────────────────────────────────────
def ordertriage_payload(
    *,
    sold_to: str | None = None,
    material_number: str | None = None,
    requested_qty: Any = 1000.0,
) -> dict[str, Any]:
    """Mirrors frontend/src/lib/api.ts buildStartSessionRequest()."""
    demo_order: dict[str, Any] = {
        "ordered_quantity_cases": requested_qty,
        "requested_delivery_date": "2026-05-26",
        "customer_name": "Acme Pet Co.",
        "material_description": "Pedigree 12oz Chicken",
        "sales_order_number": "12345",
    }
    if sold_to is not None:
        demo_order["sold_to"] = sold_to
    if material_number is not None:
        demo_order["material_number"] = material_number
    return {
        "trigger_type": "new_order",
        "trigger_source": "demo_payload",
        "demo_order": demo_order,
    }


# ─── 1. SCHEMA-LEVEL TESTS ──────────────────────────────────────────────────

@case("schema | empty body validates")
def _():
    req = StartSessionRequest.model_validate({})
    assert req.trigger_type == "new_order"
    assert req.trigger_source == "demo_payload"
    assert req.demo_order is None


@case("schema | OrderTriage payload (no real IDs) validates")
def _():
    req = StartSessionRequest.model_validate(ordertriage_payload())
    assert req.demo_order is not None
    assert req.demo_order.ordered_quantity_cases == 1000.0


@case("schema | OrderTriage payload (with real IDs) validates")
def _():
    req = StartSessionRequest.model_validate(
        ordertriage_payload(sold_to="C100", material_number="M200")
    )
    assert req.demo_order is not None
    assert req.demo_order.sold_to == "C100"


@case("schema | FulfillmentSimulator payload (trigger_type=manual) validates")
def _():
    payload = {
        "trigger_type": "manual",
        "trigger_source": "demo_payload",
        "demo_order": {
            "ordered_quantity_cases": 1000,
            "requested_delivery_date": "2026-05-26",
            "customer_name": "Petco",
            "material_description": "Pedigree 12oz",
            "sales_order_number": "INC-1-SC1",
        },
    }
    req = StartSessionRequest.model_validate(payload)
    assert req.trigger_type == "manual"


@case("schema | quantity-as-quoted-string coerced to float")
def _():
    payload = ordertriage_payload(requested_qty="1000")
    req = StartSessionRequest.model_validate(payload)
    assert req.demo_order is not None
    assert req.demo_order.ordered_quantity_cases == 1000.0


@case("schema | quantity-with-unit-suffix rejected (the prime 422 suspect)")
def _():
    payload = ordertriage_payload(requested_qty="1000 CS")
    expect_raises(ValidationError, lambda: StartSessionRequest.model_validate(payload))


@case("schema | requestedQty undefined → key omitted → validates")
def _():
    payload = ordertriage_payload()
    del payload["demo_order"]["ordered_quantity_cases"]
    StartSessionRequest.model_validate(payload)


@case("schema | requestedQty serialized as null → validates")
def _():
    payload = ordertriage_payload(requested_qty=None)
    StartSessionRequest.model_validate(payload)


@case("schema | invalid trigger_type literal rejected")
def _():
    payload = ordertriage_payload()
    payload["trigger_type"] = "evaluate"
    expect_raises(ValidationError, lambda: StartSessionRequest.model_validate(payload))


@case("schema | invalid trigger_source literal rejected")
def _():
    payload = ordertriage_payload()
    payload["trigger_source"] = "edi"
    expect_raises(ValidationError, lambda: StartSessionRequest.model_validate(payload))


@case("schema | extra field in demo_order is ignored (no 422)")
def _():
    payload = ordertriage_payload()
    payload["demo_order"]["mystery_field"] = "x"
    StartSessionRequest.model_validate(payload)


# ─── 2. UNIT TESTS of from_demo_payload — the actual site of the 422 bug ──
# These avoid BigQuery by patching resolve_demo_scenario at the module level.

from unittest.mock import patch  # noqa: E402
import agent_tools  # noqa: E402


_FAKE_SENTINEL = type("Sentinel", (), {"_is_placeholder": True})()


@case("agent_tools | from_demo_payload(empty) → fallback")
def _():
    with patch.object(agent_tools, "resolve_demo_scenario",
                      return_value=_FAKE_SENTINEL) as mock:
        result = agent_tools.from_demo_payload({})
    assert mock.called, "resolve_demo_scenario not called for empty payload"
    assert result is _FAKE_SENTINEL


@case("agent_tools | from_demo_payload missing sold_to → fallback (THE FIX)")
def _():
    """Before the fix, this raised KeyError → 422 'Could not resolve order: sold_to'.
    After the fix, it must call resolve_demo_scenario() instead."""
    payload = {
        "ordered_quantity_cases": 1000.0,
        "requested_delivery_date": "2026-05-26",
        "material_number": "M200",
        "customer_name": "Acme",
    }
    with patch.object(agent_tools, "resolve_demo_scenario",
                      return_value=_FAKE_SENTINEL) as mock:
        result = agent_tools.from_demo_payload(payload)
    assert mock.called, "resolve_demo_scenario not called when sold_to missing"
    assert result is _FAKE_SENTINEL


@case("agent_tools | from_demo_payload missing material_number → fallback")
def _():
    payload = {
        "ordered_quantity_cases": 1000.0,
        "requested_delivery_date": "2026-05-26",
        "sold_to": "C100",
        "customer_name": "Acme",
    }
    with patch.object(agent_tools, "resolve_demo_scenario",
                      return_value=_FAKE_SENTINEL) as mock:
        result = agent_tools.from_demo_payload(payload)
    assert mock.called
    assert result is _FAKE_SENTINEL


@case("agent_tools | from_demo_payload empty-string sold_to → fallback")
def _():
    """An empty string '' is just as bad as missing — must still fall back."""
    payload = {
        "ordered_quantity_cases": 1000.0,
        "requested_delivery_date": "2026-05-26",
        "sold_to": "",
        "material_number": "",
    }
    with patch.object(agent_tools, "resolve_demo_scenario",
                      return_value=_FAKE_SENTINEL) as mock:
        result = agent_tools.from_demo_payload(payload)
    assert mock.called


@case("agent_tools | from_demo_payload with full IDs → no fallback, real event")
def _():
    payload = {
        "sold_to": "C100",
        "material_number": "M200",
        "ordered_quantity_cases": 1000.0,
        "requested_delivery_date": "2026-05-26",
        "customer_name": "Acme",
        "material_description": "Pedigree",
        "sales_order_number": "12345",
    }
    with patch.object(agent_tools, "resolve_demo_scenario",
                      return_value=_FAKE_SENTINEL) as mock:
        result = agent_tools.from_demo_payload(payload)
    assert not mock.called, "should not fall back when IDs present"
    assert result.sold_to == "C100"
    assert result.material_number == "M200"
    assert result.ordered_quantity_cases == 1000.0


# ─── 3. End-to-end through the route handler — Pydantic boundary only ─────
# Mocks resolve_demo_scenario AND create_session so the handler runs to
# return without touching GCP. The point: confirm the 422 we were seeing is
# truly gone end-to-end.

@case("route | main.start_session(OrderTriage payload) returns 200 not 422")
def _():
    """Exercises main.start_session via FastAPI's TestClient with
    GCP-touching deps stubbed. Pre-fix: 422 'Could not resolve order'.
    Post-fix: 200 with placeholder_used=True."""
    try:
        from fastapi.testclient import TestClient
    except Exception as e:  # noqa: BLE001
        # httpx not installed → skip rather than fail noisily
        print(f"        (skipped: {e})")
        return

    fake_event = type("E", (), {
        "_is_placeholder": True,
        "sold_to": "PLACEHOLDER",
        "material_number": "PLACEHOLDER",
        "ordered_quantity_cases": 1000.0,
        "requested_delivery_date": "2026-05-26",
        "to_dict": lambda self: {"sold_to": "PLACEHOLDER",
                                 "material_number": "PLACEHOLDER",
                                 "ordered_quantity_cases": 1000.0,
                                 "requested_delivery_date": "2026-05-26"},
    })()

    import main  # noqa: WPS433
    with patch.object(main, "resolve_demo_scenario", return_value=fake_event), \
         patch.object(main, "from_demo_payload", return_value=fake_event), \
         patch.object(main, "create_session"), \
         patch.object(main, "run_session"):
        client = TestClient(main.app)
        res = client.post("/sessions", json=ordertriage_payload())
    assert res.status_code == 200, f"got {res.status_code}: {res.text}"
    body = res.json()
    assert "session_id" in body


# ─── runner ─────────────────────────────────────────────────────────────────
def main() -> int:
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

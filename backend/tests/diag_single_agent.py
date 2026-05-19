"""
Diagnostic: run one specialist agent end-to-end (no parallel fan-out).

If this succeeds, the live failures are caused by parallel execution
(asyncio.gather across 4 specialists). If this fails the same way, ADK
itself is unhappy regardless of parallelism.

Run inside the backend container:
    docker cp this_file <backend>:/app/diag_single_agent.py
    docker exec <backend> python /app/diag_single_agent.py supply_planning
    docker exec <backend> python /app/diag_single_agent.py serial      # all 4, one at a time
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
import traceback

sys.path.insert(0, "/app")

from agent_tools import CustomerOrderEvent  # noqa: E402
from firestore_client import StepWriter  # noqa: E402
from orchestrator import _invoke_agent  # noqa: E402
from agents import SPECIALIST_AGENTS  # noqa: E402


def _make_payload() -> dict:
    """Mirror what orchestrator.run_session builds for the round-1 fan-out."""
    order = CustomerOrderEvent(
        sold_to="C100",
        material_number="M200",
        ordered_quantity_cases=1800.0,
        requested_delivery_date="2026-05-26",
        ship_to=None,
        customer_po_number=None,
        sales_order_number="44025",
        customer_name="Dollar General",
        material_description="Whiskas Purrfectly Chicken 24ct",
        trigger_source="demo_payload",
    )
    return {
        "order": order.to_dict(),
        "round_number": 1,
        "instruction": ("Evaluate this order in your domain. Return "
                        "your structured signal."),
    }


async def run_one(agent_name: str) -> tuple[bool, str]:
    writer = StepWriter(session_id=f"diag-{int(time.time())}-{agent_name}")
    payload = _make_payload()
    t0 = time.time()
    try:
        result = await _invoke_agent(agent_name, payload, writer, round_idx=1)
        ok_keys = list(result.keys()) if isinstance(result, dict) else type(result).__name__
        return True, f"{agent_name:22s} ok in {time.time()-t0:6.2f}s; result keys/type={ok_keys}"
    except Exception as e:
        tb = traceback.format_exc()
        return False, f"{agent_name:22s} FAIL in {time.time()-t0:6.2f}s\n  {type(e).__name__}: {str(e)[:300]}\n  --- traceback (tail) ---\n  " + "\n  ".join(tb.splitlines()[-15:])


async def amain(mode: str) -> int:
    if mode == "serial":
        # Run all 4 specialists one at a time. If parallel is the culprit,
        # this succeeds where asyncio.gather fails.
        all_ok = True
        for name in SPECIALIST_AGENTS:
            ok, msg = await run_one(name)
            print(msg, flush=True)
            all_ok = all_ok and ok
        return 0 if all_ok else 1
    elif mode == "gather":
        # Reproduce the production failure: 4 specialists via asyncio.gather.
        t0 = time.time()
        results = await asyncio.gather(
            *[run_one(name) for name in SPECIALIST_AGENTS],
            return_exceptions=True,
        )
        all_ok = True
        for r in results:
            if isinstance(r, Exception):
                print(f"AGENT raised: {type(r).__name__}: {str(r)[:200]}")
                all_ok = False
            else:
                ok, msg = r
                print(msg, flush=True)
                all_ok = all_ok and ok
        print(f"\ngather wall time: {time.time()-t0:.2f}s")
        return 0 if all_ok else 1
    else:
        # Run a single named agent.
        ok, msg = await run_one(mode)
        print(msg)
        return 0 if ok else 1


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "supply_planning"
    print(f"=== Diagnostic mode: {mode} ===", flush=True)
    sys.exit(asyncio.run(amain(mode)))

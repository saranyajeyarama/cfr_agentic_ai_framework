"""
Tiger Foods Customer Supply agentic AI — orchestrator (v2.02b).

STANDALONE. The complete 5-agent orchestration. Not a patch.

Flow:
  1. Trigger adapter resolves a CustomerOrderEvent (demo payload or EDI 850)
  2. 4 specialists fire IN PARALLEL via asyncio.gather
  3. Deterministic 3-rule conflict detection on the returned signals
  4. Debate-on-conflict between disputant pairs (max 2 follow-up rounds)
  5. Customer Supply Agent synthesizes the final recommendation
  6. Recommendation parked in Firestore awaiting human approval
  7. On approve/reject → dce_write into the real fct_allocation_decisions

Conflict rules (deterministic Python, not LLM):
  R1  any specialist returns hard_block=true
  R2  two specialists return opposing dispositions (PROCEED vs BLOCK)
  R3  confidence asymmetry: one >= 0.85 and another <= 0.50 on differing
      dispositions
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import traceback
import uuid
from typing import Any

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from agents import get_agent, SPECIALIST_AGENTS
from agent_tools import CustomerOrderEvent, dce_write
from firestore_client import StepWriter, update_session
from schemas import CustomerSupplyDecision, Conflict


MAX_DEBATE_ROUNDS = 2          # follow-up rounds AFTER the initial fan-out
ORCHESTRATOR_VERSION = "v2.02b"
AGENT_MODEL_VERSIONS = "gemini-2.5-pro,gemini-2.5-flash"

# One shared ADK session service for the process. ADK requires a session
# to be created on the service before Runner.run_async is called with it.
_SESSION_SERVICE = InMemorySessionService()
_ADK_USER_ID = "orchestrator"

# Cap concurrent agent invocations across the process. Each _invoke_agent
# call makes multiple Gemini turns via ADK; with no cap, several sessions
# starting at once (UI fan-out) blasts Vertex AI past its per-minute
# quota and httpx pools start failing with ReadError/ConnectError after
# the first wave. Default 1 = strictly serialized across sessions to
# match the within-session sequential flow. Raise via AGENT_CONCURRENCY
# env var if local Vertex quota permits.
_AGENT_CONCURRENCY = asyncio.Semaphore(int(os.environ.get("AGENT_CONCURRENCY", "1")))


def _now_ms() -> int:
    return int(time.time() * 1000)


def _conf(signal: dict) -> float:
    """Read a specialist signal's confidence as a float. The schema declares
    it float, but Gemini sometimes emits a quoted string ("0.85") since we
    can't use ADK output_schema alongside tools — coerce defensively."""
    v = signal.get("confidence", 0.0)
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


_QUAL_TO_CONF = {"HIGH": 0.85, "MEDIUM": 0.65, "MED": 0.65, "LOW": 0.4}


def _coerce_confidence(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        pass
    if isinstance(v, str) and v.strip().upper() in _QUAL_TO_CONF:
        return _QUAL_TO_CONF[v.strip().upper()]
    return 0.0


def _avg_specialist_confidence(d: dict) -> float:
    sigs = (d.get("specialist_signals") or {}).values()
    confs = [_coerce_confidence(s.get("confidence")) for s in sigs if isinstance(s, dict)]
    confs = [c for c in confs if c > 0]
    return round(sum(confs) / len(confs), 2) if confs else 0.0


def _normalize_decision(d: dict, order_event, session_id: str = "") -> None:
    """Reshape Gemini's frequent flat synthesizer output into the nested
    CustomerSupplyDecision shape the front-end expects. Mutates in place.

    Common drift patterns this fixes:
      recommendation : "REJECT"  ->  {action: "REJECT", ...}
      reasoning_chain: ["...","..."]  ->  {key_trade_offs: [...], ...}
      confidence     : "HIGH"  ->  0.85
    """
    # recommendation: flat string -> wrapped dict.
    # Agents emit ACCEPT / MODIFY / REJECT / DEFER; map DEFER to MODIFY
    # since the schema only knows the three canonical actions, and a
    # DEFER usually maps to "hold / shorten quantity" in the UI.
    rec = d.get("recommendation")
    print(f"[DEBUG][normalize #2] raw recommendation from agent: type={type(rec).__name__}, value={rec!r}")
    if isinstance(rec, str):
        action_str = rec.strip().upper()
        canonical = {"ACCEPT", "MODIFY", "REJECT"}
        if action_str == "DEFER":
            mapped = "MODIFY"
            qty = 0
        elif action_str in canonical:
            mapped = action_str
            qty = float(getattr(order_event, "ordered_quantity_cases", 0) or 0)
            if mapped == "REJECT":
                qty = 0
        else:
            mapped = "ACCEPT"
            qty = float(getattr(order_event, "ordered_quantity_cases", 0) or 0)
        conf = _coerce_confidence(d.get("confidence")) or _avg_specialist_confidence(d)
        d["recommendation"] = {
            "action": mapped,
            "raw_action": action_str,  # preserve the agent's original verb
            "fulfill_qty_cs": qty,
            "confidence": conf,
            "expected_outcome": "",
        }
    elif isinstance(rec, dict):
        print(f"[DEBUG][normalize #3] agent returned dict. fulfill_qty_cs present={('fulfill_qty_cs' in rec)}, value={rec.get('fulfill_qty_cs')!r}")
        rec["confidence"] = _coerce_confidence(rec.get("confidence")) or _avg_specialist_confidence(d)
        rec.setdefault("action", "ACCEPT")
        rec.setdefault("fulfill_qty_cs", 0)
        rec.setdefault("expected_outcome", "")
        print(f"[DEBUG][normalize #3] after setdefault, fulfill_qty_cs={rec.get('fulfill_qty_cs')!r}")
        d["recommendation"] = rec
    else:
        d["recommendation"] = {"action": "ACCEPT", "fulfill_qty_cs": 0,
                               "confidence": _avg_specialist_confidence(d), "expected_outcome": ""}

    # reasoning_chain: list of strings -> nested dict
    rc = d.get("reasoning_chain")
    if isinstance(rc, list):
        d["reasoning_chain"] = {
            "key_trade_offs": [str(x) for x in rc],
            "what_would_change_the_decision": "",
            "evidence_by_agent": {},
        }
    elif isinstance(rc, dict):
        rc.setdefault("key_trade_offs", [])
        rc.setdefault("what_would_change_the_decision", "")
        rc.setdefault("evidence_by_agent", {})
    else:
        d["reasoning_chain"] = {"key_trade_offs": [],
                                "what_would_change_the_decision": "",
                                "evidence_by_agent": {}}

    # session_id is required by the schema; the synthesizer doesn't know
    # it, so fill it in here.
    if not d.get("session_id"):
        d["session_id"] = session_id


def _extract_json(text: str) -> dict | None:
    """Parse a JSON object out of an agent's final text.

    The agents are instructed to emit a bare JSON object (they cannot use
    ADK output_schema — see agents.py). Models sometimes still wrap it in
    ```json fences or add stray prose, so this is tolerant: it strips
    fences, then falls back to the outermost {...} span.
    """
    if not text:
        return None
    s = text.strip()
    # strip ```json ... ``` or ``` ... ``` fences
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # fallback: outermost brace span
    start, end = s.find("{"), s.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(s[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


# ---------------------------------------------------------------------------
# Raw response persistence (debug)
# ---------------------------------------------------------------------------
_RAW_RESPONSE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "agent_raw_responses"
)

def _save_raw_response(agent_name: str, adk_session_id: str,
                       raw_text: str, parsed: dict | None) -> None:
    os.makedirs(_RAW_RESPONSE_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    filename = f"{ts}_{agent_name}_{adk_session_id}.json"
    filepath = os.path.join(_RAW_RESPONSE_DIR, filename)
    payload = {
        "timestamp": ts,
        "agent": agent_name,
        "adk_session_id": adk_session_id,
        "raw_text": raw_text,
        "parsed_json": parsed,
    }
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str)
    print(f"[DEBUG] raw response saved → {filepath}")


# ---------------------------------------------------------------------------
# Specialist / synthesizer invocation
# ---------------------------------------------------------------------------
async def _invoke_agent(
    agent_name: str,
    prompt_payload: dict,
    writer: StepWriter,
    round_idx: int,
) -> dict:
    """Invoke one agent, streaming its tool calls and final response to
    Firestore. Returns the parsed structured JSON response.

    ADK 1.0.0 specifics handled here:
      - the ADK session must be created on the session service before
        run_async is called (Bug #5);
      - new_message must be a genai types.Content, not a string (Bug #4);
      - Event has no is_tool_call/tool_call/final_response attributes —
        tool activity comes from get_function_calls()/get_function_
        responses(), the final text from event.content on the event where
        is_final_response() is true (Bug #6).
    """
    agent = get_agent(agent_name)
    app_name = f"tiger-agents-v2-02-{agent_name}"
    # Unique per invocation. round_idx alone is not unique when one agent
    # appears in two conflicts that debate in the same round, so a uuid
    # suffix guarantees a fresh ADK session every call.
    adk_session_id = (f"adk-{writer.session_id}-{agent_name}"
                      f"-r{round_idx}-{uuid.uuid4().hex[:8]}")

    runner = Runner(
        app_name=app_name,
        agent=agent,
        session_service=_SESSION_SERVICE,
    )

    # Bug #5 — the session must exist before run_async uses it.
    await _SESSION_SERVICE.create_session(
        app_name=app_name,
        user_id=_ADK_USER_ID,
        session_id=adk_session_id,
    )

    # Bug #4 — new_message is a types.Content, not a raw string.
    user_msg = genai_types.Content(
        role="user",
        parts=[genai_types.Part.from_text(text=json.dumps(prompt_payload))],
    )

    t0 = _now_ms()
    response_json: dict | None = None

    # Hold the concurrency permit for the entire ADK run, including all
    # tool calls and follow-up LLM turns inside the async generator.
    async with _AGENT_CONCURRENCY:
      try:
        async for event in runner.run_async(
            user_id=_ADK_USER_ID,
            session_id=adk_session_id,
            new_message=user_msg,
        ):
            # Bug #6 — real ADK Event API.
            for fc in event.get_function_calls():
                _args = dict(fc.args) if fc.args else {}
                # ───────── DEBUG-RDD: log every tool call ─────────
                print(f"[DEBUG-RDD][orchestrator] {agent_name} → "
                      f"{fc.name}({_args})")
                writer.write(
                    agent=agent_name, round_idx=round_idx, action="tool_call",
                    tool_name=fc.name,
                    tool_args=_args,
                    notes=f"{agent_name} called {fc.name}",
                )
            for fr in event.get_function_responses():
                resp = fr.response
                result = resp if isinstance(resp, dict) else {"value": resp}
                rc = result.get("row_count")
                summary = (f"{fr.name} returned {rc} rows" if rc is not None
                           else f"{fr.name} returned a result")
                # ───────── DEBUG-RDD: log every tool response ─────────
                print(f"[DEBUG-RDD][orchestrator] {agent_name} ← "
                      f"{fr.name} returned row_count={rc}")
                writer.write(
                    agent=agent_name, round_idx=round_idx, action="tool_call",
                    tool_name=fr.name, tool_result_summary=summary,
                    tool_result_full=result,
                )
            if event.is_final_response() and event.content and \
                    event.content.parts:
                text = "".join(
                    p.text for p in event.content.parts
                    if getattr(p, "text", None))
                response_json = _extract_json(text)
                try:
                    _save_raw_response(agent_name, adk_session_id, text, response_json)
                except Exception as _save_err:
                    print(f"[DEBUG] failed to save raw response: {_save_err}")
      finally:
        # Drop the ADK session immediately — InMemorySessionService keeps
        # every session forever otherwise. With sequential sessions + 4
        # agents each that's the OOM source.
        try:
            await _SESSION_SERVICE.delete_session(
                app_name=app_name,
                user_id=_ADK_USER_ID,
                session_id=adk_session_id,
            )
        except Exception:
            pass

    writer.write(
        agent=agent_name, round_idx=round_idx, action="response",
        model_response_json=response_json, latency_ms=_now_ms() - t0,
    )
    if response_json is None:
        # Graceful error envelope — the synthesizer expects this shape.
        return {
            "agent": agent_name,
            "disposition": "CAUTION",
            "confidence": 0.0,
            "hard_block": False,
            "signal": {"error": f"{agent_name} produced no response"},
            "evidence": [],
            "reasoning_summary":
                f"{agent_name} did not return a structured response.",
        }
    return response_json


# ---------------------------------------------------------------------------
# Conflict detection (deterministic)
# ---------------------------------------------------------------------------
def _detect_conflicts(signals: dict[str, dict]) -> list[Conflict]:
    conflicts: list[Conflict] = []
    items = list(signals.items())

    # R1 — hard block
    for name, s in items:
        if not s.get("hard_block"):
            continue
        proceeders = [n for n, ss in items
                      if ss.get("disposition") == "PROCEED"
                      and not ss.get("hard_block")]
        if proceeders:
            conflicts.append(Conflict(
                type="HARD_BLOCK",
                disputants=[name, proceeders[0]],
                summary=(f"{name} returned hard_block; {proceeders[0]} is "
                         f"PROCEED — needs reconciliation."),
            ))

    # R2 — disposition divergence
    proceed = [n for n, s in items if s.get("disposition") == "PROCEED"]
    block = [n for n, s in items if s.get("disposition") == "BLOCK"]
    for pa in proceed:
        for ba in block:
            if any(set(c.disputants) == {pa, ba} for c in conflicts):
                continue
            conflicts.append(Conflict(
                type="DISPOSITION_DIVERGENCE",
                disputants=[pa, ba],
                summary=(f"{pa} says PROCEED, {ba} says BLOCK — opposing "
                         f"reads of the same order."),
            ))

    # R3 — confidence asymmetry on differing dispositions
    for i, (n_a, s_a) in enumerate(items):
        for n_b, s_b in items[i + 1:]:
            d_a, d_b = s_a.get("disposition"), s_b.get("disposition")
            c_a = _conf(s_a)
            c_b = _conf(s_b)
            if d_a != d_b and ((c_a >= 0.85 and c_b <= 0.50)
                               or (c_b >= 0.85 and c_a <= 0.50)):
                if any(set(c.disputants) == {n_a, n_b} for c in conflicts):
                    continue
                conflicts.append(Conflict(
                    type="CONFIDENCE_ASYMMETRY",
                    disputants=[n_a, n_b],
                    summary=(f"{n_a} (conf {c_a:.2f}) vs {n_b} "
                             f"(conf {c_b:.2f}) — confidence asymmetry on "
                             f"differing dispositions."),
                ))
    return conflicts


def _is_conflict_resolved(conflict: Conflict,
                          signals: dict[str, dict]) -> bool:
    a, b = conflict.disputants
    sa, sb = signals[a], signals[b]
    if conflict.type == "HARD_BLOCK":
        return not (sa.get("hard_block") or sb.get("hard_block"))
    if conflict.type == "DISPOSITION_DIVERGENCE":
        return sa.get("disposition") != "BLOCK" \
            or sb.get("disposition") != "BLOCK"
    same_d = sa.get("disposition") == sb.get("disposition")
    return same_d or abs(_conf(sa) - _conf(sb)) < 0.30


# ---------------------------------------------------------------------------
# Debate round
# ---------------------------------------------------------------------------
async def _run_debate_round(conflict: Conflict, signals: dict[str, dict],
                            writer: StepWriter,
                            round_idx: int) -> dict[str, dict]:
    a, b = conflict.disputants
    writer.write(agent="orchestrator", round_idx=round_idx, action="route",
                 notes=(f"Debate round {round_idx} on {conflict.type}: "
                        f"{a} <-> {b}"))
    instruction = ("Read the disputant's position. REVISE if their data is "
                   "materially new; otherwise HOLD with the specific data "
                   "they did not have.")
    # Sequential — same reasoning as the fan-out: parallel Vertex calls
    # under cumulative load fail with httpx ReadError/ConnectError.
    new_a = await _invoke_agent(
        a, {"your_previous_signal": signals[a],
            "disputant_position": signals[b],
            "round_number": round_idx,
            "instruction": instruction},
        writer, round_idx)
    new_b = await _invoke_agent(
        b, {"your_previous_signal": signals[b],
            "disputant_position": signals[a],
            "round_number": round_idx,
            "instruction": instruction},
        writer, round_idx)
    return {a: new_a, b: new_b}


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------
async def _synthesize(order_event: CustomerOrderEvent,
                      signals: dict[str, dict],
                      conflicts: list[Conflict],
                      writer: StepWriter) -> dict:
    payload = {
        "order": order_event.to_dict(),
        "specialist_signals": signals,
        "conflicts_detected": [c.model_dump() for c in conflicts],
        "session_id": writer.session_id,
        "instruction": ("Synthesize the four specialist signals into a "
                        "recommendation. Honor conflict resolutions; "
                        "surface deadlocks explicitly."),
    }
    return await _invoke_agent("customer_supply", payload, writer,
                               round_idx=0)


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------
async def run_session(session_id: str, trigger_type: str,
                      order_event: CustomerOrderEvent) -> None:
    """Run the 5-agent N-to-N parallel + debate-on-conflict flow."""
    writer = StepWriter(session_id)
    writer.write(agent="orchestrator", action="route",
                 notes=(f"Session started (trigger_source="
                        f"{order_event.trigger_source}) — fanning out to "
                        f"4 specialists"))
    if order_event._is_placeholder:
        writer.write(agent="orchestrator", action="route",
                     notes=("WARNING: placeholder order event in use — "
                            "tiger_semantic dataset not loaded."))

    try:
        order_payload = {
            "order": order_event.to_dict(),
            "round_number": 1,
            "instruction": ("Evaluate this order in your domain. Return "
                            "your structured signal."),
        }
        # Specialists run sequentially. Parallel fan-out via asyncio.gather
        # blasts Vertex AI past its per-minute connection budget when
        # several sessions are in flight, producing httpx ReadError /
        # ConnectError mid-stream. Sequential is slower but deterministic.
        results = []
        for name in SPECIALIST_AGENTS:
            results.append(
                await _invoke_agent(name, order_payload, writer, round_idx=1))
        signals: dict[str, dict] = dict(zip(SPECIALIST_AGENTS, results))
        writer.write(agent="orchestrator", round_idx=1, action="route",
                     notes="Fan-out complete. Running conflict detection.")

        conflicts = _detect_conflicts(signals)
        for c in conflicts:
            writer.write(agent="orchestrator", round_idx=1, action="route",
                         notes=(f"Conflict: {c.type} between "
                                f"{' and '.join(c.disputants)} — {c.summary}"))

        for conflict in conflicts:
            for r in range(2, 2 + MAX_DEBATE_ROUNDS):
                signals.update(
                    await _run_debate_round(conflict, signals, writer, r))
                conflict.debate_rounds_used = r - 1
                if _is_conflict_resolved(conflict, signals):
                    conflict.resolution = "RESOLVED"
                    writer.write(agent="orchestrator", round_idx=r,
                                 action="route",
                                 notes=(f"Conflict {conflict.type} resolved "
                                        f"at round {r}."))
                    break
            else:
                conflict.resolution = "DEADLOCK"
                writer.write(agent="orchestrator", action="route",
                             notes=(f"Conflict {conflict.type} DEADLOCKED "
                                    f"after {MAX_DEBATE_ROUNDS} rounds."))

        writer.write(agent="orchestrator", action="route",
                     notes="Synthesizing — Customer Supply Agent.")
        decision = await _synthesize(order_event, signals, conflicts, writer)
        print(f"[DEBUG][synthesize #1] raw agent decision recommendation: {decision.get('recommendation')!r}")

        # Normalize Gemini's frequent flat shapes into the nested schema
        # the front-end expects. Idempotent — re-runs on already-nested
        # outputs are no-ops.
        _normalize_decision(decision, order_event, session_id)
        print(f"[DEBUG][normalize #4] after _normalize_decision, fulfill_qty_cs={decision.get('recommendation', {}).get('fulfill_qty_cs')!r}")

        # Schema enforcement moved orchestrator-side in v2.02A (ADK 1.0.0
        # forbids output_schema alongside tools — see agents.py). Validate
        # the synthesizer's JSON against CustomerSupplyDecision, but do NOT
        # crash the session on a mismatch: the recommendation content is
        # still useful to the human reviewer. Record the mismatch instead.
        try:
            CustomerSupplyDecision.model_validate(decision)
            decision["_schema_valid"] = True
        except Exception as ve:
            decision["_schema_valid"] = False
            decision["_schema_error"] = str(ve)[:500]
            writer.write(
                agent="orchestrator", action="route",
                notes=(f"Synthesizer output did not fully match "
                       f"CustomerSupplyDecision schema: {str(ve)[:200]}"))

        decision.setdefault("agent_model_versions", AGENT_MODEL_VERSIONS)
        decision.setdefault("orchestrator_version", ORCHESTRATOR_VERSION)
        decision["trigger_type"] = trigger_type

        update_session(session_id, status="awaiting_approval",
                       final_action_card=decision)
        writer.write(agent="orchestrator", action="route",
                     notes="Recommendation ready. Awaiting human approval.")

    except Exception as exc:
        writer.write(agent="orchestrator", action="error",
                     notes=(f"{type(exc).__name__}: {exc}\n"
                            f"{traceback.format_exc()[:1000]}"))
        update_session(session_id, status="error", ended_at="NOW")
        raise


# ---------------------------------------------------------------------------
# Human approval / rejection
# ---------------------------------------------------------------------------
def _finalize(session_id: str, action_card: dict, user_id: str,
              user_decision: str, rejection_reason: str | None) -> str:
    payload = dict(action_card)
    payload.setdefault("orchestrator_version", ORCHESTRATOR_VERSION)
    payload.setdefault("agent_model_versions", AGENT_MODEL_VERSIONS)

    result = dce_write(
        session_id=session_id,
        decision_payload_json=json.dumps(payload),
        user_decision=user_decision,
        user_id=user_id,
        rejection_reason=rejection_reason,
    )
    if "error" in result:
        raise RuntimeError(f"dce_write failed: {result['error']}")

    writer = StepWriter(session_id)
    writer.write(agent="human", action=user_decision,
                 notes=(f"{user_decision} by {user_id}"
                        + (f": {rejection_reason}" if rejection_reason
                           else "")))
    update_session(session_id, status=("approved"
                                       if user_decision == "approved"
                                       else "rejected"),
                   decision_id=result["decision_id"], user_id=user_id,
                   ended_at="NOW")
    return result["decision_id"]


def approve_session(session_id: str, action_card: dict, user_id: str,
                    approval_notes: str | None) -> str:
    return _finalize(session_id, action_card, user_id, "approved", None)


def reject_session(session_id: str, action_card: dict, user_id: str,
                   rejection_reason: str) -> str:
    return _finalize(session_id, action_card, user_id, "rejected",
                     rejection_reason)

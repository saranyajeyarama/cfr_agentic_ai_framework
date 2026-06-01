"""
Tiger Foods Customer Supply agentic AI — ADK agent factory (v2.02A).

Builds the 5 LlmAgents for google-adk 1.0.0.

  customer_supply      synthesizer        gemini-2.5-pro    temp 0.2
  supply_planning      specialist         gemini-2.5-flash  temp 0.1
  demand_planning      specialist         gemini-2.5-pro    temp 0.2
  transportation       specialist         gemini-2.5-flash  temp 0.1
  retail_intelligence  specialist         gemini-2.5-pro    temp 0.2

System prompts load from agents/*.md.

---------------------------------------------------------------------------
ADK 1.0.0 COMPATIBILITY NOTES — read before editing.

1. google.adk.models.Gemini takes ONLY `model` (the model id string).
   It does NOT accept `model_name` or `temperature`. Sampling parameters
   (temperature, etc.) go in the agent's `generate_content_config`, a
   google.genai.types.GenerateContentConfig.

2. ADK 1.0.0 forbids `output_schema` and `tools` on the same LlmAgent:
   "if output_schema is set, tools must be empty". Our agents must use
   tools (they query BigQuery), so they CANNOT also declare output_schema.
   Structured output is instead obtained by:
     - the system prompts instructing the model to emit ONLY JSON
       conforming to the target schema, and
     - the orchestrator parsing+validating that JSON against the Pydantic
       schema after the run (see orchestrator._parse_agent_json).
   This is the supported pattern for a tool-using agent that must return
   structured data. The schema classes still live in schemas.py and are
   still the contract — they are just enforced orchestrator-side, not by
   ADK's output_schema mechanism.
---------------------------------------------------------------------------
"""

from __future__ import annotations

import os
from pathlib import Path

from google.adk.agents import LlmAgent
from google.adk.models import Gemini
from google.genai import types as genai_types

from agent_tools import (
    CUSTOMER_SUPPLY_TOOLS,
    SUPPLY_PLANNING_TOOLS,
    DEMAND_PLANNING_TOOLS,
    TRANSPORTATION_TOOLS,
    RETAIL_INTELLIGENCE_TOOLS,
)

import logging
_log = logging.getLogger(__name__)


PROMPTS_DIR = Path(os.environ.get(
    "PROMPTS_DIR",
    str(Path(__file__).parent.parent.parent / "agents"),
))


def _load_prompt(name: str) -> str:
    """Load a system prompt from agents/{name}.md, unwrapping the first
    fenced ``` block if present."""
    path = PROMPTS_DIR / f"{name}.md"
    _log.debug("Loading prompt name=%s path=%s", name, path)
    text = path.read_text(encoding="utf-8")
    if "```" in text:
        parts = text.split("```")
        if len(parts) >= 2:
            block = parts[1]
            if block.startswith("text"):
                block = block[4:]
            return block.strip()
    return text.strip()


def _cfg(temperature: float) -> genai_types.GenerateContentConfig:
    """ADK 1.0.0: sampling params live in generate_content_config, not on
    the Gemini model object."""
    return genai_types.GenerateContentConfig(temperature=temperature)


# A JSON-discipline reminder appended to every agent instruction. The
# agents cannot use ADK output_schema (they have tools), so the prompt
# carries the structured-output contract and the orchestrator validates.
_JSON_DISCIPLINE = (
    "\n\n---\nOUTPUT DISCIPLINE: After using whatever tools you need, your "
    "FINAL message must be a single valid JSON object and nothing else — "
    "no prose before or after, no markdown code fences. It must conform "
    "to the schema described above. The orchestrator parses and validates "
    "this JSON against a strict schema; malformed or non-JSON output is "
    "treated as an error."
)


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------
def make_customer_supply() -> LlmAgent:
    return LlmAgent(
        name="customer_supply",
        model=Gemini(model="gemini-2.5-pro"),
        generate_content_config=_cfg(0.2),
        description=(
            "Synthesizer. Receives the normalized order event and the four "
            "specialist signals, runs conflict detection and debate-on-"
            "conflict, produces the human-facing recommendation."
        ),
        instruction=_load_prompt("customer_supply_agent") + _JSON_DISCIPLINE,
        tools=CUSTOMER_SUPPLY_TOOLS,
    )


def make_supply_planning() -> LlmAgent:
    return LlmAgent(
        name="supply_planning",
        model=Gemini(model="gemini-2.5-flash"),
        generate_content_config=_cfg(0.1),
        description=(
            "Forward available-to-promise from inventory projection, "
            "production order execution risk, raw-material adequacy, "
            "batch shelf-life (report-only)."
        ),
        instruction=_load_prompt("supply_planning_agent") + _JSON_DISCIPLINE,
        tools=SUPPLY_PLANNING_TOOLS,
    )


def make_demand_planning() -> LlmAgent:
    return LlmAgent(
        name="demand_planning",
        model=Gemini(model="gemini-2.5-pro"),
        generate_content_config=_cfg(0.2),
        description=(
            "Order-vs-consensus-forecast gap analysis, above-forecast "
            "classification, forecast accuracy / bias, promo attribution."
        ),
        instruction=_load_prompt("demand_planning_agent") + _JSON_DISCIPLINE,
        tools=DEMAND_PLANNING_TOOLS,
    )


def make_transportation() -> LlmAgent:
    return LlmAgent(
        name="transportation",
        model=Gemini(model="gemini-2.5-flash"),
        generate_content_config=_cfg(0.1),
        description=(
            "OTIF risk by account, lane transit feasibility, carrier OTP, "
            "chargeback exposure. Influences customer-supply decisions; "
            "does not own OTIF."
        ),
        instruction=_load_prompt("transportation_agent") + _JSON_DISCIPLINE,
        tools=TRANSPORTATION_TOOLS,
    )


def make_retail_intelligence() -> LlmAgent:
    return LlmAgent(
        name="retail_intelligence",
        model=Gemini(model="gemini-2.5-pro"),
        generate_content_config=_cfg(0.2),
        description=(
            "Consumer-takeaway and promotional context reader. Classifies "
            "an order as genuine pull, buffer build, or promo-driven using "
            "fct_demand_drivers and fct_promo_plan."
        ),
        instruction=_load_prompt("retail_intelligence_agent") + _JSON_DISCIPLINE,
        tools=RETAIL_INTELLIGENCE_TOOLS,
    )


# ---------------------------------------------------------------------------
# Singleton accessors
# ---------------------------------------------------------------------------
_AGENTS: dict[str, LlmAgent] = {}

_FACTORIES = {
    "customer_supply":     make_customer_supply,
    "supply_planning":     make_supply_planning,
    "demand_planning":     make_demand_planning,
    "transportation":      make_transportation,
    "retail_intelligence": make_retail_intelligence,
}


def get_agent(name: str) -> LlmAgent:
    if name in _AGENTS:
        return _AGENTS[name]
    if name not in _FACTORIES:
        raise ValueError(f"Unknown agent: {name}")
    _log.info("Building agent singleton name=%s", name)
    _AGENTS[name] = _FACTORIES[name]()
    return _AGENTS[name]


SPECIALIST_AGENTS = (
    "supply_planning",
    "demand_planning",
    "transportation",
    "retail_intelligence",
)

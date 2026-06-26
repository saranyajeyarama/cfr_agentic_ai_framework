"""Pluggable LLM provider/model selection — env-driven, Gemini default.

Single source of truth for "which model powers which agent/call". Gemini (via
Vertex) stays the default so nothing changes unless you opt in. Any other provider
(OpenAI, Anthropic, Azure, …) is reached through ADK's LiteLlm wrapper — one
dependency, ~100 providers.

Configuration is ENV-ONLY (no config file):
    LLM_PROVIDER            gemini | openai | anthropic | azure | …   (default: gemini)
    LLM_MODEL_DEFAULT       optional global model-id override
    LLM_MODEL_<AGENT>       optional per-agent override, AGENT upper-cased
                            e.g. LLM_MODEL_CUSTOMER_SUPPLY=gpt-4o
Provider API keys are read by LiteLlm from the usual env vars at runtime
(OPENAI_API_KEY, ANTHROPIC_API_KEY, …) — never baked into the image.

Two entry points:
    build_model(agent)  -> an ADK model object for an LlmAgent (agents.py)
    complete(messages, system, agent) -> str   for the direct (non-ADK) calls
                                                (main.py /chat, /fulfillment/recommend)
"""
import os

# Per-agent built-in defaults (model_id, temperature) — reproduce today's exact
# Gemini setup. `chat` and `fulfillment_recommend` are the two DIRECT-call sites.
_DEFAULTS = {
    "customer_supply":       ("gemini-2.5-pro",   0.2),
    "supply_planning":       ("gemini-2.5-flash", 0.1),
    "demand_planning":       ("gemini-2.5-pro",   0.2),
    "transportation":        ("gemini-2.5-flash", 0.1),
    "retail_intelligence":   ("gemini-2.5-pro",   0.2),
    "fulfillment":           ("gemini-2.5-pro",   0.1),
    "schema_mapping":        ("gemini-2.5-pro",   0.1),
    "chat":                  ("gemini-2.5-flash", 0.3),
    "fulfillment_recommend": ("gemini-2.5-flash", 0.2),
    "_default":              ("gemini-2.5-flash", 0.2),
}

_PROJECT_ID = os.environ.get("PROJECT_ID", "resilience-riskradar")
_REGION = os.environ.get("REGION", "us-central1")


def provider() -> str:
    """Active provider. LLM_PROVIDER wins; falls back to the legacy AI_PROVIDER; default gemini."""
    return (os.environ.get("LLM_PROVIDER")
            or os.environ.get("AI_PROVIDER")
            or "gemini").strip().lower()


def _spec(agent: str) -> tuple[str, float]:
    return _DEFAULTS.get(agent, _DEFAULTS["_default"])


def model_id_for(agent: str) -> str:
    """Env override (per-agent → global) else the built-in default for this agent."""
    return (os.environ.get(f"LLM_MODEL_{agent.upper()}")
            or os.environ.get("LLM_MODEL_DEFAULT")
            or _spec(agent)[0])


def temperature_for(agent: str) -> float:
    raw = os.environ.get(f"LLM_TEMP_{agent.upper()}")
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return _spec(agent)[1]


def _is_gemini(prov: str) -> bool:
    return prov in ("", "gemini", "vertex", "vertexai", "google")


# ───────────────────────── ADK agent models (agents.py) ─────────────────────
def build_model(agent: str):
    """Return an ADK model object for an LlmAgent. Gemini by default; otherwise a
    LiteLlm wrapper (model id provider-prefixed, e.g. 'openai/gpt-4o')."""
    prov = provider()
    mid = model_id_for(agent)
    if _is_gemini(prov):
        from google.adk.models import Gemini
        return Gemini(model=mid)
    # Non-Google → LiteLlm. Accept already-prefixed ids (e.g. 'openai/gpt-4o')
    # or bare ids (prefix with the provider). Temperature passed through too,
    # since generate_content_config may not propagate to LiteLlm.
    from google.adk.models.lite_llm import LiteLlm
    full = mid if "/" in mid else f"{prov}/{mid}"
    return LiteLlm(model=full, temperature=temperature_for(agent))


# ───────────────────────── direct calls (main.py) ───────────────────────────
def _mrole(m) -> str:
    r = getattr(m, "role", None) or (m.get("role") if isinstance(m, dict) else None) or "user"
    return "user" if r == "user" else "assistant"


def _mtext(m) -> str:
    return getattr(m, "text", None) or (m.get("text") if isinstance(m, dict) else None) or ""


def complete(messages, system: str | None = None, agent: str = "chat") -> str:
    """Single/multi-turn completion → text. Provider-agnostic. SYNCHRONOUS
    (callers wrap in asyncio.to_thread). `messages` is a list of objects/dicts
    with .role ('user'|'model'|'assistant') and .text."""
    prov = provider()
    mid = model_id_for(agent)
    msgs = list(messages or [])

    if _is_gemini(prov):
        import vertexai
        from vertexai.generative_models import Content, GenerativeModel, Part
        vertexai.init(project=_PROJECT_ID, location=_REGION)
        kwargs = {"model_name": mid}
        if system:
            kwargs["system_instruction"] = system
        model = GenerativeModel(**kwargs)
        history = [Content(role=("user" if _mrole(m) == "user" else "model"),
                           parts=[Part.from_text(_mtext(m))]) for m in msgs[:-1]]
        chat = model.start_chat(history=history)
        resp = chat.send_message(_mtext(msgs[-1]) if msgs else "")
        return getattr(resp, "text", "") or ""

    # Non-Google → litellm (reads OPENAI_API_KEY / ANTHROPIC_API_KEY / … from env).
    import litellm
    lm = [{"role": "system", "content": system}] if system else []
    lm += [{"role": _mrole(m), "content": _mtext(m)} for m in msgs]
    resp = litellm.completion(model=f"{prov}/{mid}", messages=lm,
                              temperature=temperature_for(agent))
    return (resp["choices"][0]["message"]["content"] or "")

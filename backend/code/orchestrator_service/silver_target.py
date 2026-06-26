"""Silver-layer target resolution (platform-agnostic).

Single source of truth for the fully-qualified dataset ids the app reads (the
Silver layer) and writes (decisions). Both are env-overridable so a deployment
can point the app at a *virtual* Silver layer — e.g. the mapped client views the
schema-mapping agent creates (DEPLOY.md Option B) — with ZERO app-code change.

The defaults reproduce the GCP reference implementation exactly, so existing
deployments behave identically when the env vars are unset:

    SEMANTIC_DS   read  layer (default  <PROJECT_ID>.tiger_semantic)
    DECISIONS_DS  write layer (default  <PROJECT_ID>.tiger_decisions)

To repoint at a virtual Silver layer, set SEMANTIC_DS (e.g. via the per-platform
config the driver loads — config/<platform>/silver.config.json). The app only
ever references {SEMANTIC_DS}.<view>.<column>, so identical view + column names
mean the mapped views are consumed transparently.
"""
import os

PROJECT_ID = os.environ.get("PROJECT_ID", "resilience-riskradar")

SEMANTIC_DS = os.environ.get("SEMANTIC_DS") or f"{PROJECT_ID}.tiger_semantic"
DECISIONS_DS = os.environ.get("DECISIONS_DS") or f"{PROJECT_ID}.tiger_decisions"


def semantic_dataset() -> str:
    """Bare dataset/schema name (no project) — handy for INFORMATION_SCHEMA
    qualification and for adapters that namespace by dataset rather than
    project.dataset."""
    return SEMANTIC_DS.split(".")[-1]

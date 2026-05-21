"""
Tiger Foods Customer Supply agentic AI — BigQuery client (v2.01).

STANDALONE. Thin wrapper for orchestrator-level access. The agent-facing
query work all lives in agent_tools.py (its own _bq client + _run_query
chokepoint). This module exists only so orchestrator-side code that needs
a raw client can obtain one without re-importing the tool module.

No write tool is bound to any agent; dce_write in agent_tools.py is called
by the orchestrator after human approval, never by an agent.
"""

from __future__ import annotations

import os
from google.cloud import bigquery

PROJECT_ID = os.environ.get("PROJECT_ID", "resilience-riskradar")
_bq = bigquery.Client(project=PROJECT_ID, location="us-central1")


def get_client() -> bigquery.Client:
    return _bq

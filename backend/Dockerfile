# =============================================================================
# Tiger Foods Customer Supply Agentic AI — Orchestrator service (v2.02b)
# =============================================================================
# STANDALONE single-flow container. Serves the 5-agent flow plus the
# dashboard-data and chat routes the OpEx Tower front-end requires.
#
# Build context: the backend/ directory. This Dockerfile lives at
# backend/Dockerfile, so `docker build ./backend` (as in deploy.sh) works.
#
# Cloud Build (from the backend/ directory):
#   gcloud builds submit . \
#     --tag <REGION>-docker.pkg.dev/<PROJECT>/tiger-agents/orchestrator:v2.02b
#
# NOTE: do not COPY any service-account key into the image. Cloud Run uses
# the attached service account automatically.
# =============================================================================

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY code/orchestrator_service/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
 && pip install -r /app/requirements.txt

# Agent tools (the single tool layer — sits at /app so it imports flat)
COPY code/agent_tools.py /app/agent_tools.py

# Orchestrator service modules
COPY code/orchestrator_service/schemas.py          /app/schemas.py
COPY code/orchestrator_service/agents.py           /app/agents.py
COPY code/orchestrator_service/orchestrator.py     /app/orchestrator.py
COPY code/orchestrator_service/firestore_client.py /app/firestore_client.py
COPY code/orchestrator_service/bigquery_client.py  /app/bigquery_client.py
COPY code/orchestrator_service/data_pipeline.py    /app/data_pipeline.py
COPY code/orchestrator_service/fulfillment_optimizer.py /app/fulfillment_optimizer.py
COPY code/orchestrator_service/main.py             /app/main.py

# Static config (freight-cost lookup table for the fulfillment LP)
COPY code/orchestrator_service/config/ /app/config/
ENV FREIGHT_COSTS_PATH=/app/config/freight_costs.json

# Agent system prompts (loaded by name at agent init)
COPY agents/ /app/agents/

ENV PROMPTS_DIR=/app/agents

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

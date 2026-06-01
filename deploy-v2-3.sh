#!/usr/bin/env bash
# =============================================================================
# Phase 5.1 — deploy cfr-ui-v2-3 alongside the existing tiger-frontend (v2.1).
# =============================================================================
# The v2.1 frontend (tiger-frontend) is NOT touched. Users get two URLs:
#   v2.1 → https://tiger-frontend-xxx.run.app  (express proxy → backend)
#   v2.3 → https://cfr-ui-v2-3-xxx.run.app     (direct: VITE_API_BASE_URL)
#
# Both share the same backend service (tiger-orchestrator).
#
# Prerequisites (one-time):
#   gcloud auth login
#   gcloud config set project ${PROJECT_ID}
#   gcloud auth configure-docker ${REGION}-docker.pkg.dev
#   gcloud artifacts repositories create tiger-agents \
#     --repository-format=docker --location=${REGION}
#
# Usage:
#   ./deploy-v2-3.sh                          # uses defaults
#   PROJECT_ID=my-project ./deploy-v2-3.sh
#   COMMIT_SHA=$(git rev-parse HEAD) ./deploy-v2-3.sh
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-resilience-riskradar}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-tiger-agents}"
SERVICE="${SERVICE:-cfr-ui-v2-3}"
BACKEND_SERVICE="${BACKEND_SERVICE:-tiger-orchestrator}"

# Service account: defaults to the same one the v2.1 frontend uses. Discover
# it from tiger-frontend if not overridden, falling back to empty (which
# leaves Cloud Run to use the project default compute SA).
if [[ -z "${SERVICE_ACCOUNT:-}" ]]; then
  SERVICE_ACCOUNT=$(gcloud run services describe tiger-frontend \
    --region="${REGION}" --project="${PROJECT_ID}" \
    --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || echo "")
fi

COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo "manual-$(date +%s)")}"

echo "================================================================"
echo "  Tiger Foods — Phase 5.1 (cfr-ui-v2-3 cutover)"
echo "  Project        : ${PROJECT_ID}"
echo "  Region         : ${REGION}"
echo "  v2.3 service   : ${SERVICE}"
echo "  Backend service: ${BACKEND_SERVICE}"
echo "  Service account: ${SERVICE_ACCOUNT:-<project default>}"
echo "  Commit         : ${COMMIT_SHA}"
echo "================================================================"
echo ""

# ── Step 1: Discover the backend Cloud Run URL ────────────────────────────────
echo "[1/2] Looking up ${BACKEND_SERVICE} URL..."
BACKEND_URL=$(gcloud run services describe "${BACKEND_SERVICE}" \
  --region="${REGION}" --project="${PROJECT_ID}" \
  --format='value(status.url)')
if [[ -z "${BACKEND_URL}" ]]; then
  echo "ERROR: could not find ${BACKEND_SERVICE} in ${REGION}. Deploy it first via ./deploy.sh."
  exit 1
fi
echo "      Backend URL: ${BACKEND_URL}"

# ── Step 2: Trigger Cloud Build with the discovered URL ──────────────────────
echo "[2/2] Submitting Cloud Build (cfr-ui-v2-3 → ${BACKEND_URL})..."
echo ""

SUBSTITUTIONS="_BACKEND_URL=${BACKEND_URL},_REGION=${REGION},_REPO=${REPO},_SERVICE=${SERVICE}"
if [[ -n "${SERVICE_ACCOUNT}" ]]; then
  SUBSTITUTIONS="${SUBSTITUTIONS},_SERVICE_ACCOUNT=${SERVICE_ACCOUNT}"
fi

gcloud builds submit ./frontend \
  --config=frontend/cloudbuild-v2-3.yaml \
  --project="${PROJECT_ID}" \
  --substitutions="${SUBSTITUTIONS},COMMIT_SHA=${COMMIT_SHA}"

# ── Done — print URLs ────────────────────────────────────────────────────────
V23_URL=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT_ID}" \
  --format='value(status.url)')

V21_URL=$(gcloud run services describe tiger-frontend \
  --region="${REGION}" --project="${PROJECT_ID}" \
  --format='value(status.url)' 2>/dev/null || echo "<not deployed>")

echo ""
echo "================================================================"
echo "  Deployment complete — both frontends are live."
echo "  v2.1 (tiger-frontend) : ${V21_URL}"
echo "  v2.3 (${SERVICE})     : ${V23_URL}"
echo "  Backend (shared)      : ${BACKEND_URL}"
echo "================================================================"
echo ""
echo "Verify v2.3 health:"
echo "  curl -s ${V23_URL}/healthz | jq"
echo ""
echo "Expected response:"
echo "  { \"status\": \"ok\", \"commit\": \"${COMMIT_SHA}\", \"backend_url\": null, \"proxy_mode\": false, ... }"

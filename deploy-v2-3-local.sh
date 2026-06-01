#!/usr/bin/env bash
# =============================================================================
# Tiger Foods Agentic AI — v2.3 frontend deploy (LOCAL DOCKER, no Cloud Build)
# =============================================================================
# Mirrors deploy.sh's proven local-docker pattern (build → push → gcloud run
# deploy) but ships ONLY the v2.3 frontend as a separate Cloud Run service
# (cfr-ui-v2-3) alongside the existing backend. Avoids Cloud Build entirely,
# so no substitution-template pitfalls.
#
# Architecture (matches deploy.sh's frontend step):
#   - The image is built WITHOUT VITE_API_BASE_URL, so the bundle falls back
#     to '/api' and the in-image express proxy (server.js) forwards /api/*
#     to BACKEND_URL at runtime. server.js already sets a 10-minute proxy
#     timeout, so the 200s+ /v23/triage agent runs are not cut off.
#   - The existing backend (tiger-orchestrator) is reused, not redeployed,
#     unless you set DEPLOY_BACKEND=1 (useful to ship backend source fixes).
#
# Prerequisites:
#   gcloud auth login
#   gcloud auth configure-docker ${REGION}-docker.pkg.dev
#   The backend service (tiger-orchestrator) must already be deployed
#     (run ./deploy.sh once if not).
#
# Usage:
#   ./deploy-v2-3-local.sh                       # build + deploy v2.3 frontend
#   PROJECT_ID=my-project ./deploy-v2-3-local.sh
#   TAG=v2.3.1 ./deploy-v2-3-local.sh
#   DEPLOY_BACKEND=1 ./deploy-v2-3-local.sh       # also rebuild + redeploy backend
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-resilience-riskradar}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-tiger-agents}"
TAG="${TAG:-latest}"

BACKEND_SERVICE="${BACKEND_SERVICE:-tiger-orchestrator}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-cfr-ui-v2-3}"

# Backend deploy is opt-in. Set DEPLOY_BACKEND=1 to rebuild + redeploy it
# (picks up backend source changes, e.g. agent_tools.py / _v23_adapter.py fixes).
DEPLOY_BACKEND="${DEPLOY_BACKEND:-0}"
AI_PROVIDER="${AI_PROVIDER:-gemini}"
AGENT_CONCURRENCY="${AGENT_CONCURRENCY:-1}"
TOOL_ROW_CAP="${TOOL_ROW_CAP:-50}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
BACKEND_IMAGE="${REGISTRY}/orchestrator:${TAG}"
FRONTEND_IMAGE="${REGISTRY}/${FRONTEND_SERVICE}:${TAG}"

COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo "manual-$(date +%s)")}"
BUILD_ID="${BUILD_ID:-$(date +%s)}"

echo "================================================================"
echo "  Tiger Foods — v2.3 frontend deploy (local docker)"
echo "  Project        : ${PROJECT_ID}"
echo "  Region         : ${REGION}"
echo "  Registry       : ${REGISTRY}"
echo "  v2.3 service    : ${FRONTEND_SERVICE}"
echo "  Backend service : ${BACKEND_SERVICE}"
echo "  Tag             : ${TAG}"
echo "  Commit          : ${COMMIT_SHA}"
echo "  Redeploy backend: ${DEPLOY_BACKEND}"
echo "================================================================"
echo ""

# ── Optional: rebuild + redeploy backend ──────────────────────────────────────
if [[ "${DEPLOY_BACKEND}" == "1" ]]; then
  echo "[backend] Building image..."
  docker build -t "${BACKEND_IMAGE}" ./backend
  echo "[backend] Pushing image..."
  docker push "${BACKEND_IMAGE}"

  BACKEND_ENV="PROJECT_ID=${PROJECT_ID}"
  BACKEND_ENV="${BACKEND_ENV},GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"
  BACKEND_ENV="${BACKEND_ENV},GOOGLE_CLOUD_LOCATION=${REGION}"
  BACKEND_ENV="${BACKEND_ENV},REGION=${REGION}"
  BACKEND_ENV="${BACKEND_ENV},PROMPTS_DIR=/app/agents"
  BACKEND_ENV="${BACKEND_ENV},AI_PROVIDER=${AI_PROVIDER}"
  BACKEND_ENV="${BACKEND_ENV},GOOGLE_GENAI_USE_VERTEXAI=1"
  BACKEND_ENV="${BACKEND_ENV},OTEL_SDK_DISABLED=true"
  BACKEND_ENV="${BACKEND_ENV},AGENT_CONCURRENCY=${AGENT_CONCURRENCY}"
  BACKEND_ENV="${BACKEND_ENV},TOOL_ROW_CAP=${TOOL_ROW_CAP}"

  echo "[backend] Deploying Cloud Run service..."
  gcloud run deploy "${BACKEND_SERVICE}" \
    --image="${BACKEND_IMAGE}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --platform=managed \
    --allow-unauthenticated \
    --port=8080 \
    --memory=4Gi \
    --cpu=2 \
    --timeout=600 \
    --concurrency=10 \
    --min-instances=0 \
    --max-instances=10 \
    --set-env-vars="${BACKEND_ENV}" \
    --clear-secrets \
    --quiet
fi

# ── Step 1: Look up the backend URL to wire into the frontend ─────────────────
echo "[1/4] Looking up ${BACKEND_SERVICE} URL..."
BACKEND_URL=$(gcloud run services describe "${BACKEND_SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")
if [[ -z "${BACKEND_URL}" ]]; then
  echo "ERROR: could not find ${BACKEND_SERVICE} in ${REGION}."
  echo "       Deploy it first (./deploy.sh) or run with DEPLOY_BACKEND=1."
  exit 1
fi
echo "      Backend URL: ${BACKEND_URL}"

# ── Step 2: Build the v2.3 frontend image (local docker) ──────────────────────
# No VITE_API_BASE_URL build-arg → bundle uses '/api' → express proxy →
# BACKEND_URL at runtime. GIT_COMMIT_SHA + BUILD_ID are baked for /healthz
# and the client cache-bust.
echo "[2/4] Building frontend image (${FRONTEND_IMAGE})..."
docker build \
  --build-arg GIT_COMMIT_SHA="${COMMIT_SHA}" \
  --build-arg BUILD_ID="${BUILD_ID}" \
  -t "${FRONTEND_IMAGE}" \
  ./frontend

# ── Step 3: Push ──────────────────────────────────────────────────────────────
echo "[3/4] Pushing frontend image..."
docker push "${FRONTEND_IMAGE}"

# ── Step 4: Deploy frontend (public, express-proxy mode) ──────────────────────
echo "[4/4] Deploying ${FRONTEND_SERVICE} Cloud Run service (public)..."
gcloud run deploy "${FRONTEND_SERVICE}" \
  --image="${FRONTEND_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=600 \
  --concurrency=1000 \
  --min-instances=0 \
  --max-instances=5 \
  --set-env-vars="BACKEND_URL=${BACKEND_URL},GIT_COMMIT_SHA=${COMMIT_SHA},BUILD_ID=${BUILD_ID}" \
  --quiet

FRONTEND_URL=$(gcloud run services describe "${FRONTEND_SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo ""
echo "================================================================"
echo "  v2.3 deployment complete!"
echo "  v2.3 UI  : ${FRONTEND_URL}  (public)"
echo "  Backend  : ${BACKEND_URL}"
echo "  Healthz  : ${FRONTEND_URL}/healthz"
echo "================================================================"
echo ""
echo "Note: Cloud Run caps a single request at --timeout=600 (10 min); the"
echo "express proxy in server.js matches that. The /v23/triage agent run"
echo "(~200s) fits comfortably."
echo ""
echo "If frontend → backend calls fail with 403 (private backend), grant the"
echo "frontend SA the run.invoker role on the backend:"
echo "  FRONTEND_SA=\$(gcloud run services describe ${FRONTEND_SERVICE} \\"
echo "    --region=${REGION} --project=${PROJECT_ID} \\"
echo "    --format='value(spec.template.spec.serviceAccountName)')"
echo "  gcloud run services add-iam-policy-binding ${BACKEND_SERVICE} \\"
echo "    --region=${REGION} --member=\"serviceAccount:\${FRONTEND_SA}\" \\"
echo "    --role=roles/run.invoker"

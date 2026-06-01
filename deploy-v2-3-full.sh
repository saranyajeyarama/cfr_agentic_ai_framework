#!/usr/bin/env bash
# =============================================================================
# Tiger Foods Agentic AI — v2.3 FULL fresh deploy (backend + frontend)
# =============================================================================
# Builds and deploys a fully ISOLATED v2.3 stack as NEW Cloud Run services:
#
#   cfr-orchestrator-v2-3   ← backend  (built from ./backend, all fixes baked in)
#   cfr-ui-v2-3             ← frontend (built from ./frontend, express-proxy mode)
#
# Your existing v2.1 stack (tiger-orchestrator + tiger-frontend) is NOT
# touched — it keeps running on its own URLs. This is fully reversible:
# delete the two cfr-*-v2-3 services to roll back.
#
# Local docker build/push/deploy (NO Cloud Build) — avoids substitution
# template pitfalls entirely.
#
# Frontend wiring: the image is built WITHOUT VITE_API_BASE_URL, so the
# bundle uses '/api' and the in-image express proxy (server.js) forwards
# /api/* to the new backend's URL at runtime. server.js sets a 10-minute
# proxy timeout, so the ~200s /v23/triage agent run is not cut off.
#
# Prerequisites:
#   gcloud auth login
#   gcloud auth configure-docker ${REGION}-docker.pkg.dev
#   (Artifact Registry repo "tiger-agents" already exists — it does, the
#    v2.1 images live there.)
#
# Usage:
#   ./deploy-v2-3-full.sh
#   PROJECT_ID=my-project ./deploy-v2-3-full.sh
#   TAG=v2.3.0 ./deploy-v2-3-full.sh           # immutable tag instead of latest
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-resilience-riskradar}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-tiger-agents}"
TAG="${TAG:-latest}"

# NEW isolated v2.3 service + image names.
BACKEND_SERVICE="${BACKEND_SERVICE:-cfr-orchestrator-v2-3}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-cfr-ui-v2-3}"

# Reference v2.1 backend — only used to copy its runtime service account so the
# new backend gets identical BigQuery / Vertex AI / Firestore permissions.
REF_BACKEND_SERVICE="${REF_BACKEND_SERVICE:-tiger-orchestrator}"

AI_PROVIDER="${AI_PROVIDER:-gemini}"
AGENT_CONCURRENCY="${AGENT_CONCURRENCY:-1}"
TOOL_ROW_CAP="${TOOL_ROW_CAP:-50}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
BACKEND_IMAGE="${REGISTRY}/${BACKEND_SERVICE}:${TAG}"
FRONTEND_IMAGE="${REGISTRY}/${FRONTEND_SERVICE}:${TAG}"

COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo "manual-$(date +%s)")}"
BUILD_ID="${BUILD_ID:-$(date +%s)}"

# Discover the SA the existing v2.1 backend runs as, so the new backend has the
# same data-plane permissions. Falls back to empty (project default compute SA).
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-}"
if [[ -z "${SERVICE_ACCOUNT}" ]]; then
  SERVICE_ACCOUNT=$(gcloud run services describe "${REF_BACKEND_SERVICE}" \
    --region="${REGION}" --project="${PROJECT_ID}" \
    --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || echo "")
fi

echo "================================================================"
echo "  Tiger Foods — v2.3 FULL fresh deploy (isolated)"
echo "  Project          : ${PROJECT_ID}"
echo "  Region           : ${REGION}"
echo "  Registry         : ${REGISTRY}"
echo "  Backend service  : ${BACKEND_SERVICE}   (NEW)"
echo "  Frontend service : ${FRONTEND_SERVICE}   (NEW)"
echo "  Service account  : ${SERVICE_ACCOUNT:-<project default compute SA>}"
echo "  Tag              : ${TAG}"
echo "  Commit           : ${COMMIT_SHA}"
echo "================================================================"
echo ""

SA_FLAG=()
if [[ -n "${SERVICE_ACCOUNT}" ]]; then
  SA_FLAG=(--service-account="${SERVICE_ACCOUNT}")
fi

# ── Step 1: Build + push backend ──────────────────────────────────────────────
echo "[1/6] Building backend image (${BACKEND_IMAGE})..."
docker build -t "${BACKEND_IMAGE}" ./backend

echo "[2/6] Pushing backend image..."
docker push "${BACKEND_IMAGE}"

# ── Step 2: Deploy backend (public) ───────────────────────────────────────────
# Env vars match the local docker-compose stack + deploy.sh so behavior is
# identical. Vertex AI Gemini is the default provider.
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

echo "[3/6] Deploying backend Cloud Run service (${BACKEND_SERVICE}, public)..."
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
  "${SA_FLAG[@]}" \
  --quiet

# ── Step 3: Capture the NEW backend URL ───────────────────────────────────────
echo "[4/6] Retrieving ${BACKEND_SERVICE} URL..."
BACKEND_URL=$(gcloud run services describe "${BACKEND_SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")
if [[ -z "${BACKEND_URL}" ]]; then
  echo "ERROR: backend deployed but URL lookup failed."
  exit 1
fi
echo "      Backend URL: ${BACKEND_URL}"

# ── Step 4: Build + push frontend ─────────────────────────────────────────────
# No VITE_API_BASE_URL build-arg → bundle uses '/api' → express proxy →
# BACKEND_URL at runtime. GIT_COMMIT_SHA + BUILD_ID are baked for /healthz +
# client cache-bust.
echo "[5/6] Building frontend image (${FRONTEND_IMAGE})..."
docker build \
  --build-arg GIT_COMMIT_SHA="${COMMIT_SHA}" \
  --build-arg BUILD_ID="${BUILD_ID}" \
  -t "${FRONTEND_IMAGE}" \
  ./frontend

echo "[5/6] Pushing frontend image..."
docker push "${FRONTEND_IMAGE}"

# ── Step 5: Deploy frontend (public, points at the NEW backend) ───────────────
echo "[6/6] Deploying frontend Cloud Run service (${FRONTEND_SERVICE}, public)..."
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
echo "  v2.3 fresh deployment complete!"
echo "  v2.3 UI      : ${FRONTEND_URL}   (public)"
echo "  v2.3 Backend : ${BACKEND_URL}    (public)"
echo "  Healthz      : ${FRONTEND_URL}/healthz"
echo ""
echo "  v2.1 (untouched):"
echo "    tiger-frontend / tiger-orchestrator remain on their own URLs."
echo "================================================================"
echo ""
echo "Smoke test:"
echo "  curl -s ${BACKEND_URL}/health"
echo "  curl -s '${FRONTEND_URL}/api/v23/orders?limit=2' | head -c 300"

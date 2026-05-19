#!/usr/bin/env bash
# =============================================================================
# Tiger Foods Agentic AI — Cloud Run deployment
# =============================================================================
# Builds both images, pushes to Artifact Registry, deploys backend (private)
# then frontend (public) with BACKEND_URL automatically wired in.
#
# Prerequisites:
#   gcloud auth login
#   gcloud auth configure-docker ${REGION}-docker.pkg.dev
#   gcloud artifacts repositories create tiger-agents \
#     --repository-format=docker --location=${REGION} --project=${PROJECT_ID}
#   bash backend/infra/iam.sh   # sets up service account + IAM roles
#
# Usage:
#   ./deploy.sh                       # use defaults below
#   PROJECT_ID=my-project ./deploy.sh
#   TAG=v2.1.0 ./deploy.sh
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-resilience-riskradar}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-tiger-agents}"
TAG="${TAG:-latest}"
BACKEND_SA="tiger-agents-sa@${PROJECT_ID}.iam.gserviceaccount.com"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
BACKEND_IMAGE="${REGISTRY}/orchestrator:${TAG}"
FRONTEND_IMAGE="${REGISTRY}/frontend:${TAG}"
BACKEND_SERVICE="tiger-orchestrator"
FRONTEND_SERVICE="tiger-frontend"

echo "======================================================="
echo "  Tiger Foods — Cloud Run Deployment"
echo "  Project  : ${PROJECT_ID}"
echo "  Region   : ${REGION}"
echo "  Registry : ${REGISTRY}"
echo "  Tag      : ${TAG}"
echo "======================================================="
echo ""

# ── Step 1: Build and push backend ────────────────────────────────────────────
echo "[1/5] Building backend image..."
docker build -t "${BACKEND_IMAGE}" ./backend

echo "[1/5] Pushing backend image..."
docker push "${BACKEND_IMAGE}"

# ── Step 2: Build and push frontend ───────────────────────────────────────────
echo "[2/5] Building frontend image..."
docker build -t "${FRONTEND_IMAGE}" ./frontend

echo "[2/5] Pushing frontend image..."
docker push "${FRONTEND_IMAGE}"

# ── Step 3: Deploy backend (private) ──────────────────────────────────────────
echo "[3/5] Deploying backend Cloud Run service (private)..."
gcloud run deploy "${BACKEND_SERVICE}" \
  --image="${BACKEND_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --platform=managed \
  --no-allow-unauthenticated \
  --port=8080 \
  --memory=2Gi \
  --cpu=2 \
  --timeout=300 \
  --concurrency=80 \
  --min-instances=0 \
  --max-instances=10 \
  --set-env-vars="PROJECT_ID=${PROJECT_ID},PROMPTS_DIR=/app/agents,AI_PROVIDER=claude${ANTHROPIC_API_KEY:+,ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}}" \
  --clear-secrets \
  --quiet

# ── Step 4: Capture backend URL ───────────────────────────────────────────────
echo "[4/5] Retrieving backend service URL..."
BACKEND_URL=$(gcloud run services describe "${BACKEND_SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo "      Backend URL: ${BACKEND_URL}"

# ── Step 5: Deploy frontend (public) ──────────────────────────────────────────
echo "[5/5] Deploying frontend Cloud Run service (public)..."
gcloud run deploy "${FRONTEND_SERVICE}" \
  --image="${FRONTEND_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60 \
  --concurrency=1000 \
  --min-instances=0 \
  --max-instances=5 \
  --set-env-vars="BACKEND_URL=${BACKEND_URL}" \
  --quiet

FRONTEND_URL=$(gcloud run services describe "${FRONTEND_SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo ""
echo "======================================================="
echo "  Deployment complete!"
echo "  Frontend : ${FRONTEND_URL}  (public)"
echo "  Backend  : ${BACKEND_URL}   (private)"
echo "======================================================="
echo ""
echo "One-time IAM grant (run once if frontend → backend calls fail with 403):"
echo "  FRONTEND_SA=\$(gcloud run services describe ${FRONTEND_SERVICE} \\"
echo "    --region=${REGION} --project=${PROJECT_ID} \\"
echo "    --format='value(spec.template.spec.serviceAccountName)')"
echo "  gcloud run services add-iam-policy-binding ${BACKEND_SERVICE} \\"
echo "    --region=${REGION} --member=\"serviceAccount:\${FRONTEND_SA}\" \\"
echo "    --role=roles/run.invoker"

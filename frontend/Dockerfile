FROM node:22-bullseye AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

# ─── Build-time variables ─────────────────────────────────────────────────────
# BUILD_ID: bakes a cache-busting identifier into the bundle so a new deploy
#   invalidates clients' sessionStorage (see src/lib/buildReset.ts).
# VITE_API_BASE_URL: optional — when set, Vite inlines it into the bundle and
#   the frontend calls the backend directly via that URL. When unset, the
#   bundle falls back to '/api' which the express proxy routes to BACKEND_URL.
#   Phase 5.1 (v2.3) sets this at Cloud Build time so the v2.3 deployment can
#   reach the backend without the runtime proxy hop.
# GIT_COMMIT_SHA: passed through to the runner image's environment so
#   /healthz can return it (commit traceability per Phase 5.1 spec).
ARG BUILD_ID
ARG VITE_API_BASE_URL=""
ARG GIT_COMMIT_SHA="unknown"

ENV BUILD_ID=${BUILD_ID}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV TAILWIND_DISABLE_OXIDE=1

RUN BUILD_ID="${BUILD_ID:-$(date +%s)}" npm run build
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:22-bullseye AS runner

WORKDIR /app

ENV NODE_ENV=production

# Promote GIT_COMMIT_SHA into the runtime image so /healthz reports it.
ARG GIT_COMMIT_SHA="unknown"
ARG BUILD_ID
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV BUILD_ID=${BUILD_ID}

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 8080

CMD ["npm", "start"]

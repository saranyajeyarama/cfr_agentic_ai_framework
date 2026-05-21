# Tiger Foods Customer Supply Agentic AI — v2.02

Standalone release. v2.02 is the v2.01 5-agent decision system **plus** the
dashboard and chat routes the OpEx Tower front-end requires, **plus** the
front-end changes that point the app at the real API contract.

One Cloud Run service now serves the whole application.

---

## What changed from v2.01

The agent core is byte-identical to v2.01. v2.02 adds:

- `GET /dashboard-data` — live `tiger_semantic` data for the dashboard
- `POST /chat` — the Nexus co-pilot (Gemini 2.5 Flash via Vertex AI)
- `OrderTriage.tsx` — `POST /sessions` rewritten to the real schema
  contract (the old field names would have failed backend validation)

Full detail in `CHANGELOG_v2_02.md`. The exact API spec is in
`API_CONTRACT_v2_02.md` — that is the reference for any further front-end
work.

## Package contents

```
tiger_foods_agent_v2_02/
├── code/
│   ├── agent_tools.py                  Tool layer (unchanged from v2.01)
│   └── orchestrator_service/
│       ├── main.py                     FastAPI service — all routes
│       ├── orchestrator.py             5-agent orchestration (unchanged)
│       ├── agents.py                   ADK agent factory (unchanged)
│       ├── schemas.py                  Pydantic contracts + chat schemas
│       ├── data_pipeline.py            BigQuery → dashboard JSON  [verified]
│       ├── firestore_client.py
│       ├── bigquery_client.py
│       ├── requirements.txt
│       └── Dockerfile
├── agents/                             5 agent prompts (unchanged from v2.01)
├── infra/
│   └── dce_table_v2_01.sql             Writable decision-log table DDL
├── frontend/                           ONLY the changed front-end files
│   └── src/
│       ├── components/tabs/OrderTriage.tsx
│       └── data/mockData.json
├── API_CONTRACT_v2_02.md               The locked front-end ↔ backend spec
├── CHANGELOG_v2_02.md
└── README.md
```

## Deploying

**Backend** — same as v2.01, the build context is this package root:

```bash
# 1. Decision-log table (idempotent)
bq query --use_legacy_sql=false < infra/dce_table_v2_01.sql

# 2. Build
gcloud builds submit . \
  --tag us-central1-docker.pkg.dev/resilience-riskradar/tiger-agents/orchestrator:v2.02.0 \
  --file code/orchestrator_service/Dockerfile

# 3. Deploy
gcloud run deploy tiger-agents-orchestrator \
  --image us-central1-docker.pkg.dev/resilience-riskradar/tiger-agents/orchestrator:v2.02.0 \
  --region us-central1 \
  --service-account tiger-agents-sa@resilience-riskradar.iam.gserviceaccount.com \
  --set-env-vars PROJECT_ID=resilience-riskradar,REGION=us-central1,AI_PROVIDER=gemini \
  --no-allow-unauthenticated --memory 2Gi --cpu 2 --timeout 600
```

**Front-end** — drop the two files in `frontend/src/` into the existing
OpEx Tower app, replacing their namesakes:

```
frontend/src/components/tabs/OrderTriage.tsx   → replace
frontend/src/data/mockData.json                → replace
```

Then point the app at the backend. The Express server reads `BACKEND_URL`:

```bash
gcloud run deploy opex-tower-frontend \
  --set-env-vars BACKEND_URL=https://<orchestrator-service-url>
```

Nothing else in the app changes. The five tabs, the Nexus chat, the map —
all unchanged; they now call a backend that answers every route.

## Status

Schema-verified, not data-verified. All SQL — agent tools and the dashboard
pipeline — was checked against the semantic-layer column dictionary. None
of it has been executed against live `tiger_semantic` data, which must be
populated first. The first run is an integration test for the AI/ML team.

## Next: feature iteration

The five tabs now run on the real contract. Deeper features — richer agent
visibility, new visualizations, per-specialist drill-downs — are the next
phase. `API_CONTRACT_v2_02.md` is the spec to build them against; nothing
should reintroduce the old `customer_kunnr` / `material_matnr` field names.







Here's the step-by-step for deploying **tiger-frontend** from the UI using continuous deployment:

**On the "Create service" screen you're on:**

1. Select **"Continuously deploy from a repository"** (the GitHub/GitLab/Bitbucket option)

2. Click **"Set up with Cloud Build"** → it opens a side panel

3. **Repository Provider** — pick **GitHub** (or wherever your repo is hosted)

4. **Authenticate** — sign into GitHub and grant access to the repo

5. **Select repository** — choose your `cfr_agentic_ai_framework_v2_02` repo

6. **Branch** — select `main` (or whichever branch you deploy from)

7. **Build Type** — select **Dockerfile**

8. **Source location** — set to `/frontend/Dockerfile` (path within the repo)

9. Click **Save**

**Back on the main Create service screen:**

10. **Service name** — `tiger-frontend`

11. **Region** — `us-central1`

12. Scroll down to **"Authentication"** — select **"Allow unauthenticated invocations"**

13. Expand **"Container, Networking, Security"** tab:
    - **Container port**: `8080`
    - **Memory**: `512Mi`
    - **CPU**: `1`
    - Under **"Variables & Secrets"** tab, add environment variable:
      - `BACKEND_URL` = `https://tiger-orchestrator-182983932769.us-central1.run.app`

14. Click **Create**

---

**Repeat the same for tiger-orchestrator**, but with these differences:
- **Source location**: `/backend/Dockerfile`
- **Service name**: `tiger-orchestrator`
- **Authentication**: **"Require authentication"**
- **Memory**: `4Gi`, **CPU**: `2`
- **Environment variables**: all the backend vars (PROJECT_ID, AI_PROVIDER, etc.)

---

After setup, every push to `main` will auto-trigger a new build and deployment for each service.
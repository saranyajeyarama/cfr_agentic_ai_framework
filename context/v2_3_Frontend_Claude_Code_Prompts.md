# v2.3 Frontend Upgrade — Claude Code Prompt Sequence

**Purpose:** Transform the AI Studio iteration of the front-end
(`mars-supply-ai-v2_02-restyled.jsx`) into a Vite+React+TypeScript project
wired to the live backend. **Live-only architecture — no mock data, no
data-source toggle, no demo-deploy path.**

**Audience:** Narendra (or any engineer) running Claude Code, Cursor, or
similar AI coding tool against the v2.3 frontend repo.

**Total time:** ~3–5 focused hours (simpler than the mock-toggle plan).

---

## Before you start

1. **Have these files in the AI tool's context:**
   - `mars-supply-ai-v2_02-restyled.jsx` (the AI Studio source — visual
     reference only, data fixtures will be discarded)
   - `v2_3_Backend_Contract_Mapping.xlsx` (the Field Mapping tab is the
     spec)
   - This prompt sequence
   - The backend zip so the tool can see the new routes (`/v23/orders`,
     `/v23/triage/{id}`, `/data-health`) + `_v23_adapter.py`

2. **Confirm with Joe before starting:**
   - Repo name (recommendation: `cfr-tiger-foods-ui-v2-3`)
   - Backend dev URL (the Cloud Run URL with v2.3 routes deployed)

3. **Manual prerequisite:**
   - Deploy the backend zip to a dev Cloud Run service
   - Verify with three curl checks: `/health`, `/v23/orders?limit=3`,
     `/data-health`

---

## Architectural ground rules (READ FIRST)

- **No mock data in the repo.** Do NOT create a `mock/` folder. Do NOT
  extract the AI Studio source's hardcoded constants (ORDERS, SYNTHESIS,
  STEPS, WATCHTOWER_DATA, etc.) to JSON files. Treat them as visual /
  shape reference only — once you've understood the shape, they go away.
- **No `VITE_DATA_SOURCE` toggle.** Every API call is live. No
  conditional logic, no fallbacks.
- **Screens with no live backend route get HIDDEN from navigation.**
  Do not show a screen backed by fake data. (See Phase 0.4 for which
  ones to hide.)
- **If the backend is unreachable, show an error state.** Same as any
  real production app. Don't pretend with mock data.

---

## Phase 0 — Project restructuring (~2 hours)

### Prompt 0.1 — Fork the v2.1 frontend skeleton
```
Create the v2.3 frontend repo by FORKING the existing v2.1 frontend
project skeleton at cfragent/frontend/. Do NOT bootstrap a new Vite
project from scratch — the v2.1 project has a proven Vite + React +
TypeScript + Tailwind setup with Dockerfile + server.js + deploy.sh
that we want to reuse for the v2.3 deploy.

Steps:
1. Copy the entire cfragent/frontend/ directory tree to the new
   cfr-tiger-foods-ui-v2-3/ repo.
2. KEEP UNCHANGED:
   - package.json (the dependency list — Tailwind, React 19, recharts,
     lucide-react, motion, react-simple-maps are all there)
   - package-lock.json
   - tsconfig.json
   - vite.config.ts
   - Dockerfile
   - server.js
   - deploy.sh
   - .gitignore
   - public/
3. CLEAR src/ entirely. We're keeping the project shell but replacing
   the UI. Create the new src/ structure:
     src/
       main.tsx
       App.tsx
       components/
         layout/
           TopBar.tsx
           Sidebar.tsx
           NexusCoPilot.tsx
         tabs/
           Watchtower.tsx
           OrderTriage.tsx
           FulfillmentSimulator.tsx
           RootCauseHub.tsx
           SafetyStockOptimizer.tsx
           DecisionLog.tsx
           ManagerDashboard.tsx
           DataHealthPage.tsx
         primitives/
           (the small helpers extracted from the AI Studio source)
       lib/
         api.ts             ALL backend calls go through here
         constants.ts       palette + font tokens (as Tailwind config
                            extensions, not inline-style consts)
         types.ts           TypeScript types matching the v2.3 contract

4. Put the AI Studio source file at /reference/original_ai_studio.jsx
   for visual reference. Delete after Phase 4 verification.

5. Update package.json "name" field to "cfr-tiger-foods-ui-v2-3" (or
   the agreed repo name). Everything else in package.json stays
   exactly as-is.

Do NOT create a mock/ folder. Do NOT extract any hardcoded data
constants (ORDERS, SYNTHESIS, STEPS, WATCHTOWER_DATA, etc.) into the
new repo — they exist in the AI Studio source for shape reference,
nothing more.
```

### Prompt 0.2 — Extract the components (visual only — no data)
```
Walk through mars-supply-ai-v2_02-restyled.jsx top to bottom. For each
function/component declaration, move it to the appropriate file from
Prompt 0.1's structure.

Rules:
1. Convert JSX → TSX with minimal type annotations on props.
2. Keep the inline-style approach. Aesthetic must remain identical —
   the AI Studio aesthetic was curated deliberately and must survive
   the transformation unchanged. Do NOT migrate to Tailwind utility
   classes even though the v2.1 frontend uses Tailwind. The v2.3 UI's
   visual identity stays as-shipped.
3. The C palette + MONO go in lib/constants.ts.
4. For each component, REPLACE every reference to the hardcoded data
   constants (ORDERS, SYNTHESIS, STEPS, etc.) with a placeholder
   reading from local component state:
     - const [orders, setOrders] = useState<Order[]>([])
     - const [synthesis, setSynthesis] = useState<Synthesis|null>(null)
     - (etc per screen)
   Initially the state is empty. Phase 1 / 2 wire up the actual
   fetches.
5. Confirm each component renders WITHOUT data (an empty Order Triage
   queue should show an empty state, not crash).
```

### Prompt 0.3 — Build the api.ts client (live-only)
```
Build src/lib/api.ts. Central client for ALL backend calls.

Environment variables:
  VITE_API_BASE_URL — e.g. https://cfr-tiger-foods-xxx.run.app
                       (required — no fallback)

Functions:

  fetchOrders(limit?: number): Promise<Order[]>
    → GET ${VITE_API_BASE_URL}/v23/orders?limit=${limit || 10}
    Returns response.orders[]

  triageOrder(orderId: string, backend: BackendPayload): Promise<TriageResponse>
    → POST ${VITE_API_BASE_URL}/v23/triage/${orderId}
    Body: backend
    Returns: { order_id, session_id, synthesis }

  fetchDashboard(): Promise<DashboardData>
    → GET ${VITE_API_BASE_URL}/dashboard-data
    Cache for 60s to avoid hammering on tab switches

  fetchDataHealth(): Promise<DataHealthResponse>
    → GET ${VITE_API_BASE_URL}/data-health
    Returns: { sources[], summary, reference_time_utc }

  fetchSimulatorIncidents(): Promise<SimulatorIncident[]>
    → GET ${VITE_API_BASE_URL}/fulfillment/incidents

  simulateFulfillment(req: SimulateRequest): Promise<SimulateResponse>
    → POST ${VITE_API_BASE_URL}/fulfillment/simulate

  chatNexus(message: string, history: ChatMessage[]): Promise<string>
    → POST ${VITE_API_BASE_URL}/chat
    Body: { message, history }
    Returns response.reply

  approveSession(sessionId: string, userId: string): Promise<void>
    → POST ${VITE_API_BASE_URL}/sessions/${sessionId}/approve

  rejectSession(sessionId: string, userId: string, reason: string): Promise<void>
    → POST ${VITE_API_BASE_URL}/sessions/${sessionId}/reject

Error handling pattern:
  - HTTP 422 → throw a typed ValidationError with response.detail
  - HTTP 5xx → throw a generic BackendError
  - Network failure (no response) → throw a NetworkError
  - Components catch and render an error state — DO NOT fall back to
    static data

types.ts holds:
  Order, BackendPayload, TriageResponse, Synthesis, SpecialistSignal,
  Conflict, Recommendation, ReasoningChain, Escalation, DashboardData,
  DataHealthResponse, DataHealthSource, SimulatorIncident,
  SimulateRequest, SimulateResponse, ChatMessage

Pull field names from v2_3_Backend_Contract_Mapping.xlsx Field Mapping
tab — that is the source of truth.
```

### Prompt 0.4 — Hide screens with no live backend
```
The AI Studio source has 5 screens with no live backend equivalent.
Remove them from the v2.3 navigation entirely until Phase 2 work adds
backend routes for them:

REMOVE from sidebar / navigation:
  - Supply Planning agent page
  - Demand Planning agent page
  - Transportation agent page
  - Retail Intelligence agent page
  - Data Dictionary

DELETE the corresponding tab .tsx files. The source code stays at
/reference/original_ai_studio.jsx if anyone wants to revive these in
Phase 2.

Update src/types.ts ScreenId union to only include screens with live
backends:
  type ScreenId = "watchtower" | "triage" | "simulator" | "rootcause"
                | "safetystock" | "decisions" | "manager" | "datahealth"

App.tsx routing renders ONLY these screens.
```

**End of Phase 0** — Project structured, components extracted, api.ts ready, dead
screens removed, no mock data anywhere. App should render with empty states.

---

## Phase 1 — Wire the read-only dashboards (~45 min)

### Prompt 1.1 — Watchtower / Safety Stock / Root Cause / Decisions / Manager Dashboard
```
Wire these screens to /dashboard-data via api.ts. Single fetch shared
across them — use a React context or SWR-style cache.

Pattern per component:
  const [data, setData] = useState<DashboardData|null>(null)
  const [err, setErr] = useState<string|null>(null)
  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch(e => setErr(e.message))
  }, [])

Screens:
  Watchtower.tsx              → data.globalKPIs, data.alerts, data.networkNodes
  SafetyStockOptimizer.tsx    → data.safetyStockRecommendations
  RootCauseHub.tsx            → data.rootCauseSummary
  DecisionLog.tsx             → data.decisionCaptureLog
  ManagerDashboard.tsx        → composite from all of the above

Loading state: gray skeleton blocks for ~2-5s while fetch runs.
Error state: inline error message with retry button.
No mock fallback. If fetch fails, the screen shows an error — that's
intentional, the planner needs to know the backend is unreachable.
```

### Prompt 1.2 — Data Health page
```
Wire DataHealthPage.tsx to /data-health.

Pattern:
  const [health, setHealth] = useState<DataHealthResponse|null>(null)
  useEffect(() => {
    fetchDataHealth().then(setHealth).catch(setErr)
  }, [])

Render the AI Studio's Data Health visual exactly (sources grouped by
agent, per-source row with: name, source_system, last_modified, age,
expected_refresh_hours, status). Map status to colors:
  FRESH    → green
  WARNING  → orange
  STALE    → red
  MISSING  → gray

Show the summary tiles at the top (Total, Fresh, Warning, Stale counts)
from response.summary.

Reference time at the bottom: response.reference_time_utc.
```

---

## Phase 3 — Fulfillment Simulator (~half day)

### Prompt 3.1
```
Wire FulfillmentSimulator.tsx to /fulfillment/incidents +
/fulfillment/simulate.

Step 1 — incidents list:
  fetchSimulatorIncidents() on mount, render the cards.

Step 2 — scenario simulation:
  On user click "Simulate":
    simulateFulfillment({ incident_id: i.id, ... })
  Render returned scenarios (Default Route, Optimal Alternate).

Step 3 — recommended action:
  Highlight s
## Phase 2 — Order Triage hero screen (~half day)

### Prompt 2.1
```
Wire Order Triage to /v23/orders + /v23/triage/{id}.

Step 1 — orders queue:
  - On mount: fetchOrders(20)
  - Render with v2.3 ORDERS shape (id, customer, sku, qty, flag,
    flag_type) — fields documented in contract mapping
  - User clicks an order → hold full row (including _backend) in state

Step 2 — agent evaluation:
  - User clicks "Evaluate":
      triageOrder(order.id, order._backend)
  - This blocks 30-180s. Show a loading state:
      * 4 agent cards show "evaluating..." with streaming dots
      * Wall-clock timer so user knows elapsed time
      * Cancel button (calls AbortController on the fetch)
  - Response arrives → populate:
      * agent signal cards from response.synthesis.signals
      * conflict banner from response.synthesis.conflicts[0]
      * recommendation card from response.synthesis.rec
      * reasoning chain + escalations panels

Step 3 — decision capture:
  - Approve: approveSession(response.session_id, userId)
  - Reject: open modal asking for reason, then
            rejectSession(response.session_id, userId, reason)
  - On success, navigate back to queue and refresh fetchOrders()
    so the just-decided order is removed

Error handling:
  - 422 → show response.detail with "try another order" CTA
  - 5xx → show "agent flow failed" with session_id for debugging
  - Timeout (>180s) → show "agents still running — session_id={id}"
```

---
cenarios[i].is_recommended visually.
  "Apply this plan" button is informational only (no execute endpoint).
```

---

## Phase 4 — Nexus Co-Pilot via backend proxy (~1 hour)

### Prompt 4.1
```
Wire NexusCoPilot.tsx to /chat:

chatNexus(userMessage, conversationHistory) sends a POST to /chat
on the backend. The backend service account holds Vertex credentials —
NO Gemini API key in the v2.3 frontend, anywhere.

REMOVE all references to:
  - NEXUS_API_KEY constant in the AI Studio source
  - import.meta.env.VITE_GEMINI_API_KEY (not used in v2.3)
  - The direct generativelanguage.googleapis.com fetch
  - buildNexusContext() — backend builds the system prompt now

The frontend just sends user messages; the backend handles everything
else. Conversation history is held in component state and passed in
the request body so the backend can stitch it into the prompt.
```

---

## Phase 5 — Cutover (operational)

### Prompt 5.1 — Deploy alongside v2.1
```
Add Dockerfile + cloudbuild.yaml to deploy as a second Cloud Run
service called cfr-ui-v2-3 (or your team's chosen name):

- Vite build → dist/
- Serve via nginx or tiny Express
- Service account = same as v2.1 frontend
- Environment variables baked at build time:
    VITE_API_BASE_URL=https://cfr-tiger-foods-xxx.run.app

The v2.1 frontend stays deployed unchanged. Users have two URLs.

Add a /healthz endpoint returning 200 + git commit SHA for the build.
```

---

## Smoke tests

### After Phase 0
- App boots, all live-route screens render with empty states
- Hidden screens (per-agent, Data Dictionary) gone from navigation
- No console errors

### After Phase 1
- Watchtower / SafetyStock / RootCause / Decisions / Manager Dashboard
  show real BigQuery data
- Data Health page shows real per-view freshness with status colors
- Backend down → all screens show error state, no fallback to mock

### After Phase 2
- Click an order → 30-180s wait → real agent reasoning appears
- Approve → row in tiger_decisions.fct_allocation_decisions

### After Phase 3
- Simulator shows real incidents + LP allocations

### After Phase 4
- Co-pilot chat works
- No Gemini API key visible in browser dev tools Network tab

### After Phase 5
- Two URLs live (v2.1 + v2.3)
- v2.3 against live backend, no mock data anywhere
- /healthz on v2.3 returns the build SHA

---

## What this sequence deliberately does NOT include

- Mock data / data-source toggle / demo deploy
- Tailwind / styling refactor
- TypeScript strict mode (start permissive, tighten later)
- Test suite (defer to Phase 6)
- The observability layer (separate ADR-001 workstream)
- The 5 hidden screens (Phase 2 backend work needed first)

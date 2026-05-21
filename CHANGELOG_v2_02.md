# CHANGELOG — v2.02

## v2.02 — Front-end stitched to the authoritative agent backend

Standalone release. v2.02 = the v2.01 agent core, unchanged, PLUS the two
backend routes the OpEx Tower front-end needs, PLUS the front-end changes
to make the app call the real contract. One Cloud Run service now serves
the whole application.

### Decisions locked for this release

- **v2.01 agents are authoritative.** The app reflects the agents' real
  use cases. Where the app implied capabilities the agents don't have, the
  app yielded.
- **The front-end moved to real schema names.** The backend (agents +
  semantic layer) is the source of truth; no translation shim.
- **Existing tabs wired to live data first.** Feature iteration (deeper
  agent visibility, etc.) is downstream work, not in this release.
- **Nexus co-pilot stays on Gemini** (2.5 Flash via Vertex AI).

### Backend — added to the v2.01 core

- **`GET /dashboard-data`** — new route. Returns live `tiger_semantic` data
  in the front-end `DashboardData` shape. Backed by `data_pipeline.py`,
  lifted from the app's prior backend and **SQL-verified** against the
  semantic-layer column dictionary (every column checked against the view
  it is queried on). One verification finding: the pipeline reads
  `ordered_quantity_cases` only via the `o.` alias on `fct_otif`, where it
  exists — correct; `fct_sales_orders` uses `ordered_quantity_sales_uom`.
- **`POST /chat`** — new route. Nexus co-pilot, Gemini 2.5 Flash via Vertex
  AI. Multi-turn; last message is the new turn.
- **CORS middleware** added (open) so the browser dev server can call the
  backend directly as well as through the Express proxy.
- **`_fetch_decision_log`** rewritten: was a hardcoded `[]`; now reads
  `tiger_decisions.fct_allocation_decisions` (the v2.01 DCE table),
  extracting agent fields from the `decision_reason` JSON. Returns `[]` if
  the table does not exist yet.
- **`data_pipeline.py`** added to the Dockerfile COPY set.
- **`requirements.txt`** unchanged in practice — `google-cloud-aiplatform`
  already present — but the chat route now imports `vertexai` from it.

The agent core (`agent_tools.py`, `orchestrator.py`, `agents.py`, the 5
prompts, the trigger adapter, the DCE write) is **byte-identical to
v2.01**. v2.02 adds surface; it does not touch the agents.

### Front-end — `OrderTriage.tsx`

- **`POST /sessions` payload rewritten to the real contract.** Both call
  sites previously sent `trigger_payload` with `customer_kunnr`,
  `material_matnr`, `ordered_qty_cs`, `mabd` — names the v2.01 schema
  rewrite deleted because they do not exist in `tiger_semantic`. Against
  the v2.01/v2.02 backend every one of those calls would have failed
  validation.
- **Real identifiers, not display names.** The old code derived
  `customer_kunnr` by uppercasing the customer display name (e.g.
  `"Walmart DC (FL)"` -> `"WALMART_DC_(FL)"`) — never a valid SAP
  `sold_to`. The app now carries the real `soldTo` / `materialNumber` from
  `/dashboard-data` straight through.
- **`PO` type** extended with `soldTo`, `materialNumber`, `mabd`.
- The session **polling logic was already correct** — it reads
  `recommendation` and `reasoning_chain` off `final_action_card`, which
  matches the real `CustomerSupplyDecision` schema. Left as-is.

### Front-end — post-QA correctness pass

A retrospective QA review found the initial front-end patch was
**incomplete**. The following were then fixed:

- **`FulfillmentSimulator.tsx` — broken `POST /sessions` call.** This
  component also starts agent sessions and still sent the old
  `trigger_payload` / `customer_kunnr` shape — every "Execute Scenario"
  click would have failed backend validation with a 422. Rewritten to the
  real contract. The `Incident` type gained `soldTo`, `materialNumber`,
  `orderedQty`, `mabd`, and `_fetch_fulfillment_incidents` in
  `data_pipeline.py` now emits them.
- **Shared API helper added — `frontend/src/lib/api.ts`.** The
  `POST /sessions` body is now built in ONE place
  (`buildStartSessionRequest`), used by both Order Triage and the
  Fulfillment Simulator, so the contract cannot drift between call sites.
  The previously-inlined helper in `OrderTriage.tsx` was removed in favour
  of it.
- **Dashboard-consuming tabs verified.** `Watchtower`, `RootCauseHub`,
  `SafetyStockOptimizer`, and the `TopBar` / `RightSidebar` layout
  components were each checked field-by-field against `data_pipeline.py`'s
  output shape — all consistent, no changes needed. (`RootCauseHub`'s
  driver fields, `TopBar`'s `otifFinesAtRisk7Day`, `RightSidebar`'s
  `/health` provider fields and `role: 'user'|'agent'` chat shape all
  match.)
- **TypeScript-verified.** The patched components plus the new helper were
  compiled with `tsc --strict` against React 19 and the patched
  `mockData.json` — exit 0, no type errors. (The earlier release was
  checked by regex only; this pass uses a real compile.)
- **`agent_tools.py` re-verified.** v2.02 carries the agent tools
  unchanged from v2.01; their schema-correctness was re-checked against
  the column dictionary in this release rather than inherited on trust —
  all 18 views and the critical column set confirmed present.

### Front-end — `mockData.json`

- `purchaseOrders` entries given `soldTo` (empty placeholder),
  `materialNumber`, `mabd` so the `PO` type stays consistent and
  mock-data dev still runs. Empty `soldTo` triggers the backend's
  demo-scenario fallback rather than sending a bad identifier.

### Files in this package

Only the files that **changed** are included:

- Full backend (`code/`, `agents/`, `infra/`) — the deployable v2.02
  service.
- `frontend/src/lib/api.ts` — NEW. Shared `POST /sessions` contract helper.
- `frontend/src/components/tabs/OrderTriage.tsx` — patched.
- `frontend/src/components/tabs/FulfillmentSimulator.tsx` — patched.
- `frontend/src/data/mockData.json` — patched (PO + incident identifiers).

Drop the `frontend/src/` files into the existing app, replacing their
namesakes; `lib/api.ts` is a new file. The other three tabs and the layout
components are unchanged — they were verified compatible, not edited.

### Known limitations carried forward

- **Not run against live data.** All SQL — agent tools and the dashboard
  pipeline — is schema-verified, not data-verified. First run is the
  AI/ML team's integration test once `tiger_semantic` is populated.
- **Dashboard `forecastQty` is indicative.** `_fetch_purchase_orders`
  joins `fct_sales_orders.material_number` to
  `fct_forecast_accuracy.material_zrep_number` — different grains (FERT vs
  ZREP parent). Matches are sparse unless a material is its own ZREP
  parent. The agent tools resolve FERT->ZREP via `dim_material`; this
  coarse dashboard rollup intentionally does not. Documented in
  `data_pipeline.py`.
- Schema gaps from v2.01 stand: no customer MRSL field, no freight-cost
  column.



























# Fulfillment Simulator — Phase 1: Real LP Optimizer

## Context

Today's Fulfillment Simulator is a thin demo: `backend/code/orchestrator_service/data_pipeline.py:_fetch_fulfillment_incidents` pulls the top-5 OTIF failures from `tiger_semantic.fct_otif`, then hand-templates **two scenarios** ("Default Routing" / "Expedite Alternate Route") with computed freight costs and fine estimates. The "Execute" button fires the existing 5-agent flow (`POST /sessions`) and doesn't render any optimizer output. There is no multi-node sourcing, no LP, no commitment-aware availability, no real freight cost source.

The user's target is the opposite end of the spectrum: a network-wide cost-minimization optimizer that reads inventory at every node, lane costs, penalty rates, and risk signals, generates ranked alternatives, and prepares them for SAP write-back on approval.

**Phase 1 scope** (per user selection): build the real LP engine and replace the hand-templated scenarios with optimizer output, while keeping the existing two-card UI grid compatible. SAP write-back, multi-scenario UI redesign, and real risk-feed connectors are out of scope for this phase and will be Phase 2 / 3.

**Business gate (per user clarification):** The Fulfillment Simulator only operates on orders that were **accepted (`ACCEPT`)** or **modified (`PARTIAL_FULFILL`)** by a human in Order Triage. Orders the user rejected (`REJECT`) or deferred (`DEFER`) are excluded — there is nothing to fulfill. The current implementation incorrectly seeds incidents from raw OTIF history regardless of upstream triage status; Phase 1 will fix this by joining `tiger_semantic.fct_otif` (or its source orders) to the human-approved decisions in `tiger_decisions.fct_allocation_decisions` (written by `agent_tools.dce_write` from the `/sessions/{id}/approve` route).

**Key data gaps we will document but not solve here:**
- No `freight_cost` column anywhere in `tiger_semantic` → resolved with a static config dict (env-loadable)
- No explicit `committed_qty` per plant × material → derive from `fct_allocation_decisions` joins
- No external weather/route-blockage feed → out of scope; we will accept an optional `blocked_plants: list[str]` parameter and let the caller (or a future agent) supply it

## Approach

Build a deterministic, LP-solved fulfillment optimizer as a pure-Python module + tool. Expose it via a synchronous HTTP endpoint the frontend can call cheaply (~1-3s — no LLM). The existing 5-agent flow is unchanged; the new optimizer is an additional, parallel surface, not a replacement.

1. **Add PuLP** as the LP solver (MIT license, single small dep, ships with the default CBC solver — no system packages needed)
2. **Static freight-cost config**: `backend/code/orchestrator_service/config/freight_costs.json` keyed by `origin_plant → customer_region → usd_per_case`, loaded once at module import. Override-able by `FREIGHT_COSTS_PATH` env var
3. **Two new BigQuery tools** in `agent_tools.py`:
   - `get_network_inventory(material_number, sold_to)` — per-plant available qty = `fct_inventory_projection.ending_inventory_cases − sum(fct_allocation_decisions.allocated_quantity_cases WHERE decision_status IN ('PLANNED','ACTIVE'))`
   - `get_customer_penalty_profile(sold_to)` — per-customer fine rate from `dim_customer.otif_target_pct` + 90-day average chargeback `amount_per_late_case` from `fct_chargebacks`
3. **New optimizer module** `backend/code/orchestrator_service/fulfillment_optimizer.py`:
   - Builds an LP that decides how much qty to ship from each candidate plant
   - Objective: `min Σ x[p] * freight_cost[p, dest] + shortfall * penalty_per_case`
   - Constraints:
     - `Σ x[p] + shortfall = ordered_qty` (allow shortfall as slack, not infeasibility)
     - `x[p] ≤ net_available[p]` for each plant
     - `x[p] ≥ 0`, `shortfall ≥ 0`
     - Optional: `x[p] = 0` for `p ∈ blocked_plants`
   - Returns: `OptimalSolution` with per-plant allocations + total cost + shortfall
   - Builds **two scenario cards** for the UI (each in the existing `Scenario` shape — `id, name, tagline, arrival, dcSource, freightCost, fine, netImpact, savingsVsDefault, isRecommended, rationale`):

     | Card | Role | Source | `isRecommended` | `dcSource` |
     |---|---|---|---|---|
     | **Scenario A: Default Route** | What happens if nothing changes — ship from origin, eat the penalty | Origin plant only | `false` | `origin_plant` (incident's plant) |
     | **Scenario B: Optimal Alternate Route** | LP recommendation — may be split across plants, or single alternate plant | LP output | `true` | Joined plant list (e.g. `"P0002 + P0007"` for a split) |

     The `rationale` field on Scenario B is auto-generated text like *"Ships 60 cs from P0002 + 40 cs from P0007. Saves $X vs Default by avoiding $Y in OTIF penalty at the cost of $Z extra freight."*

     **Edge case — LP optimum is the origin plant itself** (no cheaper alternative): the optimizer generates a *next-best alternate* by re-solving the LP with the extra constraint `x[origin_plant] < ordered_qty`. That guarantees Scenario B is always a meaningfully different alternate-route option, never a duplicate of A. If even the relaxed LP fails (origin is the only feasible plant), Scenario B is omitted and the UI gracefully renders just Scenario A with a "No alternate route available" note.
4. **Two new endpoints** in `main.py`, both under `/fulfillment/*` so they don't bloat `/dashboard-data`:
   a. `GET /fulfillment/incidents` — returns the list of at-risk approved orders (the data currently embedded inside `/dashboard-data.fulfillmentIncidents`). Lazy-loaded by the Fulfillment Simulator tab only — keeps `/dashboard-data` lean and faster for the other 4 tabs.
   b. `POST /fulfillment/simulate` — body `{ sold_to, material_number, ordered_quantity_cases, requested_delivery_date, origin_plant?, blocked_plants?: string[] }`; calls the optimizer module; returns the `scenarios` array in the existing Scenario shape. Synchronous, ~1-3s — no LLM involved.

   Also: **remove `fulfillmentIncidents` from `/dashboard-data`** response (or leave as empty `[]` for backward-compat, with a deprecation note). Single responsibility per endpoint.
5. **Rewrite `_fetch_fulfillment_incidents`** to enforce the Order-Triage gate:
   a. Source incidents **only** from orders that have an `ACCEPT` or `PARTIAL_FULFILL` decision in `tiger_decisions.fct_allocation_decisions` (the dataset `dce_write` populates from `/sessions/{id}/approve`). Rejected / deferred orders are filtered out at the SQL level — they're not eligible for fulfillment simulation.
   b. Join those approved orders against execution-risk signals (recent `fct_otif` failures for the same sold_to + material_number, late production orders, low ATP) — surface only orders where at least one risk signal fires.
   c. **Stop** generating templated A/B scenarios — each incident has `scenarios: []`; the frontend triggers the optimizer when the user opens it.
   d. If the decision log is empty (fresh project, before any Order Triage approvals), fall back to seeding 1-2 illustrative incidents from `fct_otif` with a `_demo_seed: true` flag so the UI is never blank. Log a console warning so the seeding is visible.
6. **Update the frontend `FulfillmentSimulator.tsx`**:
   - On tab mount (or first render), call `GET /api/fulfillment/incidents` to lazy-load the incident list (was previously embedded in `data.fulfillmentIncidents` from `/dashboard-data`).
   - On `handleIncidentClick`, call `POST /api/fulfillment/simulate` with the incident's `soldTo`/`materialNumber`/`orderedQty`/`mabd` (and `origin_plant` from the incident's plant).
   - Cache both lists and scenarios in App-level state (mirror the `agentEvals` pattern we just built for OrderTriage so tab switches don't re-trigger network calls).
   - Render returned scenarios in the existing two-card grid. The optimizer always returns exactly two: Default (origin plant, accepts penalty) and Optimal (LP result).
   - "Execute" continues to fire `POST /sessions` against the incident's IDs — unchanged.

## LP formulation (concrete)

```
Decision vars
  x_p ≥ 0   for each candidate plant p     # cases shipped from plant p
  s   ≥ 0                                  # shortfall (unfulfilled cases)

Parameters (per call)
  D       = ordered_quantity_cases
  A_p     = net_available[p]                              # ending inv − committed
  C_p     = freight_cost[p][customer_region] (USD/case)   # from config
  K       = penalty_per_case (USD/case)                   # from get_customer_penalty_profile
  blocked = set of plants to force x_p = 0

Constraints
  Σ_p x_p + s = D
  x_p ≤ A_p          ∀ p
  x_p = 0            ∀ p ∈ blocked

Objective
  min   Σ_p (C_p * x_p) + K * s
```

The LP is small (≤ 20 plants × 1 material per call) and PuLP's bundled CBC solver returns in tens of milliseconds.

## Critical files to be modified or created

| File | Change |
|---|---|
| `backend/code/orchestrator_service/requirements.txt` | Add `pulp>=2.7,<3.0` |
| `backend/code/orchestrator_service/config/freight_costs.json` | **NEW** — placeholder per-lane USD/case table |
| `backend/code/orchestrator_service/fulfillment_optimizer.py` | **NEW** — LP module: `optimize(ordered_qty, available_by_plant, freight_cost_by_plant, penalty_per_case, origin_plant, blocked_plants) -> dict` returning `{default_scenario, optimal_scenario, raw_lp}` |
| `backend/code/agent_tools.py` | Add `get_network_inventory()` and `get_customer_penalty_profile()`. Register both as kwarg-tolerant FunctionTools (reuse the existing `_T(_tolerant(...))` wrapper from this session). Keep current tools untouched. |
| `backend/code/orchestrator_service/schemas.py` | Add `FulfillmentSimulateRequest` / `FulfillmentScenario` / `FulfillmentSimulateResponse` Pydantic models. Use the same field names as the existing front-end `Scenario` type for zero-friction UI rendering |
| `backend/code/orchestrator_service/main.py` | Add **two** routes: `@app.get("/fulfillment/incidents")` (lazy-loaded list of at-risk approved orders) and `@app.post("/fulfillment/simulate", response_model=FulfillmentSimulateResponse)` (LP optimizer for one order). Also remove the `fulfillmentIncidents` field from the `/dashboard-data` response handler (or set to `[]` with a deprecation note). |
| `backend/code/orchestrator_service/data_pipeline.py` | **Rewrite** `_fetch_fulfillment_incidents` (lines 399-509). New query: `JOIN tiger_decisions.fct_allocation_decisions d ON ... WHERE d.action IN ('ACCEPT','PARTIAL_FULFILL')` so only Order-Triage-approved orders surface. Then filter to those with active risk signals (recent OTIF fail, low ATP). Drop the hand-templated scenarios + executionSteps blocks; set `scenarios: []`. If decision table is empty, fall back to demo seeds tagged `_demo_seed: true`. |
| `frontend/src/lib/agentEvals.ts` (just-built helper) | Generalize or add a sibling `useFulfillmentScenariosStore` with the same sessionStorage pattern — cache `incident_id → scenarios[]` so tab switches don't re-fetch. |
| `frontend/src/components/tabs/FulfillmentSimulator.tsx` | Hook into `handleIncidentClick` to call `/api/fulfillment/simulate` and store the result. Render `incident.scenarios` from the store (falling back to a "loading" state during the ~2s fetch). Keep the rest of the UI unchanged. |
| `frontend/src/App.tsx` | Lift fulfillment scenarios store (mirroring the `agentEvals` lift we just did). Pass to `<FulfillmentSimulator>` as props. |

## Reusing what exists

| Existing utility | Reuse for |
|---|---|
| `agent_tools._run_query` ([line 75](backend/code/agent_tools.py:75)) — single chokepoint to BigQuery with `TOOL_ROW_CAP` already wired | Both new tools |
| `agent_tools._tolerant` and `_T` wrapper (added this session) | Wrap the new tools so Gemini-hallucinated kwargs never crash a session |
| `agent_tools.get_finished_goods_inventory` + `get_allocation_history` patterns | Template for the new `get_network_inventory` query: cross-join `fct_inventory_projection` with `fct_allocation_decisions` |
| `agent_tools.get_chargeback_risk` ([~line 942](backend/code/agent_tools.py:942)) | Template for `get_customer_penalty_profile`: same view (`fct_chargebacks`) different aggregation (per-case rate) |
| The `useAgentEvalsStore` hook in `frontend/src/lib/agentEvals.ts` (built this session) | Template for `useFulfillmentScenariosStore` — same sessionStorage pattern |
| The Express proxy timeout bump in `frontend/server.js` (10 min) | Already applies; the new `/api/fulfillment/simulate` endpoint will inherit it. |
| The Scenario type at [FulfillmentSimulator.tsx:8-20](frontend/src/components/tabs/FulfillmentSimulator.tsx:8) | Backend `FulfillmentScenario` Pydantic schema mirrors field-for-field: `id, name, tagline, arrival, dcSource, freightCost, fine, netImpact, savingsVsDefault, isRecommended, rationale` |

## Verification (end-to-end test plan)

1. **Unit test the optimizer in isolation**:
   - Run `python -c "from fulfillment_optimizer import optimize; print(optimize(D=100, available={'P1':80,'P2':50}, freight={'P1':2.0,'P2':5.0}, penalty=20.0, origin='P1', blocked=set()))"`
   - Expected: optimal ships 80 from P1 + 20 from P2 (total cost 80·2 + 20·5 = 260) vs default 100 from P1 = 100·2 = 200 but with 0 shortfall — actually need to test cases with constrained P1 (e.g. A_P1=80<D=100): default would be 80 shipped + 20 shortfall × penalty 20 = 80·2+400 = 560 vs optimal 80·2 + 20·5 = 260. Optimizer should win.
   - Add a pytest file `backend/tests/test_fulfillment_optimizer.py` with 4 scenarios: (a) no shortage, default optimal; (b) origin partial-out, alternate plant cheaper than penalty; (c) all plants blocked → all shortfall; (d) ordered_qty = 0 → trivial 0-cost solution.

2. **Endpoint smoke tests from host** (both new APIs):
   ```bash
   # 2a. Incident list (filtered by Order-Triage approval + risk signals)
   curl -s http://localhost:8080/fulfillment/incidents | jq '.[] | {id, sold_to, material_number, riskProbability, fineAtRisk}'

   # 2b. Optimizer
   curl -s -X POST -H 'Content-Type: application/json' --data '{
     "sold_to":"1000001","material_number":"70040102",
     "ordered_quantity_cases":500,"requested_delivery_date":"2026-06-01",
     "origin_plant":"P0001"
   }' http://localhost:8080/fulfillment/simulate | jq
   ```
   - 2a expects a JSON array of incident objects, all sourced from approved triage decisions.
   - 2b expects a `scenarios` array with exactly two items in the existing Scenario shape:
     - `scenarios[0]`: `name: "Scenario A: Default Route"`, `isRecommended: false`, `dcSource: <origin plant>`, ships everything from origin.
     - `scenarios[1]`: `name: "Scenario B: Optimal Alternate Route"`, `isRecommended: true`, `dcSource` is the alternate or split plants (e.g. `"P0002 + P0007"`), `rationale` explains the savings.
     - `meta.solver_status: "Optimal"` and `meta.elapsed_ms < 2000`.
     - When the LP can't find any alternate (origin is the only feasible plant), `scenarios` may have length 1 (just Scenario A) with `meta.no_alternate_reason` populated.

   Also confirm `/dashboard-data` no longer carries fulfillment incidents:
   ```bash
   curl -s http://localhost:8080/dashboard-data | jq 'keys | .[] | select(test("fulfillment"; "i"))'
   # expected: empty (or just an empty array key if kept for backward-compat)
   ```

3. **BigQuery probe** (one-shot) to confirm the per-plant inventory math:
   ```bash
   docker exec cfr_agentic_ai_framework_v2_02-backend-1 python -c "
   import sys; sys.path.insert(0,'/app')
   from agent_tools import get_network_inventory
   print(get_network_inventory(material_number='70040102', sold_to='1000001'))"
   ```
   - Expect a dict mapping `plant_code → {ending, committed, available}`.

4. **Order-Triage gate verification** (proves the new business rule holds):
   - In Order Triage, approve PO #1 (action=ACCEPT) and PO #2 (action=PARTIAL_FULFILL). Reject PO #3.
   - Hard-refresh, open Fulfillment Simulator.
   - Expect PO #1 and PO #2 to appear in the incident queue **only if** they also have active risk signals (OTIF/ATP). PO #3 must NOT appear regardless of risk.
   - If neither approved PO triggers a risk signal, expect the demo-seed fallback (incidents tagged `_demo_seed: true`) with a console warning.

5. **Front-end end-to-end**:
   - Click an incident card. Within ~2s, the two scenario cards populate with optimizer-generated `freightCost`, `fine`, `netImpact`, `rationale` (the Optimal card is `isRecommended: true`).
   - Switch to Order Triage and back — scenarios stay (sessionStorage cache).
   - Click a different incident — new optimizer call, different scenarios.
   - Click "Execute" — existing `POST /sessions` fires unchanged (no functional regression).

6. **Container memory** during a click-storm (open 5 incidents in quick succession):
   - `docker stats cfr_agentic_ai_framework_v2_02-backend-1` — memory should stay well under the 4 GiB limit since the LP is cheap and there's no ADK session involved.

## Out of scope for this plan (deferred)

- Multi-scenario UI redesign (Split fulfillment, Mode swap): deferred to Phase 2.
- SAP routing write-back: deferred to Phase 3.
- Real weather / route-blockage feed connector: deferred. The `blocked_plants` parameter exists from day one so the user / a future Risk-Signal agent can supply it.
- New `fulfillment_planning` ADK agent: deferred. The LP is purely deterministic in Phase 1; an LLM rationalization layer can be added later by registering the new tools with the existing `transportation` agent.
- Per-case shelf-life / FEFO constraints across nodes: deferred.
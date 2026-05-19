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

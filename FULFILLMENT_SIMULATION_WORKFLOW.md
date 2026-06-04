# Fulfillment Simulation — Full Workflow

**Service:** Tiger Foods Agentic AI · Multi-Agent Fulfillment Simulator (v2.3)
**Scope:** From the planner opening the *Fulfillment Simulator* tab → the LP optimizer → the rendered scenario cards + DC Sourcing Explorer.
**Nature:** Deterministic optimization (PuLP/CBC linear program). **No LLM is involved** in the simulate path — unlike Order Triage, this is a fast, repeatable solver over live BigQuery inventory + freight + penalty data.

---

## 1. Purpose

When an *approved* order is at risk of an OTIF (On-Time-In-Full) miss, the simulator answers one question:

> **What is the cheapest way to fulfill this order across the DC network — ship from origin and eat the penalty, or split-source from alternate DCs?**

It produces 2 ranked **scenario cards** (Default vs Optimal Alternate) with freight cost, OTIF penalty, net financial impact, and a per-DC split plan — plus a **Real-Time DC Sourcing Explorer** showing network availability vs. the order.

---

## 2. Architecture (prose diagram)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend — FulfillmentSimulator.tsx  (React, localhost:3001/cfr-ui)  │
│    • Incident queue (left rail)                                        │
│    • Dynamic Sourcing Constraints + "Apply & Re-Simulate"             │
│    • Transportation Agent tool-call terminal                          │
│    • Scenario cards · AI Rationale · Execution Steps                  │
│    • DC Sourcing Explorer + AI Split Sourcing Plan                    │
└───────────────┬────────────────────────────────┬──────────────────────┘
                │ GET /api/fulfillment/incidents  │ POST /api/fulfillment/simulate
                ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Backend — FastAPI (main.py)                                          │
│    GET  /fulfillment/incidents  → data_pipeline.fetch_fulfillment_…   │
│    POST /fulfillment/simulate   → fulfillment_optimizer.simulate()    │
│         1. get_network_inventory()          (per-DC ATP)              │
│         2. get_customer_penalty_profile()   ($/case + region)         │
│         3. dim_plant / fct_shipments / dim_carrier  (delivery ctx)    │
│         4. _solve_lp()  (PuLP CBC)  → Scenario A + Scenario B         │
└───────────────┬────────────────────────────────────────────────────-─┘
                │ parameterized SQL
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BigQuery — resilience-riskradar                                      │
│    tiger_semantic.fct_inventory_batch_snapshot / projection (ATP)     │
│    tiger_semantic.dim_customer        (penalty rate, region)          │
│    tiger_semantic.dim_plant           (plant name / city / type)      │
│    tiger_semantic.fct_shipments       (transit hours, carrier)        │
│    tiger_semantic.dim_carrier         (on-time-performance target)    │
│    tiger_decisions.fct_allocation_decisions  (approved orders)        │
│    tiger_semantic.fct_otif            (demo-seed incidents fallback)   │
│  Config: backend/.../config/freight_costs.json  (freight $/case)      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. End-to-end sequence

### Step 1 — Load the incident queue
- Tab mounts → `GET /api/fulfillment/incidents`.
- Backend `data_pipeline.fetch_fulfillment_incidents()`:
  1. Take orders that were **ACCEPT** or **PARTIAL_FULFILL** in Order Triage (`tiger_decisions.fct_allocation_decisions`).
  2. Join against execution-risk signals (recent OTIF failures, low ATP, late production orders) — only orders with **at least one active risk** become incidents.
  3. If the decision log is empty → fall back to a small **demo seed** from `fct_otif` history so the queue is never blank (`meta.fallback_demo_seed = true`).
- Returns `{ incidents: [...], meta: {...} }`. **Scenarios are NOT computed here** — that happens per-incident on click.

### Step 2 — Select an incident
- The first incident auto-selects; clicking another switches it.
- On select, the frontend fires `runFulfillmentSimulate(incident)` → `POST /api/fulfillment/simulate`.
- Results are **cached per-incident in `sessionStorage`** (`tiger:fulfillment:scenarios:v1`), so re-clicking or switching tabs does not re-run the solver.

### Step 3 — Backend simulate (POST /fulfillment/simulate)
The handler runs **5 steps**, all synchronous (~0.5–2 s, dominated by BigQuery):

| # | Action | Source |
|---|---|---|
| 1 | **Per-plant available inventory** (ending / committed / available) | `get_network_inventory(material, sold_to)` → inventory snapshot/projection |
| 2 | **Penalty rate** ($/case) + customer region | `get_customer_penalty_profile(sold_to)` → `dim_customer` |
| 3 | **Origin plant** ensured present in the inventory map (zero-available is a valid LP input) | request `origin_plant` or first plant |
| 4 | **Delivery context** — plant names/cities/types, avg transit hours + primary carrier per lane, carrier OTP target | `dim_plant`, `fct_shipments`, `dim_carrier` (best-effort; solver still runs without it) |
| 5 | **Solve the LP** → build Scenario A + Scenario B | `fulfillment_optimizer.simulate()` |

Returns `{ scenarios: [...], meta: { inventory_by_plant, freight_costs_used, penalty_per_case, solver_status, elapsed_ms, origin_plant, customer_region, ... } }`.

### Step 4 — Render
The frontend maps the response into the UI sections (see §6).

### Step 5 — Dynamic re-simulation (optional)
Planner types a constraint (e.g. *"Exclude DC02 from sourcing pool"*) → **Apply & Re-Simulate** → frontend parses known plant codes → re-POSTs with `blocked_plants: ["DC02"]` → the LP re-solves with those plants forced to zero. The **Resolution Summary** updates in place with a *Constraint-adjusted* badge.

---

## 4. The optimization model (the core)

A **linear program** solved with PuLP + the CBC solver (`fulfillment_optimizer._solve_lp`).

### Decision variables
- `x[p] ≥ 0` — cases shipped from each candidate plant `p`.
- `shortfall ≥ 0` — cases that cannot be fulfilled (incurs the OTIF penalty).

### Objective — minimize total cost
```
minimize   Σ_p ( freight_per_case[p] · x[p] )  +  penalty_per_case · shortfall
```

### Constraints
```
Σ_p x[p] + shortfall = ordered_qty           # meet demand (or pay the penalty)
0 ≤ x[p] ≤ available[p]      for every plant  # can't ship more than ATP
x[p] = 0                      for blocked plants (Dynamic Sourcing Constraints)
```

### Two scenarios built from the LP

| Scenario | How it's built | `isRecommended` |
|---|---|---|
| **A — Default Route** | Ship from the **origin plant only**; OTIF penalty on whatever shortfall remains. Never split, never reroute. | No |
| **B — Optimal Alternate** | The unconstrained LP optimum (may **split across DCs**). If the LP's optimum is origin-only (i.e. B would equal A), it **re-solves with `x[origin] = 0`** to surface a meaningful next-best alternate. | **Yes if `savings > 0`** vs Default |

`savingsVsDefault = netImpact_B − netImpact_A`. Net impact is always negative (a cost): `netImpact = −(freight + fine)`.

### Freight + transit derivation
- **Freight $/case** comes from `config/freight_costs.json`, keyed by `(origin_plant, customer_region)`; falls back to a flat default if a lane is missing.
- **Transit hours** for Scenario B = the **max** across all sourcing plants (the bottleneck). **Carrier** = the carrier of the plant shipping the most volume (manufacturing plants often have no direct carrier data).

---

## 5. API contract

### `GET /fulfillment/incidents`
**Response** `{ incidents: FulfillmentIncident[], meta }` — each incident carries:
`id, title, customer, skuCode, skuName, soldTo, materialNumber, orderedQty, mabd, riskProbability, fineAtRisk, otifRulebook, originPlant, originPlantName/City/Type, avgTransitHours, primaryCarrier, recentFillRate, otifTarget/Program/FailRate, recentFails, totalDeliveries, maxDaysLate, lastRootCause, avgChargebackUsd, totalChargebackUsd, chargebackCount, mabdEnforcement, otifAggressive` (+ empty `scenarios`/`executionSteps` placeholders).
`meta`: `{ fetched_at, source, approved_only, fallback_demo_seed, count }`.

### `POST /fulfillment/simulate`
**Request** (`FulfillmentSimulateRequest`):
```json
{
  "sold_to": "1000001",
  "material_number": "70020102",
  "ordered_quantity_cases": 829,
  "requested_delivery_date": "2026-06-10",
  "origin_plant": null,
  "customer_region": null,
  "blocked_plants": []
}
```
**Response** (`FulfillmentSimulateResponse`):
```json
{
  "scenarios": [
    {
      "id": "scenario-a-default",
      "name": "Scenario A: Default Route",
      "tagline": "Do Nothing",
      "arrival": "805 cs short",
      "dcSource": "DC01 (Allentown)",
      "freightCost": 115.2,
      "fine": 6101.9,
      "netImpact": -6217.1,
      "savingsVsDefault": 0,
      "isRecommended": false,
      "rationale": "Ship from origin DC01… origin can only cover 24 of 829 cases…",
      "transitHours": 48,
      "carrierName": "Eagle Express Freight",
      "plantDetails": [{ "code": "DC01", "name": "...", "city": "Allentown", "qty": 24, "transitHours": null, "carrier": null }]
    },
    {
      "id": "scenario-b-optimal",
      "name": "Scenario B: Optimal Alternate Route",
      "tagline": "LP Optimized",
      "arrival": "On Time",
      "dcSource": "DC02 + DC03 + US02",
      "freightCost": 2480.0,
      "fine": 0,
      "netImpact": -2480.0,
      "savingsVsDefault": 3737.1,
      "isRecommended": true,
      "rationale": "Ships 27 cs from DC02, 27 cs from DC03, 754 cs from US02. Saves $3,737 vs Default…",
      "plantDetails": [ { "code": "US02", "qty": 754, ... }, ... ]
    }
  ],
  "meta": {
    "solver_status": "Optimal",
    "elapsed_ms": 16,
    "no_alternate_reason": null,
    "penalty_per_case": 7.58,
    "ordered_qty": 829,
    "origin_plant": "DC01",
    "customer_region": "AR",
    "freight_costs_used": { "DC01": 4.8, "DC02": 3.0, "US02": 3.4, ... },
    "inventory_by_plant": {
      "DC01": { "ending": 24, "committed": 0, "available": 24 },
      "US02": { "ending": 5063, "committed": 0, "available": 5063 }
    },
    "is_demo_seed": false
  }
}
```

---

## 6. Frontend UI → data mapping

The right panel renders top-to-bottom:

| Section | Sourced from |
|---|---|
| **Dynamic Sourcing Constraints** (textarea + Apply & Re-Simulate) | Local input → parsed `blocked_plants` → re-POST `/fulfillment/simulate` |
| **Resolution Summary** (Ordered · Recommended Fulfill · Freight · Fine · Net Impact · Saves vs Default) | Recommended scenario fields; *Constraint-adjusted* badge when re-simulated |
| **Transportation Agent tool-call terminal** (`✓ {ms}`) | `meta.elapsed_ms`, `meta.solver_status`, scenario count, recommended name, `savingsVsDefault`, request params |
| **Buffer Build Risk header** | `incident.title`, `fineAtRisk`, `riskProbability`, `description` |
| **Scenario cards** (Fulfill Qty / Freight / Fine / Net Impact / Saves vs Default) | `scenarios[]`; fulfill qty = Σ `plantDetails[].qty`; **AI Recommended** badge on `isRecommended` |
| **AI Rationale + Execution Steps** | `scenario.rationale` + `incident.executionSteps` |
| **Execute / Use AI Recommendation** | Logs the chosen plan locally (no SAP execute endpoint yet); "Use AI Recommendation" selects the recommended scenario |
| **DC Sourcing Explorer** (DC · Available · Coverage bar · Allocated · After Fill) | `meta.inventory_by_plant` (available) + recommended scenario split (allocated); freight $/cs from `meta.freight_costs_used` |
| **AI Split Sourcing Plan** | Recommended scenario's `plantDetails` → per-DC cases + % of order |

---

## 7. Failure modes & fallbacks

| Condition | Behavior |
|---|---|
| Decision log empty (no approved orders) | Incident queue falls back to `fct_otif` demo seed; `meta.fallback_demo_seed = true` (amber "Demo Seed" badge) |
| Delivery context query fails (`dim_plant`/`fct_shipments`/`dim_carrier`) | Best-effort — solver still runs; scenario cards omit transit/carrier labels |
| `customer_region` not supplied | Auto-resolved from `dim_customer.customer_region_state`; if still unknown, freight uses plant defaults |
| LP not `Optimal` / no feasible alternate | Scenario B is omitted; `meta.no_alternate_reason` explains why; UI shows a single card |
| Origin plant has 0 available | Valid input — LP routes around it or reports shortfall |
| Penalty rate missing | Defaults to `$25/case` |

---

## 8. Performance & determinism

- **Latency:** ~0.5–2 s, dominated by the BigQuery lookups; the LP solve itself is typically **10–70 ms** (`meta.elapsed_ms`).
- **Deterministic:** same inputs → same output (CBC LP). Re-running an incident yields identical scenarios — this is the key difference from the LLM-based Order Triage flow.
- **Client cache:** scenarios are memoized per incident in `sessionStorage`, so the solver runs at most once per incident per browser session (unless constraints change).

---

## 9. Key files

| Layer | File |
|---|---|
| Frontend tab | `frontend/src/components/tabs/FulfillmentSimulator.tsx` |
| Frontend data store | `frontend/src/lib/fulfillment.ts` |
| Frontend API client | `frontend/src/lib/api.ts` (`fetchSimulatorIncidents`, `simulateFulfillment`) |
| Backend routes | `backend/code/orchestrator_service/main.py` (`/fulfillment/incidents`, `/fulfillment/simulate`) |
| LP optimizer | `backend/code/orchestrator_service/fulfillment_optimizer.py` |
| Incident builder | `backend/code/orchestrator_service/data_pipeline.py` (`fetch_fulfillment_incidents`) |
| Freight config | `backend/code/orchestrator_service/config/freight_costs.json` |

# Fulfillment Simulation — Worked Example (Micro-Level Trace)

A single incident traced **end to end with the real data values** at every hop:
incident row → `POST /fulfillment/simulate` → each BigQuery query + its rows → LP cost
coefficients → LP solve → the two scenario cards → the rendered UI.

> Companion to `FULFILLMENT_SIMULATION_WORKFLOW.md` (the generic flow). This document
> walks one concrete order so the reader can verify the arithmetic by hand.
> All values were captured **live, read-only** from the running backend.

---

## 0. Overview — the chosen incident

| Field | Value |
|---|---|
| Incident | `inc-001` (top of the live queue; `meta.fallback_demo_seed = false`) |
| Customer | **Walmart Inc.** — `sold_to = 1000001` (Tier 1 "Strategic", aggressive chargeback program, region **AR**) |
| SKU | **70020102** — "STRP CLSC TWST F/S 24/16 OZ PROMO" |
| Ordered | **829 cs** |
| MABD | 2026-06-10 · enforcement FIRM |
| Origin plant | **US02** — Tiger Foods Chicago Plant (Manufacturing) |
| OTIF target / recent fill | 98% / 97.6% (0 recent fails) |

**Outcome (one line):** the order is fully coverable. The LP recommends a **4-plant split**
(DC02 27 + DC03 27 + DC05 21 + US02 754) costing **$2,777.20** freight, **$41.40 cheaper**
than shipping all 829 cs from the origin (US02) — no OTIF penalty either way.

---

## 1. Actors & data sources

| Step | Code | Reads |
|---|---|---|
| Incident queue | `data_pipeline.fetch_fulfillment_incidents()` | `tiger_decisions.fct_allocation_decisions`, `fct_otif`, `dim_customer` |
| Per-plant ATP | `agent_tools.get_network_inventory()` | `tiger_semantic.fct_inventory_projection` |
| Penalty rate | `agent_tools.get_customer_penalty_profile()` | `dim_customer` + `fct_chargebacks` |
| Region | inline query in `fulfillment_simulate` | `dim_customer.customer_region_state` |
| Delivery context | inline queries | `dim_plant`, `fct_shipments`, `dim_carrier` |
| Freight $/cs | `fulfillment_optimizer.lookup_freight_cost()` | `config/freight_costs.json` |
| Solve | `fulfillment_optimizer._solve_lp()` (+ `_scenario_default` / `_scenario_optimal`) | — (PuLP/CBC) |

---

## 2. Step-by-step trace

### Step 1 — Incident appears in the queue
`GET /fulfillment/incidents` → `fetch_fulfillment_incidents()` takes orders that were
ACCEPT/PARTIAL_FULFILL in Order Triage and joins them against execution-risk signals.
`inc-001` surfaces because Walmart runs an aggressive chargeback program
(`otif_aggressive = Y`, avg chargeback $128.77/incident, 922 historical chargebacks).

### Step 2 — Frontend fires the simulate request
On incident-select, `runFulfillmentSimulate()` POSTs:

```json
POST /fulfillment/simulate
{
  "sold_to": "1000001",
  "material_number": "70020102",
  "ordered_quantity_cases": 829,
  "requested_delivery_date": "2026-06-10",
  "origin_plant": "US02"
}
```

### Step 3 — Per-plant available inventory (ATP)
`get_network_inventory("70020102")` queries `fct_inventory_projection`, taking the
**earliest forward projection week per plant** (`ending_inventory_cases`). Phase-1 caveat:
`committed = 0` (open commitments not yet subtracted), so `available = ending`.

```sql
WITH per_plant AS (
  SELECT plant_code,
         ARRAY_AGG(STRUCT(projection_week_start_date, ending_inventory_cases)
                   ORDER BY projection_week_start_date ASC LIMIT 1)[OFFSET(0)] AS first_proj
  FROM `tiger_semantic.fct_inventory_projection`
  WHERE material_fert_number = '70020102'
  GROUP BY plant_code )
SELECT plant_code,
       first_proj.ending_inventory_cases AS available
FROM per_plant
WHERE first_proj.ending_inventory_cases > 0
ORDER BY plant_code
```

**Returned rows:**

| plant_code | ending | committed | available (cs) |
|---|---|---|---|
| DC01 | 24 | 0 | 24 |
| DC02 | 27 | 0 | 27 |
| DC03 | 27 | 0 | 27 |
| DC04 | 19 | 0 | 19 |
| DC05 | 21 | 0 | 21 |
| US02 | 5,063 | 0 | 5,063 |

Network ATP total = 24+27+27+19+21+5,063 = **5,181 cs** ≫ 829 ordered → fully coverable.

### Step 4 — Customer penalty rate ($/case)
`get_customer_penalty_profile("1000001")` joins `dim_customer` with 180-day `fct_chargebacks`:

```json
{
  "sold_to": "1000001",
  "otif_target_pct": 98.0,
  "priority_tier_name": "Strategic - Tier 1",
  "avg_chargeback_per_late_case_usd": 141.16,
  "sample_size_chargebacks": 207,
  "penalty_per_case_usd": 8.01,
  "is_fallback": false
}
```

→ **`penalty_per_case = $8.01/cs`** (the LP's shortfall cost coefficient). Not the fallback ($25).

### Step 5 — Resolve the customer region
The frontend didn't send `customer_region`, so the handler looks it up:
`dim_customer.customer_region_state` for `1000001` = **`AR`** (Arkansas).

### Step 6 — Delivery context (best-effort)
`dim_plant` + `fct_shipments` + `dim_carrier`:
origin **US02 = Tiger Foods Chicago Plant (Mfg)**, ~**48h** transit, primary carrier **Eagle Express Freight**.
(If these queries fail the solver still runs — the cards just omit transit/carrier labels.)

### Step 7 — Freight cost coefficients
`lookup_freight_cost(plant, region="AR")` reads `config/freight_costs.json`. AR normalizes to a
US-census region; the per-case rates the LP actually used (`meta.freight_costs_used`, $/cs):

| Plant | $/cs |
|---|---|
| **DC05** | **2.2** |
| **DC02** | **3.0** |
| **DC03** | **3.2** |
| **US02** | **3.4** |
| DC04 | 3.8 |
| DC01 | 4.8 |

### Step 8 — Solve the LP
`_solve_lp(ordered_qty=829, available_by_plant, freight_by_plant, penalty_per_case=8.01)`,
PuLP + CBC → status **Optimal** in **13 ms**.

```
Decision vars:  x[p] ≥ 0  (cases shipped from plant p) ;  shortfall ≥ 0
Minimize:       Σ_p  freight[p]·x[p]  +  8.01·shortfall
Subject to:     Σ_p x[p] + shortfall = 829                  (demand balance)
                0 ≤ x[p] ≤ available[p]   for each plant     (ATP capacity)
```

Because network ATP (5,181) ≥ 829, **shortfall = 0** in every feasible plan → no penalty.
The objective therefore reduces to **minimizing freight**.

### Step 9 — The two scenario cards

**Scenario A — Default (origin only):** ship all 829 cs from US02.
```
freight = 829 × $3.4 = $2,818.60      fine = $0      netImpact = −$2,818.60
```

**Scenario B — Optimal Alternate (LP optimum, ⭐ recommended):** the LP fills from the
cheapest $/cs plants first, up to each plant's (tiny) DC capacity, then the balance from US02:

| Order filled | Plant | $/cs | cap (cs) | cases taken | running total |
|---|---|---|---|---|---|
| 1st | DC05 | 2.2 | 21 | 21 | 21 |
| 2nd | DC02 | 3.0 | 27 | 27 | 48 |
| 3rd | DC03 | 3.2 | 27 | 27 | 75 |
| 4th | US02 | 3.4 | 5,063 | **754** | 829 ✓ |
| — | DC04 (3.8), DC01 (4.8) | — | — | 0 | (costlier than US02 → skipped) |

```
freight = 21×2.2 + 27×3.0 + 27×3.2 + 754×3.4
        =  46.20 +  81.00 +  86.40 + 2,563.60
        = $2,777.20            fine = $0      netImpact = −$2,777.20
savingsVsDefault = 2,818.60 − 2,777.20 = $41.40   →  isRecommended = true
```

| | Scenario A — Default | Scenario B — Optimal ⭐ |
|---|---|---|
| Plan | 829 cs · US02 | DC02 27 + DC03 27 + DC05 21 + US02 754 |
| dcSource | US02 (Chicago Mfg) | "4 plants" |
| Arrival | On Time (~48h) | On Time (~48h) |
| Freight | **$2,818.60** | **$2,777.20** |
| Fine / Penalty | $0 | $0 |
| Net impact | −$2,818.60 | −$2,777.20 |
| Saves vs default | $0 | **$41.40** |

> Why only $41 saved? US02 (origin) is already a cheap lane at $3.4/cs and carries the bulk
> (754 cs). The three regional DCs only shave the first 75 cases (their entire on-hand), so the
> marginal benefit is small — but the LP still surfaces it as the optimum.

### Step 10 — Response payload (real)

```json
{
  "scenarios": [
    {
      "id": "scenario-a-default", "name": "Scenario A: Default Route",
      "tagline": "Do Nothing", "arrival": "On Time (~48h transit)",
      "dcSource": "US02 (Chicago Mfg)", "freightCost": 2818.6, "fine": 0,
      "netImpact": -2818.6, "savingsVsDefault": 0, "isRecommended": false,
      "transitHours": 48, "carrierName": "Eagle Express Freight",
      "plantDetails": [{ "code": "US02", "city": "Chicago", "type": "Manufacturing", "qty": 829 }]
    },
    {
      "id": "scenario-b-optimal", "name": "Scenario B: Optimal Alternate Route",
      "tagline": "LP Optimized", "arrival": "On Time (~48h transit)",
      "dcSource": "4 plants", "freightCost": 2777.2, "fine": 0,
      "netImpact": -2777.2, "savingsVsDefault": 41.4, "isRecommended": true,
      "transitHours": 48, "carrierName": "Eagle Express Freight",
      "plantDetails": [
        { "code": "DC02", "city": "Atlanta",      "type": "Distribution", "qty": 27 },
        { "code": "DC03", "city": "Dallas",       "type": "Distribution", "qty": 27 },
        { "code": "DC05", "city": "Indianapolis", "type": "Distribution", "qty": 21 },
        { "code": "US02", "city": "Chicago",      "type": "Manufacturing","qty": 754 }
      ],
      "rationale": "Ships 27 cs from DC02 (Atlanta), 27 cs from DC03 (Dallas), 21 cs from DC05 (Indianapolis), 754 cs from US02 (Chicago Mfg). Saves $41 vs Default by reducing freight by $41 via regional DCs closer to the customer. Total freight: $2,777. Est. transit: ~48h via Eagle Express Freight."
    }
  ],
  "meta": {
    "solver_status": "Optimal", "elapsed_ms": 13,
    "penalty_per_case": 8.01, "ordered_qty": 829,
    "origin_plant": "US02", "customer_region": "AR",
    "freight_costs_used": { "DC01": 4.8, "DC02": 3.0, "DC03": 3.2, "DC04": 3.8, "DC05": 2.2, "US02": 3.4 },
    "inventory_by_plant": {
      "DC01": {"ending":24,"committed":0,"available":24},
      "DC02": {"ending":27,"committed":0,"available":27},
      "DC03": {"ending":27,"committed":0,"available":27},
      "DC04": {"ending":19,"committed":0,"available":19},
      "DC05": {"ending":21,"committed":0,"available":21},
      "US02": {"ending":5063,"committed":0,"available":5063}
    },
    "is_demo_seed": false
  }
}
```

### Step 11 — What the planner sees (UI mapping)

| UI element | Field(s) |
|---|---|
| **Transportation Agent tool-call terminal** `✓ 13ms` | `meta.elapsed_ms`, `meta.solver_status`, recommended name, `savingsVsDefault` |
| **Resolution Summary** tiles | Ordered 829 · Recommended Fulfill 829 (100%) · Freight $2,777 · Fine $0 · Net −$2,777 · Saves $41 |
| **Scenario cards** (Default vs Optimal) | the two `scenarios[]` objects |
| **AI Rationale** | `scenario.rationale` |
| **DC Sourcing Explorer** rows | `meta.inventory_by_plant` (Available) + Scenario B `plantDetails` (Allocated) → After Fill |
| **AI Split Sourcing Plan** chips | DC02 27 (3%) · DC03 27 (3%) · DC05 21 (3%) · US02 754 (91%) |

**DC Sourcing Explorer** (computed): coverage bar = available ÷ 829; allocated = the split; after-fill = available − allocated.

| DC | Available | Coverage | Allocated | After Fill |
|---|---|---|---|---|
| US02 (origin) | 5,063 | 100% (OK) | 754 | 4,309 |
| DC02 | 27 | 3% (BELOW SS) | 27 | 0 (Depleted) |
| DC03 | 27 | 3% (BELOW SS) | 27 | 0 (Depleted) |
| DC05 | 21 | 3% (BELOW SS) | 21 | 0 (Depleted) |
| DC01 | 24 | 3% (BELOW SS) | — | 24 |
| DC04 | 19 | 2% (BELOW SS) | — | 19 |

---

## 3. Reproduce it

```bash
# 1) The incident queue (pick inc-001)
curl -s http://localhost:8080/fulfillment/incidents | jq '.incidents[0]'

# 2) The simulate call (the LP output traced above)
curl -s -X POST http://localhost:8080/fulfillment/simulate \
  -H "Content-Type: application/json" \
  -d '{"sold_to":"1000001","material_number":"70020102","ordered_quantity_cases":829,"requested_delivery_date":"2026-06-10","origin_plant":"US02"}' | jq '{meta, scenarios}'
```

Read-only BigQuery cross-checks (run inside the backend container):
```sql
-- per-plant ATP
SELECT plant_code, MIN(projection_week_start_date) wk, ANY_VALUE(ending_inventory_cases) avail
FROM `tiger_semantic.fct_inventory_projection`
WHERE material_fert_number = '70020102' GROUP BY plant_code ORDER BY plant_code;

-- penalty inputs
SELECT AVG(NULLIF(chargeback_amount_usd,0)) avg_cb, COUNT(*) n
FROM `tiger_semantic.fct_chargebacks`
WHERE sold_to = '1000001'
  AND chargeback_assessed_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY);
```

---

## 4. Caveats (honesty)
- Values are from the **current demo BigQuery dataset**; re-running may shift if the underlying
  projection/chargeback data changes. The **mechanics are stable**: cheapest-first LP fill,
  `freight = Σ qty×rate`, penalty only on shortfall.
- **Phase-1**: `committed` is always 0 (open commitments not yet subtracted from ATP), so
  `available = ending` projection. When commitments are wired in, only `committed`/`available`
  change — the LP and card shapes are unchanged.
- This path is **deterministic and LLM-free** — re-running `inc-001` yields the identical split,
  unlike the 5-agent Order Triage flow.

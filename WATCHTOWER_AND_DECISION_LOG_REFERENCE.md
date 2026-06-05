# Agent Watchtower & Decision Log — API / Data / Calculation Reference

_Reflects the state after today's changes. Both tabs are driven by **one** backend endpoint:
`GET /dashboard-data`. Values shown as "live" were verified against the running stack today._

---

## 0. Request routing (shared by both tabs)

```
Watchtower.tsx / DecisionLog.tsx
  └─ useDashboardData()              (lib/hooks.ts)
       └─ fetchDashboard()           (lib/api.ts — 60s in-memory cache, dedupes concurrent calls)
            └─ GET /api/dashboard-data   → frontend proxy strips /api →
                 GET /dashboard-data     (main.py:316 dashboard_data())
                      └─ data_pipeline.fetch_dashboard_data()
```

- **`fetch_dashboard_data()`** builds a `tiger_semantic` BigQuery client (`_bq_client()`, **us-central1**),
  then runs each section through **`_safe_section(name, fn, client, default)`** — a fault isolator: if one
  builder throws, that section degrades to its default (`{}`/`[]`) and the rest still render.
- Response keys: `globalKPIs`, `alerts`, `networkNodes` (Watchtower) and `decisionCaptureLog` (Decision Log),
  plus `purchaseOrders`, `rootCauseSummary`, etc. (other tabs).
- **Two BigQuery regions are involved**: `tiger_semantic` (us-central1) and `tiger_decisions` (US
  multi-region). They can't be joined in one query, so the US-region tables use a separate US-located client
  and results are merged in Python.

---

## 1. AGENT WATCHTOWER

Consumes three sections of `/dashboard-data`: **`globalKPIs`** (ribbon + 6 cards), **`alerts`** (inbox),
**`networkNodes`** (map).

### 1A. globalKPIs — `_fetch_global_kpis()` (data_pipeline.py:90)

**Anchor date:** the data is historical, so windows anchor to `MAX(delivery_date_promised)` from `fct_otif`
(currently **2026-05-04**), NOT `CURRENT_DATE()` — except the two `tiger_decisions` KPIs (real-time), which
use `CURRENT_DATE()`.

#### Impact ribbon (3 tiles)

| Tile | Field | Calculation | Source table(s) | Live |
|---|---|---|---|---|
| OTIF Fines at Risk (7d) | `otifFinesAtRisk7Day` | `SUM(ordered_quantity_cases × avg_unit_price × 0.02)` for `otif_flag='N'` in the 7d before anchor | `fct_otif` ⨝ `fct_sales_orders` (per-material avg `unit_price`) | **$1,291** |
| Cases At Risk This Week | `casesAtRiskThisWeek` | `SUM(ordered_quantity_sales_uom)` where `requested_delivery_date` within ±7d of anchor, not rejected | `fct_sales_orders` | **88,920** |
| Agent Acceptance Rate | `agentRecommendationAcceptanceRate` | `aligned / total` (0–1 fraction; UI ×100). `aligned` = `(user approved/accept) == (agent ACCEPT/PARTIAL)` | `fct_user_execution_telemetry` (US) | **1.0 → 100%** |

#### 6 metric cards (added today)

| Card | Field | Calculation | Source | Live |
|---|---|---|---|---|
| OTIF Score | `otifScore` (+`otifScoreDeltaPp`) | `COUNTIF(otif_flag='Y')/COUNT(*) ×100` over trailing 90d; delta vs prior 90d | `fct_otif` | **93.0%, +8.2pp** (target 95%*) |
| Fill Rate | `fillRate` (+`fillRateDeltaPp`) | `SUM(delivered_quantity_cases)/SUM(ordered_quantity_cases) ×100` over 90d; delta vs prior 90d | `fct_otif` | **99.5%, +0.4pp** (target 98%*) |
| Fines at Risk | `otifFinesAtRisk7Day` | same as ribbon | `fct_otif` ⨝ `fct_sales_orders` | **$1K** (target <$250K*) |
| Open Orders | `openOrders` | `COUNT(*)` where `rejection_reason IS NULL AND requested_delivery_date >= CURRENT_DATE()` | `fct_sales_orders` | **11,585** |
| Orders in Triage | `ordersInTriage` | `row_count` of `get_demo_scenario_candidates(limit=500)` (tier-1 open orders above consensus forecast w/ tight supply) | `fct_sales_orders` ⨝ `dim_material` ⨝ `fct_forecast` ⨝ `fct_inventory_projection` | **50** |
| AI Resolution | `aiResolutionMinutes` | `AVG(duration_ms)/60000` where `duration_ms IS NOT NULL` (wall-time of the 5-agent run, measured in `v23_triage`, stored on the triage cache) | `fct_triage_cache` (US) | **null → "—"** until a triage runs post-deploy (target <10 min*) |

`*` targets are **business config constants**, not metrics.

#### Other globalKPIs (computed; some not shown on the ribbon)
- `networkCFR` = 90d CFR (= `otifScore`); `networkCFRTarget` = 98.
- `revenuePreservedMTD` = `SUM(line_net_value_usd)` in the anchor month (`fct_sales_orders`) → **$242K**.
- `decisionsLoggedMTD` = `COUNT(fct_allocation_decisions WHERE decision_date >= month start)` (US) → **2**.
- `activeAlerts` = `COUNT(otif_flag='N')` last 30d.
- `demurrageAvoidedWTD` = **0**, intentionally unbacked (no demurrage feed exists) — NOT displayed.

> **TopBar note:** the header strip reads the same `globalKPIs`. Today's fix: "Agent Accept Rate" now
> multiplies the 0–1 fraction by 100 (was showing `1.0%`, now `100%`), matching the Watchtower.

### 1B. alerts — `_fetch_alerts()` (data_pipeline.py:173) → "Agent Priority Inbox"

- **Query:** `fct_otif` where `otif_flag='N'`, last 30d before anchor, `LIMIT 8`, LEFT JOIN per-material avg
  `unit_price` from `fct_sales_orders`.
- **Per alert:** `fineAtRisk = int(ordered_quantity_cases × unit_price × 0.02)`;
  `severity = "critical" if fine ≥ 15000 else "warning"`; description from `delivery_number`,
  `primary_material_brand`, `otif_root_cause_category`, `otif_fail_reason`; `actionTab = "simulator"`.
- The "N Alerts" badge = `alerts.length`.

### 1C. networkNodes — `_fetch_network_nodes()` (data_pipeline.py:240) → topology map

- **Node geometry is STATIC** (`_STATIC_NODES`, data_pipeline.py:75): hardcoded plant/DC coords
  (US01 Chicago, US02 Terre Haute, DC-01…DC-05). The map connection lines are also hardcoded in
  `Watchtower.tsx`.
- **Only the status color is data-driven:** `fct_otif` ⨝ `fct_sales_orders` ON `(sold_to,
  primary_material_number=material_number)`, `COUNT(*) GROUP BY plant_code`. Per node: `≥3 → critical`,
  `>0 → warning`, `0 → healthy`.

---

## 2. DECISION LOG

Consumes **one** section: **`decisionCaptureLog`** — `_fetch_decision_log()` (data_pipeline.py:1147).

### 2A. Source & row build

- **Table:** `tiger_decisions.fct_allocation_decisions` (US region, `_bq_decisions()` client).
- **Filter:** excludes `PLACEHOLDER` test rows (`trigger.customer_name NOT LIKE 'PLACEHOLDER%'`); `LIMIT 20`,
  newest first. **Live: 6 real rows.**
- **Extracted per row** — columns: `ordered/allocated/shortfall_quantity_cases`, `fill_rate_pct`,
  `decision_status`; and from the `decision_reason` JSON (written by `dce_write`):
  `agent_recommendation`, `user_decision`, **`decision_aligned_with_agent`**, `rejection_reason`,
  `trigger.sales_order_number`, `trigger.customer_name`, `trigger.material_number`.
- **Derived fields:**
  - `aligned` (bool) = `decision_aligned_with_agent == 'true'` (fallback for legacy rows: user approved).
  - `outcome`: `fill≥100 → "Fulfilled · CFR 100%"`; `alloc=0 & short>0 → "Not allocated · N cs short"`;
    `0<fill<100 → "Partial · X% · N cs short"`.
  - **`financialImpact` = OTIF penalty exposure** = `-(shortfall_cases × penalty_per_case)` for `shortfall>0`,
    else `0`. `penalty_per_case` from **`get_customer_penalty_profile(sold_to)`** (agent_tools.py:1719 — avg
    chargeback per late case over 180d from `fct_chargebacks`, fallback $25), cached per customer.
  - `wentWrong` = `(not aligned) AND shortfall>0`.

### 2B. Four summary tiles (DecisionLog.tsx)

| Tile | Calculation | Live |
|---|---|---|
| Total Decisions | `decisionCaptureLog.length` | **6** |
| Aligned with AI | `${count(aligned===true)} of ${total}` | **6 of 6** |
| AI Acceptance Rate | `round(aligned/total ×100)` | **100%** |
| Overrides Gone Wrong | `count(wentWrong===true)` | **0** |

### 2C. "Override Outcomes — Where Human and AI Disagreed"

- Filters to `aligned === false` (overrides). Per row: customer + material, "Agent said: {rec}",
  `Override: "{reason}"`, outcome, `financialImpact` ($). Red summary line when any `wentWrong`.
- **Empty-state** (current): *"No human–AI disagreements recorded — every logged decision aligned with the
  agent's recommendation."* — because all 6 real rows are aligned approvals. Populates when a planner
  rejects/overrides an agent rec in Order Triage.

### 2D. Complete Decision History

Columns: **Time · Order · Customer · Agent Rec · Decision · Override Reason · Outcome · Financial · Aligned**
(real `aligned` Yes/No, not faked). Live sample:

| Date | Customer | Agent | Decision | Outcome | Financial |
|---|---|---|---|---|---|
| 2026-06-02 | Walmart | DEFER | approved | Not allocated · 829 cs short | **−$6,707** |
| 2026-05-22 | Amazon | ACCEPT | approved | Fulfilled · CFR 100% | $0 |
| 2026-05-22 | Petsmart | REJECT | approved | Not allocated · 72 cs short | **−$5,094** |
| 2026-05-21 | Amazon | DEFER | approved | Not allocated · 239 cs short | **−$1,788** |
| 2026-05-20 | Walmart | ACCEPT | approved | Fulfilled · CFR 100% | $0 |

---

## 3. Real vs derived vs config (honesty map)

- **Real (live BigQuery):** OTIF score, fill rate, fines-at-risk, cases-at-risk, open orders, orders-in-triage,
  acceptance rate, decisions-logged, all alerts, node statuses, all decision-log rows + alignment.
- **Derived (real inputs, computed exposure):** decision-log `financialImpact` (shortfall × per-customer
  chargeback rate) — an exposure estimate, not a booked chargeback (outcome data isn't stored).
- **Config constants:** the card targets (95% OTIF, 98% fill, <$250K, <10 min).
- **Static:** topology node coordinates + map lines.
- **Intentionally empty/unbacked:** `demurrageAvoidedWTD` (no source — not displayed); `aiResolutionMinutes`
  (null until triages run); Override Outcomes (no overrides in data yet).

## 4. Key files
- `backend/code/orchestrator_service/main.py` — `dashboard_data()` route (L316); triage duration
  instrumentation in `v23_triage` + `fct_triage_cache`.
- `backend/code/orchestrator_service/data_pipeline.py` — `_fetch_global_kpis` (L90), `_fetch_alerts` (L173),
  `_fetch_network_nodes` (L240), `_fetch_decision_log` (L1147), `_safe_section`, `fetch_dashboard_data`.
- `backend/code/agent_tools.py` — `get_customer_penalty_profile` (L1719), `get_demo_scenario_candidates`.
- `frontend/src/components/tabs/Watchtower.tsx`, `DecisionLog.tsx`; `frontend/src/components/layout/TopBar.tsx`.

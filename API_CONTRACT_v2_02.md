# API Contract — Tiger Foods Customer Supply Agentic AI (v2.02)

The locked contract between the OpEx Tower front-end and the v2.02 backend.
This is the reference for any front-end iteration. Field names are the real
`tiger_semantic` schema names — do not reintroduce `customer_kunnr`,
`material_matnr`, `ordered_qty_cs`, or `mabd`.

All routes are served by the single Cloud Run service. The front-end calls
them under `/api/*`; the Express server (`server.js`) strips `/api` and
proxies to the backend, attaching a GCP identity token.

---

## GET /health

Liveness. No params.

```json
{ "status": "ok", "project": "resilience-riskradar",
  "version": "2.02.0", "provider": "gemini",
  "providerName": "Gemini 2.5 Flash (Vertex AI)" }
```

---

## GET /dashboard-data

Live `tiger_semantic` data shaped to the front-end `DashboardData` type.
Populates the whole dashboard. Called once on `App` mount; falls back to
bundled `mockData.json` on failure.

Returns an object with these top-level keys: `globalKPIs`, `alerts`,
`networkNodes`, `purchaseOrders`, `fulfillmentIncidents`,
`rootCauseSummary`, `safetyStockRecommendations`, `decisionCaptureLog`,
`_meta`.

Each `purchaseOrders` entry carries the real identifiers the agent flow
needs:

```json
{
  "id": "po-001",
  "orderNumber": "#44019",
  "customer": "Walmart",          // display name — NOT an identifier
  "tier": "Tier 1",
  "skuCode": "MAT-000812",
  "skuName": "Tiger Bites Original 12ct",
  "requestedQty": 6000,
  "requestedQtyUnit": "CS",
  "forecastQty": 3800,
  "severity": "warning",
  "issue": "Forecast Violation — 58% Above Plan",
  "issueDetail": "...",
  "agents": ["Customer Supply Agent", "Supply Planning Agent"],
  "recommendedAction": "...",
  "proposedAllocation": "5,100 CS",
  "proposedHold": "900 CS (Backorder)",
  "financialImpact": "Pending agent analysis",
  "confidenceScore": 0.85,
  "mabd": "2026-06-02",
  "soldTo": "0001000245",         // real SAP sold-to — USE THIS
  "materialNumber": "MAT-000812"  // real SAP material — USE THIS
}
```

Sections degrade individually: if one query fails the rest still render.
`decisionCaptureLog` is populated from `tiger_decisions.fct_allocation_
decisions` once that table exists; `[]` otherwise.

---

## POST /sessions

Start a 5-agent evaluation. The body uses **real schema field names** under
`demo_order`.

Request:
```json
{
  "trigger_type": "new_order",
  "trigger_source": "demo_payload",
  "demo_order": {
    "sold_to": "0001000245",
    "material_number": "MAT-000812",
    "ordered_quantity_cases": 6000,
    "requested_delivery_date": "2026-06-02",
    "customer_name": "Walmart",
    "material_description": "Tiger Bites Original 12ct",
    "sales_order_number": "44019"
  }
}
```

- `trigger_source`: `"demo_payload"` (inline order) or `"edi_850"`
  (backend reads the order from `fct_edi_purchase_orders` — then send
  `isa_control_id` instead of `demo_order`).
- An empty or omitted `demo_order` makes the backend resolve a real
  data-derived demo scenario.
- `sold_to` and `material_number` must be the real SAP identifiers from
  `/dashboard-data` (`po.soldTo`, `po.materialNumber`). The customer
  **display name is not a valid `sold_to`** — never derive one from it.

The front-end helper `buildStartSessionRequest(po)` in `OrderTriage.tsx`
builds this body; reuse it.

Response:
```json
{
  "session_id": "session_20260518_153000_a1b2c3",
  "status": "active",
  "trigger_source": "demo_payload",
  "resolved_order": { "...": "the normalized order the backend will run" },
  "placeholder_used": false
}
```

`placeholder_used: true` means the dataset was not loaded and a static
placeholder order was used — useful for a UI "demo data" badge.

---

## GET /sessions/{session_id}

Poll session state. The front-end polls every 4s (max 25 attempts).

Returns the session document. Key fields:

- `status`: `active` -> `awaiting_approval` -> `approved` / `rejected`,
  or `error`.
- `final_action_card`: the `CustomerSupplyDecision` once `status` is
  `awaiting_approval`. Shape the front-end reads:

```json
{
  "recommendation": {
    "action": "PARTIAL_FULFILL",
    "fulfill_qty_cs": 5100,
    "confidence": 0.87,
    "expected_outcome": "..."
  },
  "reasoning_chain": {
    "which_specialists_drove_decision": ["supply_planning", "demand_planning"],
    "key_trade_offs": ["...", "..."],
    "what_would_change_the_decision": "..."
  },
  "specialist_signals": { "...": "per-agent signals" },
  "conflicts_detected": [ { "type": "...", "resolution": "..." } ]
}
```

Live agent step-by-step activity streams from the Firestore sub-collection
`agent_sessions/{session_id}/steps`, ordered by `step_index` ascending —
the front-end can subscribe with `onSnapshot` for a live agent trace.

---

## POST /sessions/{session_id}/approve

```json
{ "user_id": "joe.marcantonio", "approval_notes": "optional" }
```
Returns `{ "decision_id": "...", "status": "approved" }`. Writes the
decision to `tiger_decisions.fct_allocation_decisions`. 409 if the session
is not `awaiting_approval`.

## POST /sessions/{session_id}/reject

```json
{ "user_id": "joe.marcantonio", "rejection_reason": "required" }
```
Returns `{ "decision_id": "...", "status": "rejected" }`.

---

## POST /chat

Nexus co-pilot — multi-turn conversation, Gemini 2.5 Flash via Vertex AI.

Request:
```json
{
  "messages": [
    { "role": "user",  "text": "Why is Walmart OTIF down this week?" },
    { "role": "agent", "text": "..." },
    { "role": "user",  "text": "What would fix it?" }
  ],
  "systemPrompt": "optional system instruction",
  "agentId": "nexus"
}
```
`role` is `"user"` or `"agent"`. The last message is the new turn; the rest
are history.

Response: `{ "text": "the assistant reply" }`.

---

## GET /demo/candidates?limit=10

Data-derived shortlist of strong demo scenarios (tier-1 customers,
above-forecast orders, tight forward supply). Use it to pick a demo anchor;
pin it via the `DEMO_SOLD_TO` / `DEMO_MATERIAL` backend env vars.

---

## Field-name migration reference

| Old (do not use) | Real schema name |
|---|---|
| `customer_kunnr` | `sold_to` |
| `material_matnr` | `material_number` |
| `ordered_qty_cs` | `ordered_quantity_cases` |
| `mabd` | `requested_delivery_date` |
| `sales_order_id` | `sales_order_number` |
| `trigger_payload` (wrapper) | `demo_order` (under `trigger_source`) |

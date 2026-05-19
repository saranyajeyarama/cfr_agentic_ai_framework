/**
 * Shared backend API helpers for the OpEx Tower front-end. (v2.02)
 *
 * Single source of truth for the POST /sessions request contract. Both
 * Order Triage and the Fulfillment Simulator build their session-start
 * payloads here so the contract can never drift between call sites.
 *
 * The backend (Tiger Foods Agentic AI v2.02) expects a normalized order
 * under `demo_order` with REAL tiger_semantic field names:
 *   sold_to, material_number, ordered_quantity_cases, requested_delivery_date
 *
 * See API_CONTRACT_v2_02.md. Do NOT reintroduce customer_kunnr /
 * material_matnr / ordered_qty_cs / mabd / trigger_payload.
 */

/** A minimal order shape any caller can satisfy. */
export type OrderLike = {
  /** Real SAP sold-to customer number. NOT the display name. */
  soldTo?: string;
  /** Real SAP material number. */
  materialNumber?: string;
  /** Cases ordered. */
  requestedQty: number;
  /** ISO requested delivery date; falls back to today + 7d if absent. */
  mabd?: string;
  /** Customer display name — context only, never used as an identifier. */
  customerName?: string;
  /** Material description — context only. */
  materialDescription?: string;
  /** Sales order / reference number — '#' stripped if present. */
  referenceNumber?: string;
};

export type TriggerType = 'new_order' | 'alert_fired' | 'manual';

/**
 * Build the POST /sessions request body for the v2.02 backend contract.
 *
 * Real identifiers (soldTo / materialNumber) come from /dashboard-data.
 * When they are absent — e.g. running on bundled mock data — the fields
 * are omitted and the backend falls back to resolve_demo_scenario().
 * In that mock-data case the agent evaluates a backend-chosen demo order,
 * which will not match the row the user clicked; that is expected and
 * only happens without a live warehouse.
 */
export function buildStartSessionRequest(
  order: OrderLike,
  triggerType: TriggerType = 'new_order',
) {
  const demo_order: Record<string, unknown> = {
    ordered_quantity_cases: order.requestedQty,
    requested_delivery_date:
      order.mabd ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
  };
  if (order.customerName) demo_order.customer_name = order.customerName;
  if (order.materialDescription)
    demo_order.material_description = order.materialDescription;
  if (order.soldTo) demo_order.sold_to = order.soldTo;
  if (order.materialNumber)
    demo_order.material_number = order.materialNumber;
  if (order.referenceNumber)
    demo_order.sales_order_number = order.referenceNumber.replace('#', '');

  return {
    trigger_type: triggerType,
    trigger_source: 'demo_payload' as const,
    demo_order,
  };
}

/** POST /sessions and return the parsed StartSessionResponse. Throws on
 *  a non-2xx so callers can surface the backend's error detail. */
export async function startSession(
  order: OrderLike,
  triggerType: TriggerType = 'new_order',
): Promise<{ session_id: string; status: string;
             placeholder_used: boolean }> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildStartSessionRequest(order, triggerType)),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Server error ${res.status}`);
  }
  return res.json();
}

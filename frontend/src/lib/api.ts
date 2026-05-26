/**
 * Backend API client — v2.3 (Prompt 0.3).
 *
 * Single source of truth for ALL backend calls. Components import the
 * typed functions below; they do NOT call `fetch()` directly.
 *
 * Base URL resolution:
 *   import.meta.env.VITE_API_BASE_URL  (preferred for prod / deployed)
 *   '/api'                              (default — works with the
 *                                        Docker server.js proxy and
 *                                        Vite dev-server proxy)
 *
 * Note on "no fallback": the spec requires no fallback to MOCK DATA.
 * Routing through the local proxy is not a mock fallback — it still
 * hits the same live backend. The proxy default is what keeps local
 * Docker dev working alongside production.
 *
 * Error handling:
 *   HTTP 422 (validation)       → throws ValidationError
 *   HTTP 5xx / 4xx (other)      → throws BackendError
 *   No response (network down)  → throws NetworkError
 *
 * Components catch these and render an error state. They MUST NOT fall
 * back to static or generated data.
 */

import type {
  // v2.3 contract types (spec names)
  Order, BackendPayload, TriageResponse,
  ChatMessage, ChatResponse,
  SimulateRequest, SimulateResponse,
  SimulatorIncident,
  DataHealthResponse, DashboardData,
  ExecutionTelemetryEntry,
  // Backwards-compat returned shapes
  V23OrdersResponse,
} from './types';

// ─── Base URL ────────────────────────────────────────────────────────────────

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
export const API_BASE: string = RAW_BASE
  ? RAW_BASE.replace(/\/+$/, '')   // strip trailing slashes
  : '/api';                         // local Docker / Vite proxy default

// ─── Error classes ───────────────────────────────────────────────────────────

/** No response from the server — the request never reached anything. */
export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** HTTP 422 — request body failed backend validation. */
export class ValidationError extends Error {
  constructor(message: string, public detail?: unknown) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Any non-422 non-2xx response. `body` carries the parsed JSON if present. */
export class BackendError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
    this.name = 'BackendError';
  }
}

// ─── Low-level request helper ────────────────────────────────────────────────

type RequestOpts = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Set true to skip JSON parsing on success (returns null). */
  noContent?: boolean;
  /** Optional AbortSignal — passes through to fetch so callers can
   *  cancel long-running requests (e.g. the 30-180s triage flow). */
  signal?: AbortSignal;
};

/** Thrown when a request is cancelled via AbortSignal. Callers should
 *  treat this as a user-initiated cancel, not an error. */
export class AbortError extends Error {
  constructor(message = 'Request aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const hasBody = opts.body !== undefined && opts.body !== null;
  let res: Response;

  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    // AbortController.abort() surfaces as DOMException("AbortError")
    // OR a TypeError on older runtimes — detect both.
    const err = e as { name?: string };
    if (err?.name === 'AbortError') {
      throw new AbortError();
    }
    throw new NetworkError(`Could not reach ${url}`, e);
  }

  if (res.status === 422) {
    const parsed = await res.json().catch(() => null);
    throw new ValidationError(
      `Validation failed (422) on ${path}`,
      parsed?.detail ?? parsed ?? null,
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new BackendError(
      `${res.status} ${res.statusText} on ${path}`,
      res.status,
      body,
    );
  }

  if (opts.noContent) return null as T;
  return (await res.json()) as T;
}

// =============================================================================
// SPEC FUNCTIONS — Prompt 0.3
// =============================================================================

// ─── /v23/orders ─────────────────────────────────────────────────────────────

export async function fetchOrders(limit?: number): Promise<Order[]> {
  const n = Math.max(1, limit ?? 10);
  const res = await request<{ orders: Order[]; row_count: number; data_available: boolean; rationale: string | null }>(
    `/v23/orders?limit=${n}`,
  );
  return res.orders ?? [];
}

// ─── /v23/triage/{order_id} ──────────────────────────────────────────────────

export async function triageOrder(
  orderId: string,
  backend: BackendPayload,
  signal?: AbortSignal,
): Promise<TriageResponse> {
  return request<TriageResponse>(
    `/v23/triage/${encodeURIComponent(orderId)}`,
    { method: 'POST', body: backend, signal },
  );
}

// ─── /dashboard-data (60s in-memory cache) ───────────────────────────────────

let dashboardCache: { data: DashboardData; t: number } | null = null;
const DASHBOARD_TTL_MS = 60_000;

export async function fetchDashboard(): Promise<DashboardData> {
  if (dashboardCache && Date.now() - dashboardCache.t < DASHBOARD_TTL_MS) {
    return dashboardCache.data;
  }
  const data = await request<DashboardData>('/dashboard-data');
  dashboardCache = { data, t: Date.now() };
  return data;
}

/** Drop the cached dashboard so the next call hits the network. Call this
 *  after a decision is approved/rejected and you want fresh KPIs. */
export function invalidateDashboard(): void {
  dashboardCache = null;
}

// ─── /data-health ────────────────────────────────────────────────────────────

export async function fetchDataHealth(): Promise<DataHealthResponse> {
  return request<DataHealthResponse>('/data-health');
}

// ─── /fulfillment/incidents ──────────────────────────────────────────────────

export async function fetchSimulatorIncidents(): Promise<SimulatorIncident[]> {
  const res = await request<{ incidents: SimulatorIncident[]; meta?: Record<string, unknown> }>(
    '/fulfillment/incidents',
  );
  return res.incidents ?? [];
}

// ─── /fulfillment/simulate ───────────────────────────────────────────────────

export async function simulateFulfillment(
  req: SimulateRequest,
): Promise<SimulateResponse> {
  return request<SimulateResponse>('/fulfillment/simulate', {
    method: 'POST',
    body: req,
  });
}

// ─── /chat ───────────────────────────────────────────────────────────────────

/** Send a single user message to Nexus. The function builds the proper
 *  backend ChatRequest by appending the new message to the history. */
export async function chatNexus(
  message: string,
  history: ChatMessage[] = [],
): Promise<string> {
  const messages: ChatMessage[] = [
    ...history,
    { role: 'user', text: message },
  ];
  const res = await request<ChatResponse>('/chat', {
    method: 'POST',
    body: { messages, agentId: 'nexus' },
  });
  return res.text;
}

// ─── /sessions/{id}/approve and /reject ──────────────────────────────────────

export async function approveSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  await request<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}/approve`,
    { method: 'POST', body: { user_id: userId }, noContent: true },
  );
}

export async function rejectSession(
  sessionId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await request<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}/reject`,
    { method: 'POST', body: { user_id: userId, reason }, noContent: true },
  );
}

// ─── /telemetry/execution (utility, used by Decision Log) ─────────────────────

export async function fetchTelemetry(limit = 20): Promise<ExecutionTelemetryEntry[]> {
  try {
    const data = await request<ExecutionTelemetryEntry[] | { entries?: ExecutionTelemetryEntry[] }>(
      `/telemetry/execution?limit=${limit}`,
    );
    if (Array.isArray(data)) return data;
    return data.entries ?? [];
  } catch {
    // Telemetry is non-essential — empty list is acceptable on failure.
    return [];
  }
}

// =============================================================================
// LEGACY FUNCTIONS — kept for backwards compatibility with existing tabs.
// New code should prefer the spec names above.
// =============================================================================

// ─── /sessions (v2.02 contract — used by FulfillmentSimulator + OrderTriage) ─

export type OrderLike = {
  soldTo?: string;
  materialNumber?: string;
  requestedQty: number;
  mabd?: string;
  customerName?: string;
  materialDescription?: string;
  referenceNumber?: string;
};

export type TriggerType = 'new_order' | 'alert_fired' | 'manual';

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
  if (order.materialDescription) demo_order.material_description = order.materialDescription;
  if (order.soldTo) demo_order.sold_to = order.soldTo;
  if (order.materialNumber) demo_order.material_number = order.materialNumber;
  if (order.referenceNumber) demo_order.sales_order_number = order.referenceNumber.replace('#', '');

  return {
    trigger_type: triggerType,
    trigger_source: 'demo_payload' as const,
    demo_order,
  };
}

export async function startSession(
  order: OrderLike,
  triggerType: TriggerType = 'new_order',
): Promise<{ session_id: string; status: string; placeholder_used: boolean }> {
  return request<{ session_id: string; status: string; placeholder_used: boolean }>(
    '/sessions',
    { method: 'POST', body: buildStartSessionRequest(order, triggerType) },
  );
}

// ─── Legacy v2.3 names (kept so older imports don't break) ───────────────────

/** @deprecated Use {@link fetchOrders} which returns Order[]. */
export async function fetchV23Orders(limit = 20): Promise<V23OrdersResponse> {
  const n = Math.max(1, limit);
  return request<V23OrdersResponse>(`/v23/orders?limit=${n}`);
}

/** @deprecated Use {@link triageOrder}. */
export const runV23Triage = triageOrder;

/** @deprecated Use {@link fetchDashboard} (cached). */
export const fetchDashboardData = fetchDashboard;

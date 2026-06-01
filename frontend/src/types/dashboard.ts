// DashboardData — the shape returned by GET /api/dashboard-data.
// Kept as a wide Record so individual tabs can cast to their specific
// sub-shapes without maintaining a brittle deep interface here.
// Typed narrowly in lib/types.ts for routes that have a stable contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DashboardData = Record<string, any>;

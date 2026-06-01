/**
 * Shared React hooks for live data fetches.
 *
 * useDashboardData() is the canonical accessor for /dashboard-data —
 * every read-only tab (Watchtower, SafetyStockOptimizer, RootCauseHub,
 * DecisionLog, ManagerDashboard) calls it and renders its own
 * loading / error / data states. The 60-second cache inside
 * fetchDashboard() (lib/api.ts) deduplicates concurrent calls, so
 * mounting all five tabs across a session results in a single network
 * request.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchDashboard, fetchDataHealth,
  fetchSupplyAgent, fetchDemandAgent, fetchTransportAgent, fetchRetailAgent,
} from './api';
import type {
  DashboardData, DataHealthResponse,
  AgentsSupplyResponse, AgentsDemandResponse,
  AgentsTransportResponse, AgentsRetailResponse,
} from './types';

export type DashboardState = {
  data: DashboardData | null;
  loading: boolean;
  err: string | null;
  reload: () => void;
};

export function useDashboardData(): DashboardState {
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr]         = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetchDashboard()
      .then(d => { setData(d); setLoading(false); })
      .catch(e => {
        setErr(e?.message || 'Unable to load dashboard data');
        setLoading(false);
      });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, err, reload };
}

// ─── /data-health ────────────────────────────────────────────────────────────

export type DataHealthState = {
  health: DataHealthResponse | null;
  loading: boolean;
  err: string | null;
  reload: () => void;
  /** When the latest successful fetch completed. Useful for tabs that
   *  want to show a "checked Xs ago" label as a fallback when the
   *  backend omits its own reference timestamp. */
  lastFetched: Date | null;
};

export function useDataHealth(): DataHealthState {
  const [health, setHealth]   = useState<DataHealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr]         = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetchDataHealth()
      .then(h => {
        setHealth(h);
        setLastFetched(new Date());
        setLoading(false);
      })
      .catch(e => {
        setErr(e?.message || 'Unable to load data health');
        setLoading(false);
      });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { health, loading, err, reload, lastFetched };
}

// ─── /agents/{supply,demand,transport,retail} (Phase 7) ──────────────────────
// Each hook follows the same shape: `{ data, loading, err, reload }`. Generic
// helper below cuts copy-paste — the 4 wrappers below it are one-liners.

type AgentState<T> = {
  data: T | null;
  loading: boolean;
  err: string | null;
  reload: () => void;
};

function useAgentData<T>(fetcher: () => Promise<T>): AgentState<T> {
  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr]         = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetcher()
      .then(d => { setData(d); setLoading(false); })
      .catch(e => {
        setErr(e?.message || 'Unable to load agent data');
        setLoading(false);
      });
  }, [fetcher]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, err, reload };
}

export function useSupplyAgent():    AgentState<AgentsSupplyResponse>    { return useAgentData(fetchSupplyAgent); }
export function useDemandAgent():    AgentState<AgentsDemandResponse>    { return useAgentData(fetchDemandAgent); }
export function useTransportAgent(): AgentState<AgentsTransportResponse> { return useAgentData(fetchTransportAgent); }
export function useRetailAgent():    AgentState<AgentsRetailResponse>    { return useAgentData(fetchRetailAgent); }

/**
 * Agent-evaluation state for Order Triage (and reusable by any other
 * surface that wants to call /api/sessions/sync per row).
 *
 * Lives at App level so navigating between tabs doesn't unmount the
 * OrderTriage component and lose its `agentEvals` map. Persisted to
 * sessionStorage so a page reload also keeps results around for the
 * lifetime of the browser tab.
 */
import { useCallback, useEffect, useState } from 'react';

export type AgentEvalStatus = 'idle' | 'evaluating' | 'done' | 'error';

export type AgentRec = {
  action: string;
  fulfill_qty_cs: number;
  confidence: number;
  expected_outcome: string;
  key_trade_offs: string[];
  what_would_change: string;
};

export type UserDecision = 'accept' | 'modify' | 'reject';

export type AgentEvalState = {
  status: AgentEvalStatus;
  sessionId?: string;
  rec?: AgentRec;
  /** Set after the user confirms Accept / Modify / Reject. */
  userDecision?: UserDecision;
  /** BigQuery decision_id returned by dce_write (only for accept/modify). */
  decisionId?: string;
};

export type AgentEvalMap = Record<string, AgentEvalState>;

const STORAGE_KEY = 'tiger:agentEvals:v1';
// v3 key clears accumulated local optimistic entries from the v2 cache.
// Ground truth is always BigQuery; this ensures a fresh start on reload.
const DECISION_LOG_KEY = 'tiger:decisionLog:v3';

function loadFromSession(): AgentEvalMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Drop any 'evaluating' rows from a previous page lifetime — their
    // in-flight fetch is dead, the user should be able to retry them.
    const cleaned: AgentEvalMap = {};
    for (const [k, v] of Object.entries(parsed as AgentEvalMap)) {
      if (v && v.status !== 'evaluating') cleaned[k] = v;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function saveToSession(map: AgentEvalMap) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* sessionStorage may be unavailable in some browser modes — ignore */
  }
}

/**
 * Hook for the agent-evaluation cache. Identical API to useState but
 * the value is shared across all consumers in the React tree (passed
 * down via props from App) and persisted to sessionStorage on change.
 */
export function useAgentEvalsStore(): [
  AgentEvalMap,
  React.Dispatch<React.SetStateAction<AgentEvalMap>>,
] {
  const [evals, setEvals] = useState<AgentEvalMap>(() => loadFromSession());

  useEffect(() => {
    saveToSession(evals);
  }, [evals]);

  return [evals, setEvals];
}

/**
 * Setter convenience — partial update for a single PO id without
 * having to construct the spread at every call site.
 */
export function useUpdateAgentEval(
  setEvals: React.Dispatch<React.SetStateAction<AgentEvalMap>>,
) {
  return useCallback(
    (poId: string, patch: Partial<AgentEvalState> | AgentEvalState) => {
      setEvals(prev => ({
        ...prev,
        [poId]: { ...(prev[poId] ?? { status: 'idle' as AgentEvalStatus }), ...patch },
      }));
    },
    [setEvals],
  );
}


// ─── Decision Capture Log (Order Triage) ────────────────────────────────────
// Each entry is one human override/acceptance recorded against an agent
// recommendation. Survives tab switches and reloads.

export type DecisionEntry = {
  id: string;
  timestamp: string;
  poNumber: string;
  customer: string;
  agentRecommendation: string;
  userDecision: string;
  overrideReason: string | null;
  outcome: string;
};

/**
 * Fetch recent telemetry entries from GET /api/telemetry/execution.
 * Called from App on mount; result is passed to setDecisionLog so the
 * Recent Agent Override Telemetry table shows real BigQuery data.
 */
export async function fetchTelemetryLog(limit = 20): Promise<DecisionEntry[]> {
  try {
    const res = await fetch(`/api/telemetry/execution?limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.entries ?? []) as DecisionEntry[];
  } catch {
    return [];
  }
}

/**
 * Persisted decision log. Seeded from `seed` on first load if sessionStorage
 * is empty. Real data is loaded from BigQuery (GET /telemetry/execution) by
 * the App component on mount and replaces the seed via setDecisionLog.
 */
export function useDecisionLogStore(
  seed: DecisionEntry[] = [],
): [DecisionEntry[], React.Dispatch<React.SetStateAction<DecisionEntry[]>>] {
  const [log, setLog] = useState<DecisionEntry[]>(() => {
    try {
      const raw = sessionStorage.getItem(DECISION_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DecisionEntry[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* fall through */
    }
    return seed;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(DECISION_LOG_KEY, JSON.stringify(log));
    } catch {
      /* ignore */
    }
  }, [log]);

  return [log, setLog];
}

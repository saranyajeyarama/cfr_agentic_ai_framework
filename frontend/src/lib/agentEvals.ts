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

export type AgentEvalState = {
  status: AgentEvalStatus;
  sessionId?: string;
  rec?: AgentRec;
};

export type AgentEvalMap = Record<string, AgentEvalState>;

const STORAGE_KEY = 'tiger:agentEvals:v1';

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

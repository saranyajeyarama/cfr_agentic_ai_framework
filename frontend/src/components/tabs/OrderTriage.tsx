import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, CornerDownRight, X, Info, ShieldAlert, Bot, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { buildStartSessionRequest } from '../../lib/api';
import type { AgentEvalState, AgentEvalMap } from '../../lib/agentEvals';
import type { DashboardData } from '../../types/dashboard';

type Severity = 'critical' | 'warning' | 'neutral';

type PO = {
  id: string;
  orderNumber: string;
  customer: string;
  tier: string;
  skuCode: string;
  skuName: string;
  requestedQty: number;
  requestedQtyUnit: string;
  forecastQty: number;
  severity: Severity;
  issue: string;
  issueDetail: string;
  agents: string[];
  recommendedAction: string;
  proposedAllocation: string;
  proposedHold: string;
  financialImpact: string;
  confidenceScore: number;
  // Real tiger_semantic identifiers — supplied by /dashboard-data.
  // soldTo is the SAP sold-to customer number (NOT the display name).
  // materialNumber is the SAP material number.
  soldTo?: string;
  materialNumber?: string;
  mabd?: string;
};

type DecisionEntry = {
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
 * Adapt a PO row to the shared startSession contract. The real SAP
 * identifiers (soldTo / materialNumber) come from /dashboard-data; on
 * mock data they are empty and the backend falls back to a demo scenario.
 */
function poToOrder(po: PO) {
  return {
    soldTo: po.soldTo,
    materialNumber: po.materialNumber,
    requestedQty: po.requestedQty,
    mabd: po.mabd,
    customerName: po.customer,
    materialDescription: po.skuName,
    referenceNumber: po.orderNumber,
  };
}

export function OrderTriage({
  data,
  agentEvals,
  setAgentEvals,
}: {
  data: DashboardData;
  agentEvals: AgentEvalMap;
  setAgentEvals: React.Dispatch<React.SetStateAction<AgentEvalMap>>;
}) {
  const PURCHASE_ORDERS: PO[] = data.purchaseOrders as PO[];
  const [activePoId, setActivePoId] = useState<string>(PURCHASE_ORDERS[0]?.id || '');
  const [decision, setDecision] = useState<'accept' | 'modify' | 'reject' | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [showRationale, setShowRationale] = useState(false);
  const [decisionLog, setDecisionLog] = useState<DecisionEntry[]>(data.decisionCaptureLog);
  const [isSubmitting, setIsSubmitting] = useState(false);



  const startAgentEval = useCallback(async (po: PO) => {
    setAgentEvals(prev => ({ ...prev, [po.id]: { status: 'evaluating' } }));
    try {
      // Synchronous flow: backend runs the 4 specialists + synthesizer
      // inline and returns the completed session document in one response.
      // No polling, no orphaned sessions. Request blocks ~60-180s.
      // setAgentEvals is App-level state — it's safe to call even after
      // this tab unmounts, so the in-flight eval still lands.
      const res = await fetch('/api/sessions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildStartSessionRequest(poToOrder(po))),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sess = await res.json();
      const card = sess.final_action_card;
      if (!card) {
        setAgentEvals(prev => ({ ...prev, [po.id]: { status: 'error', sessionId: sess.session_id } }));
        return;
      }
      const r = card.recommendation ?? {};
      const chain = card.reasoning_chain ?? {};
      console.log('[DEBUG][frontend #5] full recommendation from API:', r);
      console.log('[DEBUG][frontend #6] fulfill_qty_cs from API:', r.fulfill_qty_cs);
      setAgentEvals(prev => ({
        ...prev,
        [po.id]: {
          status: 'done',
          sessionId: sess.session_id,
          rec: {
            action: r.action ?? 'ACCEPT',
            fulfill_qty_cs: r.fulfill_qty_cs ?? 0,
            confidence: r.confidence ?? 0,
            expected_outcome: r.expected_outcome ?? '',
            key_trade_offs: chain.key_trade_offs ?? [],
            what_would_change: chain.what_would_change_the_decision ?? '',
          },
        },
      }));
    } catch {
      setAgentEvals(prev => ({ ...prev, [po.id]: { status: 'error' } }));
    }
  }, [setAgentEvals]);

  // Auto-evaluate only the currently selected PO. Firing one session per
  // row on mount blasted the backend with ~20 simultaneous POST /sessions
  // and OOM'd the container under sequential agent execution. Other POs
  // can be evaluated on demand when the user opens them.
  useEffect(() => {
    if (!activePoId) return;
    if (agentEvals[activePoId]) return;  // already started/done for this row
    const po = PURCHASE_ORDERS.find(p => p.id === activePoId);
    if (po) startAgentEval(po);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePoId]);

  const activePo = PURCHASE_ORDERS.find(po => po.id === activePoId) || PURCHASE_ORDERS[0];
  const activeEval = agentEvals[activePoId];
  const evalList: AgentEvalState[] = Object.values(agentEvals);
  const evaluatingCount = evalList.filter(e => e.status === 'evaluating').length;
  const doneCount = evalList.filter(e => e.status === 'done').length;

  // Merge agent recommendation over static BQ data when available
  const displayRec = activeEval?.rec;
  const recommendedAction = displayRec?.expected_outcome || activePo.recommendedAction;
  const proposedAllocation = displayRec
    ? `${displayRec.fulfill_qty_cs.toLocaleString()} cs`
    : activePo.proposedAllocation;
  console.log('[DEBUG][frontend #7] proposedAllocation display value:', proposedAllocation, '| displayRec:', displayRec ? { fulfill_qty_cs: displayRec.fulfill_qty_cs, action: displayRec.action } : 'none (using static)');
  const proposedHold = displayRec
    ? `${Math.max(0, activePo.requestedQty - displayRec.fulfill_qty_cs).toLocaleString()} cs`
    : activePo.proposedHold;
  const confidencePct = displayRec
    ? Math.round(displayRec.confidence * 100)
    : activePo.confidenceScore;
  const rationale = displayRec
    ? (displayRec.key_trade_offs.length
        ? displayRec.key_trade_offs.join(' · ')
        : displayRec.what_would_change)
    : (activePo as any).rationale || activePo.issueDetail;

  const handlePoClick = (id: string) => {
    setActivePoId(id);
    setDecision(null);
    setOverrideReason('');
    setShowRationale(false);
  };

  const handleExecuteDecision = async () => {
    setIsSubmitting(true);
    const evalSessionId = activeEval?.sessionId ?? null;

    // If agent already created a session, log against it; otherwise log locally
    let outcomeNote = evalSessionId
      ? `session ${evalSessionId} evaluated`
      : 'logged locally';

    if (!evalSessionId) {
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildStartSessionRequest(poToOrder(activePo))),
        });
        if (res.ok) {
          const d = await res.json();
          outcomeNote = `session ${d.session_id} started`;
        }
      } catch { /* backend unreachable */ }
    }

    const newDecision: DecisionEntry = {
      id: `dc-${Date.now()}`,
      timestamp: new Date().toISOString(),
      poNumber: activePo.orderNumber,
      customer: activePo.customer,
      agentRecommendation: recommendedAction,
      userDecision: decision || 'reject',
      overrideReason: (decision === 'modify' || decision === 'reject') ? overrideReason : null,
      outcome: outcomeNote,
    };

    setDecisionLog([newDecision, ...decisionLog].slice(0, 5));
    setDecision(null);
    setOverrideReason('');
    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Order Triage &amp; Allocation</h2>
          <p className="text-xs text-slate-500">Exception management and allocation guardrails</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {evaluatingCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-600 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {evaluatingCount} agent evaluation{evaluatingCount > 1 ? 's' : ''} running
            </span>
          )}
          {doneCount > 0 && (
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {doneCount} evaluated
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Triage Queue */}
        <div className="w-80 border-r border-slate-200 bg-white/50 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-slate-200 bg-slate-100/50">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Triage Queue</h3>
          </div>
          <div className="flex flex-col p-2 gap-2">
            {PURCHASE_ORDERS.map((item) => (
              <QueueItem
                key={item.id}
                po={item}
                active={activePoId === item.id}
                evalStatus={agentEvals[item.id]?.status ?? 'idle'}
                onClick={() => handlePoClick(item.id)}
              />
            ))}
          </div>
        </div>

        {/* Right Panel: Active Details */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {/* Main Order Details */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-1">Order {activePo.orderNumber}</h3>
                <div className="flex items-center gap-2 text-sm mt-2">
                  <span className="text-slate-700 font-bold">{activePo.customer}</span>
                  <span className="text-slate-500 px-2 rounded-full border border-slate-200 text-xs bg-slate-100">{activePo.tier} Customer</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-500 mb-1">Requested Quantity</div>
                <div className="text-2xl font-mono font-bold text-slate-800">{activePo.requestedQty.toLocaleString()} <span className="text-sm text-slate-400 font-sans">{activePo.requestedQtyUnit}</span></div>
              </div>
            </div>

            <div className={cn(
              "flex items-start gap-3 p-4 rounded-lg border text-sm shadow-sm",
              activePo.severity === 'critical' ? "bg-[#DB033B]/10 border-[#DB033B]/20 text-[#DB033B]" :
              activePo.severity === 'warning' ? "bg-amber-50 border-amber-100 text-amber-900" :
              "bg-slate-50 border-slate-200 text-slate-700"
            )}>
              {activePo.severity === 'critical' && <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#DB033B]" />}
              {activePo.severity === 'warning' && <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />}
              {activePo.severity === 'neutral' && <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-slate-500" />}
              <span className="leading-relaxed">{activePo.issueDetail}</span>
            </div>
          </div>

          {/* Component 2: Co-Pilot Recommendation Card */}
          <div className="bg-[#fef2f2] border border-[#DB033B] rounded-xl p-6 relative shadow-sm">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-[#DB033B] rounded-l-xl"></div>

            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-bold tracking-wide text-[#DB033B] uppercase">Co-Pilot Recommendation</h4>
                {activeEval?.status === 'evaluating' && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-600 font-bold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> EVALUATING
                  </span>
                )}
                {activeEval?.status === 'done' && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-2.5 h-2.5" /> LIVE AGENT
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeEval?.status !== 'evaluating' && (
                  <div className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-1 rounded shadow-sm">
                    CONFIDENCE: <span className={cn(
                      confidencePct >= 80 ? 'text-emerald-600' :
                      confidencePct >= 60 ? 'text-amber-600' : 'text-[#DB033B]'
                    )}>{confidencePct}%</span>
                  </div>
                )}
                <div className="flex gap-2">
                  {activePo.agents.map((agent, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-white border border-[#DB033B] text-[#DB033B] px-2 py-1 rounded text-[10px] font-bold tracking-wide shadow-sm">
                      <Bot className="w-3 h-3" /> {agent} Input
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="w-8 h-8 rounded-full bg-[#DB033B] text-white flex items-center justify-center flex-shrink-0 shadow-sm mt-1">
                {activeEval?.status === 'evaluating'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <CheckCircle2 className="w-5 h-5" />
                }
              </div>
              <div className="flex-1">
                {activeEval?.status === 'evaluating' ? (
                  <div className="space-y-2 mb-5">
                    <div className="h-4 bg-[#DB033B]/10 rounded animate-pulse w-3/4" />
                    <div className="h-4 bg-[#DB033B]/10 rounded animate-pulse w-1/2" />
                  </div>
                ) : (
                  <p className="font-medium leading-relaxed text-sm mb-5 text-[#DB033B]">
                    {recommendedAction}
                  </p>
                )}

                {/* Explainability toggle */}
                <div className="mb-5">
                  <button
                    onClick={() => setShowRationale(!showRationale)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors font-medium border-none bg-transparent p-0 cursor-pointer"
                  >
                    <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", showRationale && "rotate-90")} />
                    Why did the agent recommend this?
                  </button>
                  {showRationale && (
                    <p className="mt-3 text-xs leading-relaxed text-slate-600 bg-white/60 p-3 rounded-lg border border-slate-200/60 shadow-sm">
                      {rationale}
                    </p>
                  )}
                </div>

                <div className="flex gap-4">
                  <div className="bg-white rounded-lg p-3 border border-[#DB033B] flex-1 shadow-sm">
                    <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider font-bold">Proposed Allocation</div>
                    {activeEval?.status === 'evaluating'
                      ? <div className="h-6 bg-slate-100 rounded animate-pulse mt-1" />
                      : <div className="font-mono text-slate-800 font-bold text-lg">{proposedAllocation}</div>
                    }
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-[#DB033B] flex-1 shadow-sm">
                    <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider font-bold">Hold / Short</div>
                    {activeEval?.status === 'evaluating'
                      ? <div className="h-6 bg-slate-100 rounded animate-pulse mt-1" />
                      : <div className="font-mono text-slate-600 font-bold text-lg">{proposedHold}</div>
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Component 3: The Decision Capture Engine */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Decision Capture Engine</h4>

            <div className="flex gap-3 mb-6">
              <button
                onClick={() => { setDecision('accept'); setOverrideReason(''); }}
                className={cn(
                  "flex-1 py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all border shadow-sm",
                  decision === 'accept' ? "bg-emerald-50 text-emerald-700 border-emerald-300 ring-2 ring-emerald-500/20" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}>
                <Check className="w-4 h-4" /> Accept Agent Proposal
              </button>
              <button
                onClick={() => { setDecision('modify'); setOverrideReason(''); }}
                className={cn(
                  "flex-1 py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all border shadow-sm",
                  decision === 'modify' ? "bg-amber-50 text-amber-700 border-amber-300 ring-2 ring-amber-500/20" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}>
                <CornerDownRight className="w-4 h-4" /> Modify / Override
              </button>
              <button
                onClick={() => { setDecision('reject'); setOverrideReason(''); }}
                className={cn(
                  "flex-1 py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all border shadow-sm",
                  decision === 'reject' ? "bg-[#DB033B]/10 text-[#DB033B] border-[#DB033B]/30 ring-2 ring-[#DB033B]/20" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}>
                <X className="w-4 h-4" /> Reject Entire Order
              </button>
            </div>

            {(decision === 'modify' || decision === 'reject') && (
              <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl animate-in slide-in-from-top-2 opacity-100 duration-300 shadow-inner">
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Override reason code required for Phase 2 Agent Training:
                </label>
                <select
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-3 text-sm text-slate-800 font-medium focus:outline-none focus:border-[#DB033B] focus:ring-2 focus:ring-[#DB033B]/20 shadow-sm"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                >
                  <option value="" disabled>Select Reason Category...</option>
                  <option value="vp_override">Sales VP Override (Recorded via Email)</option>
                  <option value="data_lag">Data Lag / False Positive Alert</option>
                  <option value="strategic">Strategic Account Growth Initiative (Loss Leader)</option>
                  <option value="logistics_override">Local Logistics Override / Carrier Found</option>
                  <option value="other">Other (Log Comment)</option>
                </select>

                <div className="mt-5 flex justify-end">
                  <button
                    disabled={!overrideReason || isSubmitting}
                    onClick={handleExecuteDecision}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-6 py-2.5 rounded-lg text-sm transition-colors shadow-md">
                    {isSubmitting ? 'Submitting…' : 'Execute Override & Log Telemetry'}
                  </button>
                </div>
              </div>
            )}
            {decision === 'accept' && (
              <div className="flex justify-end animate-in fade-in duration-300">
                <button
                  disabled={isSubmitting}
                  onClick={handleExecuteDecision}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-8 py-2.5 rounded-lg text-sm transition-colors shadow-md focus:ring-4 focus:ring-emerald-500/20">
                  {isSubmitting ? 'Submitting…' : 'Confirm Allocation'}
                </button>
              </div>
            )}
          </div>

          {/* Component 4: Decisions Log */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Recent Agent Override Telemetry</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                    <th className="py-3 px-4 font-bold rounded-tl-lg">Timestamp</th>
                    <th className="py-3 px-4 font-bold">PO Number</th>
                    <th className="py-3 px-4 font-bold">Customer</th>
                    <th className="py-3 px-4 font-bold">Decision</th>
                    <th className="py-3 px-4 font-bold">Override Reason</th>
                    <th className="py-3 px-4 font-bold rounded-tr-lg">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {decisionLog.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500">{new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="py-3 px-4 font-medium text-slate-800">{log.poNumber}</td>
                      <td className="py-3 px-4 text-slate-600">{log.customer}</td>
                      <td className="py-3 px-4 text-slate-800 font-bold capitalize">
                        <span className={cn(
                          "px-2 py-1 rounded text-xs",
                          log.userDecision === 'accept' ? "bg-emerald-100 text-emerald-800" :
                          log.userDecision === 'modify' ? "bg-amber-100 text-amber-800" :
                          "bg-[#DB033B]/10 text-[#DB033B]"
                        )}>
                          {log.userDecision}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500 italic max-wxs truncate" title={log.overrideReason || ''}>{log.overrideReason || '—'}</td>
                      <td className="py-3 px-4 text-slate-600 text-xs">{log.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueItem({ po, active, evalStatus, onClick }: {
  po: PO;
  active: boolean;
  evalStatus: AgentEvalStatus;
  onClick: () => void;
  key?: string | number;
}) {
  const isCritical = po.severity === 'critical';
  const isWarning = po.severity === 'warning';

  return (
    <button
      onClick={onClick}
      className={cn(
        "p-4 rounded-xl border text-left transition-all duration-200 outline-none focus:ring-0",
        active
          ? "bg-white border-[#DB033B] shadow-md ring-1 ring-[#DB033B]/20"
          : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm opacity-90 hover:opacity-100",
        isCritical && !active && "border-l-4 border-l-[#DB033B]",
        isWarning && !active && "border-l-4 border-l-amber-500",
        isCritical && active && "border-l-4 border-l-[#DB033B]"
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{po.customer}</span>
        <div className="flex items-center gap-1.5">
          {evalStatus === 'evaluating' && (
            <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
          )}
          {evalStatus === 'done' && (
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          )}
          {evalStatus === 'error' && (
            <AlertTriangle className="w-3 h-3 text-slate-400" />
          )}
          {isCritical && <div className="w-2 h-2 rounded-full bg-[#DB033B] animate-pulse" />}
          {isWarning && !isCritical && <div className="w-2 h-2 rounded-full bg-amber-500" />}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-bold text-slate-800 leading-tight">{po.orderNumber}</h4>
        <span className={cn(
          "text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded font-bold",
          isCritical ? "bg-[#DB033B]/10 text-[#DB033B]" :
          isWarning ? "bg-amber-50 text-amber-700" :
          "bg-slate-100 text-slate-600"
        )}>
          {po.issue}
        </span>
      </div>
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-500 font-medium">Vol: <span className="text-slate-800 font-bold">{po.requestedQty.toLocaleString()}</span></span>
        <ChevronRight className={cn("w-4 h-4 transition-colors", active ? "text-[#DB033B]" : "text-slate-300")} />
      </div>
    </button>
  );
}

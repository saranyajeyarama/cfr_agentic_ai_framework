import { BarChart2, Mail, MessageSquare, Send, ArrowLeft, Loader2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts';
import { useState, useCallback } from 'react';

import type { DashboardData } from '../../types/dashboard';
import { useDashboardData } from '../../lib/hooks';
import { DashboardSkeleton, ErrorState } from '../primitives';

type ViewLevel = 'L1' | 'L2_DEMAND' | 'L2_SUPPLY';

function buildDrivers(drivers: DashboardData['rootCauseSummary']['drivers']) {
  return drivers.reduce((acc, d) => {
    const isDemand = d.category === 'Demand';
    acc[d.id] = {
      id: d.id,
      name: d.name,
      value: -d.casesMissed,
      color: '#ef4444',
      iconColor: isDemand ? 'text-amber-500' : 'text-[#DB033B]',
      bgColor: isDemand ? 'bg-amber-50' : 'bg-[#DB033B]/10',
      borderColor: isDemand ? 'border-amber-100' : 'border-[#DB033B]/20',
      textColor: isDemand ? 'text-amber-900' : 'text-[#DB033B]',
      subTextColor: isDemand ? 'text-amber-800/80' : 'text-[#DB033B]',
      ownerCode: d.ownerCode,
      ownerName: d.ownerName,
      ownerDept: d.ownerDept,
      desc: d.description,
      draft: d.emailDraft,
      category: d.category,
      casesMissed: d.casesMissed,
    };
    return acc;
  }, {} as Record<string, any>);
}

type ChartDataPoint = {
  name: string;
  transparentVal: number;
  visibleVal: number;
  displayVal?: string;
  fill: string;
  type: string;
  id?: string;
  disabled?: boolean;
  isTotal?: boolean;
};

const BASELINE = 10000;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const visiblePayload = payload.find((p: any) => p.dataKey === 'visibleVal');
    if (!visiblePayload) return null;
    
    const data = visiblePayload.payload;
    return (
      <div className="bg-white border border-slate-200 p-3 rounded-lg shadow-md text-sm">
        <p className="font-bold text-slate-800 mb-1">{label}</p>
        <p className="text-slate-600">
          <span className="font-medium text-xs">{data.isTotal ? 'Total:' : 'Cuts Impact:'}</span>{' '}
          <span className={`font-mono font-bold ${data.isTotal ? 'text-slate-700' : 'text-[#DB033B]'}`}>{data.displayVal || `${data.visibleVal.toLocaleString()} CS`}</span>
        </p>
      </div>
    );
  }
  return null;
};

export function RootCauseHub() {
  const { data, loading, err, reload } = useDashboardData();
  const [viewLevel, setViewLevel] = useState<ViewLevel>('L1');
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [draftText, setDraftText] = useState<string>('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showTeamsToast, setShowTeamsToast] = useState(false);

  const generateEmail = useCallback(async (driver: any) => {
    if (!driver) return;
    setIsGeneratingEmail(true);
    setDraftText('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', text: `Draft an escalation email to ${driver.ownerName} about the "${driver.name}" root cause.` }],
          systemPrompt: `You are a supply chain analyst at Mars Pet Nutrition drafting an internal escalation email.

Root Cause Issue: ${driver.name}
Category: ${driver.category}
Cases Missed (last 28 days): ${driver.casesMissed}
Description: ${driver.desc}
Recipient: ${driver.ownerName}, ${driver.ownerDept}

Write a concise professional email body (no subject line) that:
1. States the specific CFR issue and its case impact
2. Explains the root cause briefly
3. Requests specific corrective action with a deadline
4. Sets a follow-up expectation

Keep it under 200 words. Sign off as "Customer Supply Operations Team, Mars Pet Nutrition".`,
          agentId: 'root-cause-hub'
        })
      });
      const d = await res.json();
      setDraftText(d.text || driver.draft || '');
    } catch {
      setDraftText(driver.draft || '');
    } finally {
      setIsGeneratingEmail(false);
    }
  }, []);

  if (loading) return <DashboardSkeleton title="Loading Root Cause Hub…" />;
  if (err || !data) return (
    <ErrorState
      title="Could not load Root Cause Hub"
      message={err || 'Dashboard data unavailable.'}
      onRetry={reload}
    />
  );

  const { rootCauseSummary } = data;
  const DRIVERS = buildDrivers(rootCauseSummary.drivers);

  const L1_DATA: ChartDataPoint[] = [
    { name: 'Target Cases', transparentVal: 0, visibleVal: BASELINE, displayVal: BASELINE.toLocaleString(), fill: '#475569', type: 'target', isTotal: true },
    { name: 'Demand Gaps', transparentVal: BASELINE - rootCauseSummary.demandDrivenCases, visibleVal: rootCauseSummary.demandDrivenCases, displayVal: `-${rootCauseSummary.demandDrivenCases.toLocaleString()}`, fill: '#3b82f6', type: 'gap-demand' },
    { name: 'Supply Gaps', transparentVal: BASELINE - rootCauseSummary.demandDrivenCases - rootCauseSummary.supplyDrivenCases, visibleVal: rootCauseSummary.supplyDrivenCases, displayVal: `-${rootCauseSummary.supplyDrivenCases.toLocaleString()}`, fill: '#eab308', type: 'gap-supply' },
    { name: 'Actual Cases', transparentVal: 0, visibleVal: BASELINE - rootCauseSummary.totalCasesMissed, displayVal: (BASELINE - rootCauseSummary.totalCasesMissed).toLocaleString(), fill: '#475569', type: 'actual', isTotal: true },
  ];

  const L2_DEMAND_DATA: ChartDataPoint[] = [
    { name: 'Target Cases', transparentVal: 0, visibleVal: BASELINE, displayVal: BASELINE.toLocaleString(), fill: '#475569', type: 'target', disabled: true, isTotal: true },
    ...rootCauseSummary.drivers.filter((d: any) => d.category === 'Demand').map((d: any, index: number, arr: any[]) => {
      const prevMissed = arr.slice(0, index).reduce((sum: number, item: any) => sum + item.casesMissed, 0);
      return {
        name: d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name,
        transparentVal: BASELINE - prevMissed - d.casesMissed,
        visibleVal: d.casesMissed,
        displayVal: `-${d.casesMissed.toLocaleString()}`,
        fill: index % 2 === 0 ? '#1d4ed8' : '#3b82f6',
        type: 'driver',
        id: d.id,
      };
    }),
  ];

  const L2_SUPPLY_DATA: ChartDataPoint[] = [
    { name: 'Target Cases', transparentVal: 0, visibleVal: BASELINE, displayVal: BASELINE.toLocaleString(), fill: '#475569', type: 'target', disabled: true, isTotal: true },
    ...rootCauseSummary.drivers.filter((d: any) => d.category === 'Supply').map((d: any, index: number, arr: any[]) => {
      const prevMissed = arr.slice(0, index).reduce((sum: number, item: any) => sum + item.casesMissed, 0);
      return {
        name: d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name,
        transparentVal: BASELINE - prevMissed - d.casesMissed,
        visibleVal: d.casesMissed,
        displayVal: `-${d.casesMissed.toLocaleString()}`,
        fill: index % 2 === 0 ? '#b45309' : '#d97706',
        type: 'driver',
        id: d.id,
      };
    }),
  ];

  const firstDriverId = rootCauseSummary.drivers[0]?.id || '';
  const effectiveDriverId = selectedDriverId || firstDriverId;
  const selectedDriver = DRIVERS[effectiveDriverId];

  const chartData = viewLevel === 'L1' ? L1_DATA : viewLevel === 'L2_DEMAND' ? L2_DEMAND_DATA : L2_SUPPLY_DATA;

  const handleBarClick = (data: any) => {
    if (viewLevel === 'L1') {
      if (data.type === 'gap-demand') {
        setViewLevel('L2_DEMAND');
        const firstDemand = rootCauseSummary.drivers.find((d: any) => d.category === 'Demand');
        if (firstDemand) {
          setSelectedDriverId(firstDemand.id);
          generateEmail(DRIVERS[firstDemand.id]);
        }
      } else if (data.type === 'gap-supply') {
        setViewLevel('L2_SUPPLY');
        const firstSupply = rootCauseSummary.drivers.find((d: any) => d.category === 'Supply');
        if (firstSupply) {
          setSelectedDriverId(firstSupply.id);
          generateEmail(DRIVERS[firstSupply.id]);
        }
      }
    } else {
      if (data.type === 'driver' && data.id) {
        setSelectedDriverId(data.id);
        generateEmail(DRIVERS[data.id]);
      }
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Root Cause & Escalation Hub</h2>
          <p className="text-xs text-slate-500">Identify systemic cuts and close the accountability loop</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        
        {/* Component 1: CFR Cuts Waterfall */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
           <div className="flex justify-between items-start mb-6">
             <div>
               <div className="flex items-center gap-3 mb-1">
                 {viewLevel !== 'L1' && (
                   <button 
                     onClick={() => setViewLevel('L1')}
                     className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-1.5 rounded-md transition-colors"
                   >
                     <ArrowLeft className="w-4 h-4" />
                   </button>
                 )}
                 <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                   {viewLevel === 'L1' ? 'L1: CFR Cuts Waterfall (Last 7 Days)' : 
                    viewLevel === 'L2_DEMAND' ? 'L2: Demand Gaps Breakdown' : 'L2: Supply & Execution Gaps Breakdown'}
                 </h3>
               </div>
               <p className="text-sm font-bold text-slate-800 mt-2">Total CFR Cuts: {rootCauseSummary.totalCasesMissed.toLocaleString()} Cases (CFR {rootCauseSummary.cfRActual}% vs Target {rootCauseSummary.cfrTarget}%)</p>
             </div>
             {viewLevel === 'L1' && (
               <div className="flex gap-4">
                  <button onClick={() => handleBarClick({ type: 'gap-demand' })} className="text-right text-left cursor-pointer hover:bg-slate-50 p-2 -my-2 rounded-lg transition-colors border border-transparent hover:border-slate-200 group">
                    <div className="text-[10px] text-amber-700 uppercase font-bold tracking-widest bg-amber-100 px-2 py-0.5 rounded group-hover:bg-amber-200 transition-colors">Demand Gaps</div>
                    <div className="text-amber-700 font-mono font-bold mt-1 shadow-sm">-{rootCauseSummary.demandDrivenCases.toLocaleString()} CS</div>
                  </button>
                  <button onClick={() => handleBarClick({ type: 'gap-supply' })} className="text-right text-left cursor-pointer hover:bg-slate-50 p-2 -my-2 rounded-lg transition-colors border border-transparent hover:border-slate-200 group">
                    <div className="text-[10px] text-[#DB033B] uppercase font-bold tracking-widest bg-[#DB033B]/10 px-2 py-0.5 rounded group-hover:bg-[#DB033B]/20 transition-colors">Supply Gaps</div>
                    <div className="text-[#DB033B] font-mono font-bold mt-1 shadow-sm">-{rootCauseSummary.supplyDrivenCases.toLocaleString()} CS</div>
                  </button>
               </div>
             )}
             {viewLevel === 'L2_DEMAND' && (
               <div className="text-right">
                 <div className="text-[10px] text-amber-700 uppercase font-bold tracking-widest bg-amber-100 px-2 py-0.5 rounded">Demand Total</div>
                 <div className="text-amber-700 font-mono font-bold mt-1 shadow-sm">-{rootCauseSummary.demandDrivenCases.toLocaleString()} CS</div>
               </div>
             )}
             {viewLevel === 'L2_SUPPLY' && (
               <div className="text-right">
                 <div className="text-[10px] text-[#DB033B] uppercase font-bold tracking-widest bg-[#DB033B]/10 px-2 py-0.5 rounded">Supply Total</div>
                 <div className="text-[#DB033B] font-mono font-bold mt-1 shadow-sm">-{rootCauseSummary.supplyDrivenCases.toLocaleString()} CS</div>
               </div>
             )}
           </div>
           
           <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 30, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} />
                  <YAxis domain={[0, 10000]} tickFormatter={(val) => val.toLocaleString()} stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
                  <Tooltip cursor={{fill: '#f8fafc'}} content={<CustomTooltip />} />
                  <Bar dataKey="transparentVal" stackId="a" fill="transparent" />
                  <Bar dataKey="visibleVal" stackId="a" radius={[4, 4, 0, 0]} onClick={handleBarClick}>
                    {chartData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.id === selectedDriverId && viewLevel !== 'L1' ? '#1e293b' : entry.fill} 
                        className={entry.type !== 'target' && entry.type !== 'actual' && !entry.disabled ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
                      />
                    ))}
                    <LabelList 
                      dataKey="displayVal" 
                      position="top" 
                      fill="#dc2626" 
                      fontSize={11} 
                      fontWeight="bold" 
                      style={{ cursor: 'pointer' }}
                      onClick={(data: any) => {
                        if (data && data.payload) {
                          handleBarClick(data.payload);
                        } else if (data) {
                          handleBarClick(data);
                        }
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* Investigate Specific Issue */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm shadow-sm">
             <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Highest Impact Driver {viewLevel !== 'L1' && '(Selected)'}</h3>
             {!selectedDriver ? (
               <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No driver data available. Click a bar above.</div>
             ) : (
               <>
                 <div className={`flex items-start gap-4 p-4 ${selectedDriver.bgColor} ${selectedDriver.borderColor} border rounded-lg mb-4 ${selectedDriver.textColor} shadow-sm transition-all`}>
                   <BarChart2 className={`w-5 h-5 flex-shrink-0 mt-0.5 ${selectedDriver.iconColor}`} />
                   <div>
                     <strong className={`${selectedDriver.textColor} font-bold`}>{selectedDriver.name}</strong>
                     <p className={`mt-1 ${selectedDriver.subTextColor} leading-relaxed`}>{selectedDriver.desc}</p>
                     <p className={`mt-2 ${selectedDriver.iconColor} font-mono text-lg font-bold`}>{selectedDriver.value.toLocaleString()} CS Loss</p>
                   </div>
                 </div>
                 <div className="space-y-2 mt-6">
                   <div className="text-xs text-slate-500 uppercase tracking-widest font-bold">Owner</div>
                   <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-700 border border-slate-300">
                       {selectedDriver.ownerCode}
                     </div>
                     <span className="text-slate-800 font-bold tracking-tight">{selectedDriver.ownerName}</span>
                     <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded tracking-wider">{selectedDriver.ownerDept}</span>
                   </div>
                 </div>
               </>
             )}
          </div>

          {/* Component 2 & 3: Auto-Drafter Window & Escalation */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col shadow-sm">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex justify-between items-center">
              <span>Contextual Auto-Draft</span>
              {isGeneratingEmail
                ? <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-bold tracking-widest flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> GENERATING…</span>
                : draftText
                  ? <span className="text-[10px] bg-[#DB033B]/10 text-[#DB033B] px-2 py-0.5 rounded font-bold tracking-widest">READY FOR REVIEW</span>
                  : <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold tracking-widest">SELECT A DRIVER</span>
              }
            </h3>

            <div className="relative flex-1 mb-4">
              <textarea
                className="w-full h-full min-h-[160px] bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700 resize-none outline-none focus:border-[#DB033B] focus:ring-1 focus:ring-[#DB033B] transition-all shadow-inner leading-relaxed disabled:opacity-60"
                value={draftText}
                disabled={isGeneratingEmail}
                placeholder={isGeneratingEmail ? '' : 'Click a Demand Gap or Supply Gap bar above to generate an email draft…'}
                onChange={(e) => setDraftText(e.target.value)}
              />
              {isGeneratingEmail && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 rounded-lg">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin text-[#DB033B]" />
                    <span className="text-xs font-medium">Gemini drafting email…</span>
                  </div>
                </div>
              )}
            </div>

            {/* Component 3: One-Click Escalation */}
            <div className="flex gap-3 mt-auto relative">
              <a
                href={selectedDriver && draftText ? `mailto:${selectedDriver.ownerName.toLowerCase().replace(/\s+/g, '.')}@company.com?subject=${encodeURIComponent("CFR Root Cause Follow-Up - " + selectedDriver.name)}&body=${encodeURIComponent(draftText)}` : '#'}
                className={`flex-1 font-bold py-3 px-4 rounded-lg text-sm flex items-center justify-center gap-2 transition-opacity shadow-sm focus:ring-4 focus:ring-[#DB033B]/20 ${!selectedDriver || !draftText || isGeneratingEmail ? 'bg-slate-200 text-slate-400 pointer-events-none' : 'bg-[#DB033B] hover:opacity-90 text-white'}`}
              >
                <Mail className="w-4 h-4" /> Send via Email
              </a>
              <button 
                onClick={() => {
                  setShowTeamsToast(true);
                  setTimeout(() => setShowTeamsToast(false), 3000);
                }}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors shadow-sm focus:ring-4 focus:ring-purple-500/20"
              >
                <MessageSquare className="w-4 h-4" /> Send via Teams
              </button>

              {/* Toast for Teams */}
              {showTeamsToast && (
                <div className="absolute -top-12 right-0 left-0 bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg shadow-lg text-center animate-in fade-in slide-in-from-bottom-2">
                  Teams integration live in production deployment.
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Mail className="w-5 h-5 text-[#DB033B]" /> Review and Send Email
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold p-1 leading-none">&times;</button>
            </div>
            <div className="p-6">
              <p className="text-sm font-bold text-slate-700 mb-3">
                Recipient: <span className="font-normal">{selectedDriver.ownerName} ({selectedDriver.ownerDept})</span>
              </p>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed shadow-inner">
                {draftText}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors border border-slate-300 shadow-sm"
              >
                Cancel
              </button>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="px-4 py-2 text-sm font-bold text-white bg-[#DB033B] hover:opacity-90 rounded-lg transition-opacity flex items-center gap-2 shadow-sm"
              >
                <Send className="w-4 h-4" /> Finalize & Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


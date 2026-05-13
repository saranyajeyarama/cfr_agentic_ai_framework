import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Package, ShieldCheck, AlertCircle, TrendingUp, TrendingDown, CheckCircle2, ChevronRight, Activity } from 'lucide-react';
import { cn } from '../../lib/utils';
import mockData from '../../data/mockData.json';

type Severity = 'critical' | 'warning' | 'neutral';

type ChartDataPoint = {
  week: string;
  actualDemand: number;
  staticStock: number;
  dynamicMin: number;
  dynamicMax: number;
};

type SkuOptimization = {
  id: string;
  skuName: string;
  skuCode: string;
  severity: Severity;
  shortDesc: string;
  detail: string;
  agents: string[];
  currentStaticStock: number;
  recommendedDynamicStock: number;
  financialImpact: string;
  rationale: string;
  weeklyChartData: ChartDataPoint[];
};

const SKU_DATA: SkuOptimization[] = mockData.safetyStockRecommendations as SkuOptimization[];

export function SafetyStockOptimizer() {
  const [selectedSkuId, setSelectedSkuId] = useState<string>(SKU_DATA[0].id);
  const [showReasonCode, setShowReasonCode] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [showRationale, setShowRationale] = useState(false);

  const activeSku = SKU_DATA.find(s => s.id === selectedSkuId) || SKU_DATA[0];

  const getSeverityIcon = (severity: Severity) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="w-5 h-5 text-[#DB033B]" />;
      case 'warning': return <AlertCircle className="w-5 h-5 text-amber-500" />;
      case 'neutral': return <Activity className="w-5 h-5 text-slate-400" />;
    }
  };

  const getSeverityColor = (severity: Severity) => {
    switch (severity) {
      case 'critical': return 'border-[#DB033B] bg-[#DB033B]/10 hover:opacity-90';
      case 'warning': return 'border-amber-500 bg-amber-50 hover:bg-amber-50/80';
      case 'neutral': return 'border-slate-300 bg-white hover:bg-slate-50';
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-slate-200 p-3 rounded-lg shadow-md text-sm">
          <p className="font-bold text-slate-800 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => {
             // For the area chart range:
             if (entry.dataKey === 'dynamicMax') {
                const minPayload = payload.find((p: any) => p.dataKey === 'dynamicMin');
                return (
                  <p key={index} className="text-slate-600 flex justify-between gap-4 mb-1">
                    <span className="font-medium text-xs flex items-center gap-1">
                       <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                       Dynamic AI Band:
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      {minPayload ? `${Math.round(minPayload.value)} - ` : ''}{Math.round(entry.value)}
                    </span>
                  </p>
                )
             }
             if (entry.dataKey === 'dynamicMin') return null; // handled above
             
             return (
               <p key={index} className="text-slate-600 flex justify-between gap-4 mb-1">
                 <span className="font-medium text-xs flex items-center gap-1">
                    <span className="w-2 h-2 rounded-[2px]" style={{ backgroundColor: entry.stroke }}></span>
                    {entry.name}:
                 </span>
                 <span className="font-mono font-bold text-slate-800">{Math.round(entry.value)}</span>
               </p>
             );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="h-16 px-8 flex items-center justify-between border-b border-slate-200 bg-white shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Safety Stock Optimizer</h2>
          <p className="text-xs text-slate-500">Transition from static parameters to dynamic, demand-driven inventory targets</p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex gap-6 p-6">
        {/* Left Panel: SKU Review Queue */}
        <div className="w-1/3 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm">
           <div className="p-4 border-b border-slate-200 bg-slate-50">
             <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
               <Package className="w-4 h-4" /> SKU Review Queue
             </h3>
           </div>
           <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
             {SKU_DATA.map((sku) => {
               const isSelected = selectedSkuId === sku.id;
               return (
                 <button
                   key={sku.id}
                   onClick={() => {
                     setSelectedSkuId(sku.id);
                     setShowReasonCode(false);
                     setReasonCode("");
                   }}
                   className={cn(
                     "w-full text-left p-4 rounded-xl border transition-all relative overflow-hidden",
                     isSelected ? getSeverityColor(sku.severity) : "border-slate-200 bg-white hover:border-[#DB033B] hover:shadow-md",
                     isSelected ? "shadow-sm ring-1 ring-black/5" : ""
                   )}
                 >
                   {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#DB033B]" />}
                   
                   <div className="flex justify-between items-start mb-1">
                     <span className="text-[10px] font-mono text-slate-500">{sku.skuCode}</span>
                     {getSeverityIcon(sku.severity)}
                   </div>
                   <h4 className="font-bold text-slate-800 leading-tight mb-2 pr-4">{sku.skuName}</h4>
                   <p className="text-xs text-slate-600 line-clamp-2">{sku.shortDesc}</p>
                   
                   {isSelected && (
                     <div className="mt-3 flex items-center justify-end text-[#DB033B]">
                        <ChevronRight className="w-4 h-4" />
                     </div>
                   )}
                 </button>
               );
             })}
           </div>
        </div>

        {/* Right Panel: Optimization Workspace */}
        <div className="w-2/3 flex flex-col gap-4 overflow-y-auto">
          {/* Header Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
             <div className="flex justify-between items-start mb-4">
                <div>
                   <h2 className="text-xl font-bold text-slate-900">{activeSku.skuName}</h2>
                   <div className="flex items-center gap-3 mt-1">
                      <span className="font-mono text-sm text-slate-500">{activeSku.skuCode}</span>
                      <span className="text-slate-300">|</span>
                      <span className={cn(
                        "text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                        activeSku.severity === 'critical' ? 'bg-[#DB033B]/10 text-[#DB033B]' :
                        activeSku.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      )}>
                        {activeSku.shortDesc}
                      </span>
                   </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                   {/* Confidence Badge */}
                   <div className={cn(
                     "px-3 py-1 rounded-full text-xs font-bold border shadow-sm",
                     ((activeSku as any).confidenceScore || 0.92) >= 0.9 ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                     ((activeSku as any).confidenceScore || 0.92) >= 0.75 ? "bg-amber-100 text-amber-800 border-amber-200" : 
                     "bg-[#DB033B]/10 text-[#DB033B] border-[#DB033B]/20"
                   )}>
                     Agent Confidence: {Math.round(((activeSku as any).confidenceScore || 0.92) * 100)}%
                   </div>
                   <div className="text-right">
                      <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">Impact</div>
                      <div className={cn(
                        "font-mono font-bold",
                        activeSku.severity === 'neutral' ? "text-slate-700" : "text-emerald-600"
                      )}>{activeSku.financialImpact}</div>
                   </div>
                </div>
             </div>

             <p className="text-sm text-slate-700 mb-4 leading-relaxed">{activeSku.detail}</p>
             
             <div className="flex gap-2flex-wrap">
               {activeSku.agents.map((agent, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase bg-[#DB033B]/10 text-[#DB033B] border border-[#DB033B]/20">
                    <ShieldCheck className="w-3 h-3" />
                    {agent}
                  </span>
               ))}
             </div>
          </div>

          {/* Chart Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col shadow-sm flex-1">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">AI Safety Stock Analysis</h3>
            
            <div className="flex-1 w-full min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={activeSku.weeklyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="week" stroke="#94a3b8" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9', opacity: 0.5 }} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} iconType="circle" />
                  
                  {/* Dynamic Band Background */}
                  <Area 
                    type="monotone" 
                    dataKey="dynamicMax" 
                    stroke="none" 
                    fill="#3b82f6" 
                    fillOpacity={0.15} 
                    name="AI Recommended Dynamic Band"
                  />
                  {/* To visually create a range, we can draw the Min line or use a stacked area trick, 
                      but since we just want a simple shading, a single area to Max and a line for actual works well. 
                      Actually, better to plot an Area that starts from 0 but we want a band. 
                      Recharts Area supports [min, max] data bounds natively! Let's format the chartData specifically for Recharts area band!
                      Wait, Recharts requires dataKey to point to an array for continuous bands in Area, changing data structure isn't worth risk.
                      We will just plot Area from bottom up, with a white Area underneath to cut it out. */}
                  
                  <Area 
                    type="monotone" 
                    dataKey="dynamicMin" 
                    stroke="none" 
                    fill="#ffffff" 
                    fillOpacity={1} 
                    name="Dynamic Band Min Indicator" 
                    legendType="none"
                    tooltipType="none"
                  />

                  {/* Static Stock Line */}
                  <Line 
                    type="stepAfter" 
                    dataKey="staticStock" 
                    name="Current Static Target" 
                    stroke="#94a3b8" 
                    strokeWidth={2} 
                    strokeDasharray="5 5" 
                    dot={false} 
                    activeDot={false}
                  />

                  {/* Actual Demand Line */}
                  <Line 
                    type="monotone" 
                    dataKey="actualDemand" 
                    name="Actual Demand Volatility" 
                    stroke="#0f172a" 
                    strokeWidth={2} 
                    dot={{ stroke: '#0f172a', strokeWidth: 2, r: 3, fill: '#fff' }} 
                  />
                  
                  <Line 
                    type="monotone" 
                    dataKey="dynamicMax"
                    stroke="#3b82f6"
                    strokeWidth={1}
                    dot={false}
                    name="Dynamic Band Max Indicator"
                    legendType="none"
                    tooltipType="none"
                    strokeDasharray="3 3"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="dynamicMin"
                    stroke="#3b82f6"
                    strokeWidth={1}
                    dot={false}
                    name="Dynamic Band Min Indicator"
                    legendType="none"
                    tooltipType="none"
                    strokeDasharray="3 3"
                  />

                </ComposedChart>
              </ResponsiveContainer>
            </div>
            
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100">
               <div className="text-center w-1/3">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Current Static Target</div>
                 <div className="text-xl font-mono text-slate-700">{activeSku.currentStaticStock.toLocaleString()} CS</div>
               </div>
               <ChevronRight className="w-6 h-6 text-slate-300" />
               <div className="text-center w-1/3">
                 <div className="text-[10px] text-[#DB033B] uppercase font-bold tracking-widest mb-1">AI Recommendation</div>
                 <div className="text-xl font-mono text-[#DB033B] font-bold">{activeSku.recommendedDynamicStock.toLocaleString()} CS (Avg)</div>
               </div>
            </div>
          </div>

          {/* Rationale & Action Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
             {activeSku.rationale && (
               <div className="mb-6 border-b border-slate-100 pb-4">
                 <button 
                   onClick={() => setShowRationale(!showRationale)}
                   className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors font-medium border-none bg-transparent p-0 cursor-pointer w-full text-left"
                 >
                   <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", showRationale && "rotate-90")} />
                   Why did the agent recommend this?
                 </button>
                 {showRationale && (
                   <p className="mt-3 text-xs leading-relaxed text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 text-left">
                     {activeSku.rationale}
                   </p>
                 )}
               </div>
             )}

             {!showReasonCode ? (
               <div className="flex gap-4">
                 <button className="flex-1 bg-[#DB033B] hover:opacity-90 text-white font-bold py-3 px-4 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors shadow-sm focus:ring-4 focus:ring-[#DB033B]/20">
                   <CheckCircle2 className="w-5 h-5" /> Approve Dynamic Target via SAP BAPI
                 </button>
                 <button 
                  onClick={() => setShowReasonCode(true)}
                  className="px-6 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold py-3 rounded-lg text-sm transition-colors shadow-sm"
                 >
                   Keep Static Target
                 </button>
               </div>
             ) : (
               <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 animate-in fade-in slide-in-from-top-4 duration-200">
                 <h4 className="text-sm font-bold text-slate-800 mb-3">Decision Capture (Phase 2 Training Data)</h4>
                 <select 
                   value={reasonCode}
                   onChange={(e) => setReasonCode(e.target.value)}
                   className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB033B] mb-4"
                 >
                   <option value="" disabled>Select a mandatory reason code...</option>
                   <option value="pending_validation">Pending Supplier Validation</option>
                   <option value="strategic_buffer">Strategic Buffer Built</option>
                   <option value="data_lag">Known Data Lag in Baseline</option>
                   <option value="other">Other (Add Note)</option>
                 </select>
                 
                 <div className="flex gap-3 justify-end mt-4">
                   <button 
                     onClick={() => setShowReasonCode(false)}
                     className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 font-medium"
                   >
                     Cancel
                   </button>
                   <button 
                     disabled={!reasonCode}
                     className="bg-slate-800 hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-bold transition-colors"
                   >
                     Log Decision & Keep Static
                   </button>
                 </div>
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}

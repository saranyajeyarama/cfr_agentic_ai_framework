import React from 'react';
import { AlertCircle, ArrowRight, ShieldAlert, TrendingUp } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { ComposableMap, Geographies, Geography, Marker, Line } from "react-simple-maps";
import type { DashboardData } from '../../types/dashboard';

export function Watchtower({ data }: { data: DashboardData }) {
  const { alerts, networkNodes, globalKPIs } = data;

  const getNodeCoords = (id: string) => {
    const n = networkNodes.find(n => n.id === id);
    return n ? [n.lng, n.lat] as [number, number] : [0, 0] as [number, number];
  };
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <style>{`
        @keyframes dash {
          to { stroke-dashoffset: -12; }
        }
        .animate-dash {
          animation: dash 1s linear infinite;
        }
      `}</style>
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Agent Watchtower</h1>
          <p className="text-xs text-slate-500">Operational visibility & predictive alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100 text-[10px] font-bold uppercase">
            Network Health: Stable
          </div>
        </div>
      </div>



      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-12 gap-6 bg-slate-50">
        {/* Component 1: The Agent Inbox (Action Queue) */}
        <div className="col-span-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent Priority Inbox</h2>
            <span className="text-xs bg-[#DB033B]/10 text-[#DB033B] font-bold px-2 py-0.5 rounded-full font-mono">{alerts.length} Alerts</span>
          </div>

          <div className="flex flex-col gap-3">
            {alerts.map(alert => (
              <AlertCard 
                key={alert.id}
                level={alert.severity as 'critical' | 'warning' | 'info'}
                tagLabel={`${alert.severity === 'critical' ? 'Critical' : 'Warning'}: ${alert.type}`}
                title={alert.title}
                customer={alert.customer}
                description={alert.description}
                actionLabel={`Resolve via ${alert.actionTab}`}
                riskAmount={alert.fineAtRisk}
              />
            ))}
          </div>
        </div>

        {/* Component 2: Network Constraint Topology */}
        <div className="col-span-8 flex flex-col gap-4">
          {/* Impact Ribbon */}
          <div className="bg-slate-800 rounded-xl p-4 flex justify-between items-center text-white shadow-sm">
            <div className="flex flex-col items-center flex-1">
              <span className="text-2xl font-bold font-mono">${globalKPIs.demurrageAvoidedWTD.toLocaleString()}</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Demurrage Avoided This Week</span>
            </div>
            <div className="w-px h-10 bg-slate-700"></div>
            <div className="flex flex-col items-center flex-1">
              <span className="text-2xl font-bold font-mono">{globalKPIs.casesAtRiskThisWeek.toLocaleString()}</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Cases At Risk This Week</span>
            </div>
            <div className="w-px h-10 bg-slate-700"></div>
            <div className="flex flex-col items-center flex-1">
              <span className="text-2xl font-bold font-mono">{(globalKPIs.agentRecommendationAcceptanceRate * 100).toFixed(0)}%</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Agent Acceptance Rate</span>
            </div>
          </div>

          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Network Topology Map</h2>
          <div className="flex-1 bg-slate-100 border border-slate-200 rounded-xl relative overflow-hidden">
            
            {/* North America SVG Map Overlay */}
            <div className="absolute inset-0 z-0 drop-shadow-sm">
              <ComposableMap
                projection="geoAlbers"
                projectionConfig={{
                  scale: 800,
                  rotate: [96, 0, 0],
                  center: [-4, 38]
                }}
                className="w-full h-full object-cover"
                style={{ width: "100%", height: "100%" }}
              >
                <defs>
                  <radialGradient id="halo-red" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="halo-green" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="halo-amber" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                  </radialGradient>
                  <pattern id="storm-pattern" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="20" stroke="#64748b" strokeWidth="2" strokeOpacity="0.3" />
                  </pattern>
                </defs>

                <Geographies geography="https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json">
                  {({ geographies }) =>
                    geographies.map((geo) => (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill="#f1f5f9"
                        stroke="#ffffff"
                        strokeWidth={1}
                        className="outline-none"
                      />
                    ))
                  }
                </Geographies>

                {/* Simulated US States outlines for more detail */}
                <Geographies geography="https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json">
                  {({ geographies }) =>
                    geographies.map((geo) => (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill="transparent"
                        stroke="#ffffff"
                        strokeWidth={1}
                        className="outline-none pointer-events-none"
                      />
                    ))
                  }
                </Geographies>

                {/* Disruption Overlays */}
                <Marker coordinates={[-86, 38]}>
                  {/* Midwest Storm overlay */}
                  <g className="pointer-events-none">
                    <ellipse cx="0" cy="0" rx="35" ry="25" fill="url(#storm-pattern)" />
                    <ellipse cx="0" cy="0" rx="35" ry="25" fill="#cbd5e1" fillOpacity="0.6" />
                    <path d="M-10,-5 Q-5,-10 0,-5 T10,-5 T15,-5 T20,5 Q20,10 15,15 L-15,15 Q-20,15 -20,5 Q-20,-5 -10,-5 Z" fill="#64748b" opacity="0.4"/>
                    <text x="0" y="2" fill="#334155" fontSize="4.5" fontWeight="bold" textAnchor="middle" opacity="0.8">SEVERE STORM</text>
                  </g>
                </Marker>

                {/* Map Connections */}
                <Line
                  from={getNodeCoords('dc-05')} // Seattle
                  to={getNodeCoords('plant-us01')} // Chicago
                  stroke="#10b981"
                  strokeWidth={2.5}
                />
                <Line
                  from={getNodeCoords('plant-us01')}
                  to={getNodeCoords('dc-02')} // Dallas
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  strokeDasharray="4 6"
                  className="animate-dash"
                />
                <Line
                  from={getNodeCoords('dc-02')} // Dallas
                  to={getNodeCoords('dc-03')} // Jacksonville
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  strokeDasharray="6 6"
                  className="animate-dash"
                />
                <Line
                  from={getNodeCoords('plant-us01')}
                  to={getNodeCoords('dc-04')} // Carlisle
                  stroke="#10b981"
                  strokeWidth={2.5}
                />

                {/* Map Nodes */}
                {networkNodes.map(n => (
                  <Node
                    key={n.id}
                    coordinates={[n.lng, n.lat]}
                    label={`${n.name} (${n.city})`}
                    status={n.status as 'ok' | 'warning' | 'critical'}
                    utilization={n.status === 'critical' ? 'high' : n.status === 'warning' ? 'medium' : 'low'}
                    tooltip={n.statusReason}
                  />
                ))}
              </ComposableMap>
            </div>

            {/* Content overlay */}
            <div className="absolute inset-0 z-10 pointer-events-none p-4 pb-4">
              {/* Topology Legend */}
              <div className="absolute bottom-4 left-4 flex gap-4 bg-white/95 backdrop-blur-sm p-3 rounded-lg border border-slate-200 shadow-sm pointer-events-auto">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-sm"></div> Healthy
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <div className="w-2.5 h-2.5 bg-amber-500 rounded-full shadow-sm animate-pulse"></div> Backlog
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-b-[9px] border-l-transparent border-r-transparent border-b-[#DB033B] animate-pulse"></div> Risk
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

const AlertCard: React.FC<{
  level: 'critical' | 'warning' | 'info';
  title: string;
  customer: string;
  tagLabel?: string;
  description: string;
  actionLabel: string;
  riskAmount?: number;
}> = ({ 
  level, 
  title, 
  customer, 
  tagLabel,
  description, 
  actionLabel, 
  riskAmount 
}) => {
  const isCritical = level === 'critical';
  const isWarning = level === 'warning';
  
  const borderColor = isCritical ? 'border-[#DB033B]' : isWarning ? 'border-amber-500' : 'border-[#DB033B]';
  const textColor = isCritical ? 'text-[#DB033B]' : isWarning ? 'text-amber-700' : 'text-[#DB033B]';
  const tagBgColor = isCritical ? 'bg-[#DB033B]/10' : isWarning ? 'bg-amber-50' : 'bg-slate-50';
  const tag = tagLabel || (isCritical ? 'Critical: OTIF Breach' : isWarning ? 'Warning: Risk At Hand' : 'Info');

  return (
    <div className={`bg-white border-l-4 ${borderColor} p-4 rounded shadow-sm opacity-95 transition-all hover:shadow-md`}>
      <div className="flex justify-between items-start mb-2">
        <span className={`text-[9px] font-black ${textColor} ${tagBgColor} uppercase tracking-wider px-1.5 py-0.5 rounded`}>{tag}</span>
        <span className="text-[10px] font-medium text-slate-500">{customer}</span>
      </div>
      <h3 className="text-sm font-bold text-slate-800 mb-1">{title}</h3>
      <p className="text-[11px] text-slate-600 mb-3 leading-relaxed border-b border-slate-100 pb-3">{description}</p>
      <div className="flex justify-between items-center mt-2">
        {riskAmount ? (
          <span className="text-xs font-bold text-slate-800">Risk: ${riskAmount.toLocaleString()}</span>
        ) : (
          <span></span>
        )}
        <button className={isCritical ? "px-3 py-1.5 bg-slate-900 text-white text-[10px] font-bold rounded hover:bg-slate-800 ml-auto transition-colors shadow-sm" : "text-[10px] font-bold text-[#DB033B] bg-slate-50 border border-slate-200 hover:bg-slate-100 ml-auto transition-colors px-3 py-1.5 rounded shadow-sm"}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

const Node: React.FC<{
  coordinates: [number, number];
  label: string;
  status: 'ok' | 'warning' | 'critical';
  tooltip?: string;
  isCustomer?: boolean;
  fineAtRisk?: number;
  backlog?: boolean;
  utilization?: 'high' | 'medium' | 'low';
}> = ({ 
  coordinates, 
  label, 
  status, 
  tooltip, 
  isCustomer = false, 
  fineAtRisk = 0,
  backlog = false,
  utilization
}) => {
  const isOk = status === 'ok';
  const isWarning = status === 'warning';
  const isCritical = status === 'critical';
  
  const color = isOk ? '#10b981' : isWarning ? '#f59e0b' : '#ef4444';
  const haloColor = utilization === 'high' ? 'url(#halo-red)' : utilization === 'low' ? 'url(#halo-green)' : utilization === 'medium' ? 'url(#halo-amber)' : 'transparent';
  
  // Base scale on fineAtRisk if it's a customer
  const scale = isCustomer && fineAtRisk > 0 ? 1 + (fineAtRisk / 50000) * 0.8 : 1;
  const radius = 5 * scale;

  return (
    <Marker coordinates={coordinates}>
      <g className="group cursor-help transition-all duration-300 pointer-events-auto">
        {/* Heatmap effect for node density / utilization */}
        {utilization && !isCustomer && (
          <circle r={radius * 4.5} fill={haloColor} className="pointer-events-none" />
        )}
        {/* Pulsing glow for backlog or critical items */}
        {backlog && (
          <circle r={radius * 2.5} fill={color} className="animate-[pulse-ring_2s_cubic-bezier(0.4,0,0.6,1)_infinite] opacity-30" />
        )}
        {isCritical && !backlog && (
          <circle r={radius * 2.5} fill={color} className="animate-[pulse-ring_2s_cubic-bezier(0.4,0,0.6,1)_infinite] opacity-30" />
        )}

        {isCustomer ? (
          // Customer Risk (OTIF): Red triangular icon
          <polygon 
            points={`0,-${radius * 1.5} ${radius * 1.3},${radius} -${radius * 1.3},${radius}`} 
            fill={color} 
            stroke="#ffffff" 
            strokeWidth={1.5}
          />
        ) : (
          <circle r={radius} fill={color} stroke="#ffffff" strokeWidth={1.5} />
        )}
        
        {/* '!' badge for backlog */}
        {backlog && !isCustomer && (
          <g transform={`translate(${radius}, -${radius + 3})`}>
            <circle r={5} fill="#ef4444" stroke="#ffffff" strokeWidth={1} />
            <text x="0" y="2.5" fill="#ffffff" fontSize="7" fontWeight="bold" textAnchor="middle" className="font-sans">!</text>
          </g>
        )}

        {/* Custom Tooltip via ForeignObject */}
        <foreignObject x={isCustomer ? 12 : 10} y={-45} width={220} height={150} className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-slate-900 border border-slate-700 text-white p-2.5 rounded-lg shadow-xl inline-block w-max max-w-[200px]">
            <p className={`text-[11px] font-bold ${isWarning ? 'text-amber-400' : isCritical ? 'text-[#DB033B]' : 'text-emerald-400'}`}>{label}</p>
            {backlog && <div className="text-[9px] uppercase tracking-wider text-amber-500 font-bold bg-amber-500/10 px-1 py-0.5 rounded inline-block mt-1 border border-amber-500/20">Active Backlog</div>}
            {tooltip && <p className="text-[10px] mt-1 leading-relaxed text-slate-300 whitespace-normal">{tooltip}</p>}
          </div>
        </foreignObject>
      </g>
    </Marker>
  )
}


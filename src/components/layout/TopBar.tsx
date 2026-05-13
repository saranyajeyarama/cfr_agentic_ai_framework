import mockData from '../../data/mockData.json';
import { Dog, Cat } from 'lucide-react';

export function TopBar() {
  const { globalKPIs } = mockData;

  return (
    <header className="h-14 border-b-2 border-[#DB033B] bg-white flex items-center justify-between px-6 shrink-0 z-50">
      <div className="flex items-center gap-6">
        <div className="flex flex-col">
          <span className="font-[700] text-[#DB033B] text-[14px] leading-tight">Mars Pet Nutrition</span>
          <span className="text-[#94a3b8] text-[10px] leading-tight">OpEx Tower — Customer Supply</span>
        </div>
        <div className="w-px h-8 bg-[#e2e8f0]"></div>
      </div>
      
      <div className="flex items-center gap-8 flex-1 pl-6">
        <div className="flex flex-col">
          <span className="text-[0.65rem] uppercase tracking-widest text-slate-500 font-semibold">Network CFR</span>
          <span className="text-lg font-mono font-bold text-emerald-600">{globalKPIs.networkCFR}%</span>
        </div>
        <div className="w-px h-8 bg-slate-200"></div>
        <div className="flex flex-col">
          <span className="text-[0.65rem] uppercase tracking-widest text-slate-500 font-semibold">Fines at Risk (7D)</span>
          <span className="text-lg font-mono font-bold text-[#DB033B]">${globalKPIs.otifFinesAtRisk7Day.toLocaleString()}</span>
        </div>
        <div className="w-px h-8 bg-slate-200"></div>
        <div className="flex flex-col">
          <span className="text-[0.65rem] uppercase tracking-widest text-slate-500 font-semibold">Rev. Preserved</span>
          <span className="text-lg font-mono font-bold text-slate-900">${globalKPIs.revenuePreservedMTD.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-700">
          <span className="text-xs font-bold">JD</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: '58px', overflow: 'hidden', gap: '8px', flexShrink: 0, paddingRight: 0 }}>
          <Dog size={24} color="#eab308" className="mb-2" />
          <Dog size={28} color="#f97316" className="mb-2" />
          <Cat size={32} color="#ec4899" className="mb-2" />
        </div>
      </div>
    </header>
  );
}


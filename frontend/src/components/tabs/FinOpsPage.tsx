/**
 * LLM FinOps — token & cost analytics over the submission log.
 * Reads GET /finops/llm?days=… → vw_llm_finops_daily rollup
 * (totals + by-agent + by-model + daily series).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, DollarSign, Cpu, Hash, Layers } from 'lucide-react';
import { fetchFinops, type FinopsResponse } from '../../lib/api';
import { DashboardSkeleton } from '../primitives';

const usd = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: unknown) => (Number(n) || 0).toLocaleString();

function Tile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8' }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function BreakdownTable({ title, keyName, rows }: { title: string; keyName: 'agent' | 'model'; rows: Array<Record<string, unknown>> }) {
  const maxCost = Math.max(1, ...rows.map(r => Number(r['est_cost_usd']) || 0));
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ background: '#f8fafc' }}>
          {[keyName === 'agent' ? 'Agent' : 'Model', 'Calls', 'Tokens', 'Cost', ''].map(h => (
            <th key={h} style={{ textAlign: h === 'Calls' || h === 'Tokens' || h === 'Cost' ? 'right' : 'left',
                                 padding: '7px 12px', color: '#94a3b8', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No data yet.</td></tr>}
          {rows.map((r, i) => {
            const cost = Number(r['est_cost_usd']) || 0;
            return (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#334155' }}>{String(r[keyName] ?? '?')}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', color: '#475569' }}>{num(r['calls'])}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#475569' }}>{num(r['total_tokens'])}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{usd(cost)}</td>
                <td style={{ padding: '7px 12px', width: 120 }}>
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3 }}>
                    <div style={{ height: 6, width: `${Math.round((cost / maxCost) * 100)}%`, background: '#7c3aed', borderRadius: 3 }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FinOpsPage() {
  const [days, setDays]       = useState(30);
  const [data, setData]       = useState<FinopsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fetchFinops(days)); }
    catch (e) { setError(e instanceof Error ? e.message : 'FinOps unavailable'); setData(null); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const t = data?.totals;
  const maxDayCost = Math.max(1, ...(data?.by_day ?? []).map(d => d.est_cost_usd || 0));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#DB033B]" /> LLM FinOps
          </h1>
          <p className="text-xs text-slate-500">Token spend &amp; cost by agent, model and day — from the submission log</p>
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}>
          {[7, 30, 90].map(d => {
            const on = days === d;
            return <button key={d} onClick={() => setDays(d)}
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                       background: on ? '#DB033B' : '#fff', color: on ? '#fff' : '#64748b' }}>{d}d</button>;
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
        {loading && !data ? <DashboardSkeleton title="Loading FinOps…" /> : (
          <>
            {error && (
              <div style={{ background: '#fff8e6', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
                {error} — no LLM calls logged yet (run a triage to populate fct_submission_log).
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
              <Tile label="Est. Cost" value={usd(t?.est_cost_usd ?? 0)} sub={`last ${data?.days ?? days} days`} icon={<DollarSign className="w-4 h-4" />} />
              <Tile label="Total Tokens" value={num(t?.total_tokens)} sub="input + output" icon={<Hash className="w-4 h-4" />} />
              <Tile label="LLM Calls" value={num(t?.calls)} sub="across all agents" icon={<Cpu className="w-4 h-4" />} />
              <Tile label="Input Tokens" value={num(t?.input_tokens)} icon={<Layers className="w-4 h-4" />} />
              <Tile label="Output Tokens" value={num(t?.output_tokens)} icon={<Layers className="w-4 h-4" />} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <BreakdownTable title="Spend by Agent" keyName="agent" rows={data?.by_agent ?? []} />
              <BreakdownTable title="Spend by Model" keyName="model" rows={data?.by_model ?? []} />
            </div>

            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Daily Cost &amp; Tokens</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  {['Day', 'Calls', 'Tokens', 'Cost', ''].map(h => (
                    <th key={h} style={{ textAlign: h === 'Day' ? 'left' : h === '' ? 'left' : 'right', padding: '7px 12px',
                                         color: '#94a3b8', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {(data?.by_day ?? []).length === 0 && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No daily data yet.</td></tr>}
                  {(data?.by_day ?? []).map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#334155' }}>{d.day}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: '#475569' }}>{num(d.calls)}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#475569' }}>{num(d.total_tokens)}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{usd(d.est_cost_usd)}</td>
                      <td style={{ padding: '7px 12px', width: 160 }}>
                        <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3 }}>
                          <div style={{ height: 6, width: `${Math.round(((d.est_cost_usd || 0) / maxDayCost) * 100)}%`, background: '#DB033B', borderRadius: 3 }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

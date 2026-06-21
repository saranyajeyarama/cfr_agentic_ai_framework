/**
 * Agent Logs — the 3 case-log tables (Submission · Suggestion · Acceptance)
 * captured per Order-Triage case. Reads GET /case-logs?log_type=…&case_id=…
 * (tiger_decisions.fct_submission_log / fct_suggestion_log / fct_acceptance_log).
 * Threaded by case_id → suggestion_id (→ acceptance_id).
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Loader2, ScrollText, ChevronDown, ChevronRight, Search, Download } from 'lucide-react';
import { fetchCaseLogs, type CaseLogResponse } from '../../lib/api';
import { DashboardSkeleton } from '../primitives';

type LogType = 'submission' | 'suggestion' | 'acceptance';
type Row = Record<string, unknown>;

const TABS: { id: LogType; label: string; desc: string }[] = [
  { id: 'submission', label: 'Submission', desc: 'one row per LLM call — prompt, model, tokens, cost' },
  { id: 'suggestion', label: 'Suggestion', desc: 'one row per evaluation run — recommendation + confidence' },
  { id: 'acceptance', label: 'Acceptance', desc: 'one row per human disposition — accept / reject / override' },
];

// Columns shown per log type: [field, header].
const COLUMNS: Record<LogType, [string, string][]> = {
  submission: [
    ['created_at', 'Time'], ['case_id', 'Case'], ['suggestion_id', 'Suggestion'], ['agent', 'Agent'],
    ['model', 'Model'], ['input_tokens', 'In'], ['output_tokens', 'Out'], ['total_tokens', 'Total'],
    ['est_cost_usd', 'Cost $'], ['latency_ms', 'ms'],
  ],
  suggestion: [
    ['created_at', 'Time'], ['case_id', 'Case'], ['suggestion_id', 'Suggestion'], ['recommendation', 'Rec'],
    ['confidence', 'Conf'], ['decision_type', 'Decision Type'], ['sap_transaction_target', 'SAP'],
    ['agent', 'Agent'], ['model', 'Model'], ['is_reevaluation', 'Re-eval'],
  ],
  acceptance: [
    ['created_at', 'Time'], ['case_id', 'Case'], ['suggestion_id', 'Suggestion'], ['disposition', 'Disposition'],
    ['decision_aligned_with_agent', 'Aligned'], ['override_reason', 'Override'], ['user_id', 'User'],
    ['agent', 'Agent'], ['model', 'Model'],
  ],
};

function fmt(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'created_at') { try { return new Date(String(v)).toLocaleString(); } catch { return String(v); } }
  if (field === 'suggestion_id' || field === 'decision_id') return String(v).slice(0, 10);
  if (field === 'est_cost_usd') return `$${Number(v).toFixed(4)}`;
  if (field === 'confidence') return `${Math.round(Number(v) * 100)}%`;
  if (field === 'latency_ms') return `${Math.round(Number(v))}`;
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

function triggerDownload(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function idTag(r: Row, type: LogType): string {
  const k = type === 'submission' ? 'submission_id' : type === 'suggestion' ? 'suggestion_id' : 'acceptance_id';
  return String(r[k] ?? r['case_id'] ?? 'row').replace(/[^\w.-]+/g, '_');
}

function prettyPayload(payload: unknown): string {
  try { return JSON.stringify(JSON.parse(String(payload)), null, 2); } catch { return String(payload); }
}

export function LogsPage() {
  const [type, setType]       = useState<LogType>('submission');
  const [caseId, setCaseId]   = useState('');
  const [caseQ, setCaseQ]     = useState('');
  const [resp, setResp]       = useState<CaseLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setOpenIdx(null);
    try {
      setResp(await fetchCaseLogs(type, 200, caseQ.trim() || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Logs unavailable');
      setResp({ log_type: type, rows: [] });
    } finally { setLoading(false); }
  }, [type, caseQ]);

  useEffect(() => { void load(); }, [load]);

  const rows: Row[] = resp?.rows ?? [];
  const cols = COLUMNS[type];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-16 px-8 flex items-center border-b border-slate-200 bg-white justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-[#DB033B]" /> Agent Logs
          </h1>
          <p className="text-xs text-slate-500">
            Submission · Suggestion · Acceptance — every case captured in BigQuery, threaded by case_id
          </p>
        </div>
        <span className="text-xs text-slate-400">
          GET <span className="font-mono text-slate-600">/case-logs</span> · tiger_decisions.fct_{type}_log
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
        {/* Toolbar: log-type tabs + case filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}>
            {TABS.map(t => {
              const on = type === t.id;
              return (
                <button key={t.id} onClick={() => setType(t.id)} title={t.desc}
                  style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                           background: on ? '#DB033B' : '#fff', color: on ? '#fff' : '#64748b' }}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '4px 10px' }}>
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={caseId} onChange={e => setCaseId(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') setCaseQ(caseId); }}
                   placeholder="Filter by case_id (e.g. CASE-SO-…)"
                   style={{ border: 'none', outline: 'none', fontSize: 12, width: 240, color: '#1e293b' }} />
            <button onClick={() => setCaseQ(caseId)}
                    style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', border: 'none', background: 'transparent', cursor: 'pointer' }}>Apply</button>
            {caseQ && <button onClick={() => { setCaseId(''); setCaseQ(''); }}
                    style={{ fontSize: 11, color: '#94a3b8', border: 'none', background: 'transparent', cursor: 'pointer' }}>clear</button>}
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {loading ? <Loader2 className="inline w-3 h-3 animate-spin" /> : `${rows.length} rows`}
          </span>
        </div>

        <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>{TABS.find(t => t.id === type)?.desc}</p>

        {loading && !resp ? <DashboardSkeleton title="Loading logs…" /> : (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            {error && (
              <div style={{ padding: '10px 14px', background: '#fff8e6', color: '#92400e', fontSize: 12, borderBottom: '1px solid #fde68a' }}>
                {error} — table may be empty until a triage runs.
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1000 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ width: 24 }} />
                    {cols.map(([, h]) => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#94a3b8', fontWeight: 700,
                                           fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                    <th style={{ width: 56, textAlign: 'right', padding: '8px 10px', color: '#94a3b8', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #e2e8f0' }}>JSON</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={cols.length + 2} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      No {type} rows yet — run a triage in Order Triage (and approve it) to populate the logs.
                    </td></tr>
                  )}
                  {rows.map((r, i) => {
                    const open = openIdx === i;
                    const payload = r['payload'];
                    return (
                      <Fragment key={i}>
                        <tr onClick={() => setOpenIdx(open ? null : i)}
                            style={{ borderBottom: '1px solid #f1f5f9', cursor: payload ? 'pointer' : 'default', background: i % 2 ? '#fff' : '#fcfcfd' }}>
                          <td style={{ padding: '6px 4px', color: '#cbd5e1' }}>
                            {payload ? (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : null}
                          </td>
                          {cols.map(([f]) => (
                            <td key={f} style={{ padding: '7px 10px', color: '#334155', whiteSpace: 'nowrap',
                                                 fontFamily: ['agent','model','case_id','suggestion_id','sap_transaction_target'].includes(f) ? 'monospace' : 'inherit',
                                                 fontWeight: f === 'recommendation' || f === 'disposition' ? 700 : 400 }}>
                              {fmt(f, r[f])}
                            </td>
                          ))}
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                            <button onClick={(e) => { e.stopPropagation(); triggerDownload(`${type}_${idTag(r, type)}.json`, JSON.stringify(r, null, 2)); }}
                                    title="Download this log entry as JSON"
                                    style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '3px 7px', color: '#7c3aed', display: 'inline-flex' }}>
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                        {open && payload != null && (
                          <tr>
                            <td />
                            <td colSpan={cols.length + 1} style={{ padding: '8px 12px', background: '#0f172a' }}>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                                <button onClick={() => triggerDownload(`${type}_payload_${idTag(r, type)}.json`, prettyPayload(payload))}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #475569', borderRadius: 6, background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '4px 10px' }}>
                                  <Download className="w-3.5 h-3.5" /> Download payload (blob)
                                </button>
                              </div>
                              <pre style={{ margin: 0, color: '#e2e8f0', fontSize: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 280, overflow: 'auto' }}>
                                {prettyPayload(payload)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

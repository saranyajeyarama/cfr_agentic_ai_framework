/**
 * Data Dictionary — two views:
 *   • Schema   (default) — LIVE from GET /data-dictionary (BigQuery
 *     INFORMATION_SCHEMA.COLUMNS): every view, its columns, data types,
 *     nullability + a derived classification/grain hint. No hardcoded schema.
 *   • Glossary — the curated business-term reference (src/lib/dictionaryData.ts).
 *
 * Business/lineage fields (description, source_table, source_field, BW
 * InfoObject) are NOT in BigQuery metadata, so the Schema view shows them as
 * '—' — never fabricated.
 */

import { useEffect, useState } from 'react';
import { Search, Database, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { C, MONO } from '../../lib/constants';
import { DICT_SECTIONS } from '../../lib/dictionaryData';
import { fetchDataDictionary, type DataDictionaryResponse, type DataDictColumn } from '../../lib/api';

const SECTION_COLORS: Record<string, string> = {
  'Order & Fulfillment':        C.blue,
  'Inventory':                  C.teal,
  'Demand & Forecast':          C.orange,
  'Transportation & Logistics': C.red,
  'Retail Intelligence':        C.purple,
  'Financial':                  C.green,
  'Agent & System':             C.charcoal,
};

const CLASS_COLOR: Record<string, string> = {
  key:       C.red,
  measure:   C.blue,
  date:      C.teal,
  dimension: C.muted,
};

const NA = '—';

export function DataDictionaryPage() {
  const [mode, setMode] = useState<'schema' | 'glossary'>('schema');
  const [query, setQuery] = useState<string>('');
  const [activeSection, setActiveSection] = useState<string>('All');

  // ── Schema (live) state ──────────────────────────────────────────────────
  const [schema, setSchema] = useState<DataDictionaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setErr(null);
    fetchDataDictionary()
      .then(d => { setSchema(d); setLoading(false); })
      .catch(e => { setErr(e instanceof Error ? e.message : 'Schema dictionary unavailable'); setLoading(false); });
  }, []);

  const q = query.toLowerCase().trim();

  // ── Glossary filter (unchanged) ────────────────────────────────────────────
  const filteredSections = DICT_SECTIONS
    .map(s => ({ ...s, terms: s.terms.filter(t => !q || t.term.toLowerCase().includes(q) || (t.full || '').toLowerCase().includes(q) || t.def.toLowerCase().includes(q)) }))
    .filter(s => s.terms.length > 0 && (activeSection === 'All' || s.section === activeSection));
  const totalTerms = DICT_SECTIONS.reduce((sum, sec) => sum + sec.terms.length, 0);

  // ── Schema filter ──────────────────────────────────────────────────────────
  const colHit = (c: DataDictColumn) =>
    c.name.toLowerCase().includes(q) || c.dataType.toLowerCase().includes(q) || c.classification.toLowerCase().includes(q);
  const filteredViews = (schema?.views ?? [])
    .map(v => {
      const nameHit = !q || v.name.toLowerCase().includes(q);
      const matched = q ? v.columns.filter(colHit) : v.columns;
      return { v, cols: nameHit ? v.columns : matched, show: nameHit || matched.length > 0 };
    })
    .filter(x => x.show);
  const shownCols = filteredViews.reduce((s, x) => s + x.cols.length, 0);

  const toggle = (name: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const Toggle = (
    <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {(['schema', 'glossary'] as const).map(m => (
        <button key={m} onClick={() => setMode(m)} style={{
          padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          border: 'none', background: mode === m ? C.red : '#fff', color: mode === m ? '#fff' : C.muted,
        }}>{m === 'schema' ? 'Schema' : 'Glossary'}</button>
      ))}
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.off }}>
      {/* Charcoal header */}
      <div style={{ background: C.charcoal, padding: '22px 28px 20px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 8, fontWeight: 700 }}>Info</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 10, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Data Dictionary</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 10 }}>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', flexShrink: 0, lineHeight: 1.5 }}>◈</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.6 }}>
                {mode === 'schema'
                  ? <>Live schema from <span style={{ fontFamily: MONO }}>tiger_semantic.INFORMATION_SCHEMA</span> — {schema ? `${schema.totalViews} views · ${schema.totalColumns} columns` : 'loading…'}.</>
                  : <>Functional definitions for every KPI and metric. {totalTerms} terms across {DICT_SECTIONS.length} domains.</>}
              </span>
            </div>
          </div>
          {Toggle}
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1180 }}>
        {/* Search + (glossary) section filter */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 320px', minWidth: 260 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none' }} />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder={mode === 'schema' ? `Search ${schema?.totalColumns ?? ''} columns / views…` : `Search ${totalTerms} terms…`}
              style={{ width: '100%', padding: '9px 14px 9px 32px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff', color: C.charcoal, boxSizing: 'border-box' }} />
          </div>
          {mode === 'glossary' && ['All', ...DICT_SECTIONS.map(s => s.section)].map(sec => {
            const active = activeSection === sec;
            return (
              <button key={sec} onClick={() => setActiveSection(sec)} style={{ padding: '7px 12px', border: `1px solid ${active ? C.red : C.border}`, borderRadius: 6, fontSize: 11, fontWeight: active ? 700 : 500, background: active ? C.redLight : '#fff', color: active ? C.red : C.muted, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {sec === 'All' ? 'All Sections' : sec}
              </button>
            );
          })}
        </div>

        {q && (
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
            {mode === 'schema'
              ? `${filteredViews.length} view${filteredViews.length !== 1 ? 's' : ''} · ${shownCols} column${shownCols !== 1 ? 's' : ''} match "${query}"`
              : `${filteredSections.reduce((s, sec) => s + sec.terms.length, 0)} results for "${query}"`}
          </div>
        )}

        {/* ── SCHEMA MODE ─────────────────────────────────────────────────── */}
        {mode === 'schema' && (
          loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, padding: '40px 0', justifyContent: 'center' }}>
              <Loader2 size={16} className="animate-spin" /> Loading live schema from BigQuery…
            </div>
          ) : err ? (
            <div style={{ background: '#fff8e6', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: 16, fontSize: 13 }}>
              Schema dictionary unavailable: {err}
            </div>
          ) : (
            <>
              {filteredViews.map(({ v, cols }) => {
                const open = q.length > 0 || expanded.has(v.name);
                return (
                  <div key={v.name} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                    <button onClick={() => toggle(v.name)} style={{ width: '100%', textAlign: 'left', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', border: 'none', borderBottom: open ? `1px solid ${C.border}` : 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {open ? <ChevronDown size={14} color={C.muted} /> : <ChevronRight size={14} color={C.muted} />}
                      <Database size={14} color={C.red} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.charcoal, fontFamily: MONO }}>{v.name}</span>
                      <span style={{ fontSize: 11, color: C.muted }}>· grain: {v.grainHint}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>{v.columnCount} cols</span>
                    </button>
                    {open && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', background: '#fff' }}>
                            {['#', 'Column', 'Type', 'Null', 'Class', 'Source Table', 'Source Field', 'BW InfoObject', 'Description'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cols.map((c, i) => (
                            <tr key={c.name} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fafafa' : '#fff' }}>
                              <td style={{ padding: '6px 10px', color: C.muted, fontFamily: MONO }}>{c.ordinal}</td>
                              <td style={{ padding: '6px 10px', fontWeight: 600, color: C.charcoal, fontFamily: MONO }}>{c.name}</td>
                              <td style={{ padding: '6px 10px', color: C.blue, fontFamily: MONO }}>{c.dataType}</td>
                              <td style={{ padding: '6px 10px', color: C.muted }}>{c.nullable ? 'Y' : 'N'}</td>
                              <td style={{ padding: '6px 10px' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: CLASS_COLOR[c.classification] || C.muted, background: `${CLASS_COLOR[c.classification] || C.muted}14`, border: `1px solid ${CLASS_COLOR[c.classification] || C.muted}30`, borderRadius: 4, padding: '1px 6px' }}>{c.classification}</span>
                              </td>
                              <td style={{ padding: '6px 10px', color: C.border }}>{c.sourceTable ?? NA}</td>
                              <td style={{ padding: '6px 10px', color: C.border }}>{c.sourceField ?? NA}</td>
                              <td style={{ padding: '6px 10px', color: C.border }}>{c.infoObject ?? NA}</td>
                              <td style={{ padding: '6px 10px', color: C.border }}>{c.description ?? NA}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              {filteredViews.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 0', color: C.muted }}>No views or columns match "{query}".</div>
              )}
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
                Source table / field / BW InfoObject / description are SAP-BW lineage metadata not present in
                BigQuery — shown as <span style={{ fontFamily: MONO }}>{NA}</span>. <span style={{ fontWeight: 600 }}>Class</span> and
                <span style={{ fontWeight: 600 }}> grain</span> are derived from column name + type.
              </div>
            </>
          )
        )}

        {/* ── GLOSSARY MODE ───────────────────────────────────────────────── */}
        {mode === 'glossary' && filteredSections.map(sec => {
          const col = SECTION_COLORS[sec.section] || C.charcoal;
          return (
            <div key={sec.section} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: col, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 0 3px ${col}22` }} />
                <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal, flex: 1 }}>{sec.section}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{sec.terms.length} term{sec.terms.length !== 1 ? 's' : ''}</div>
              </div>
              {sec.terms.map((t, i) => (
                <div key={t.term} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 160px', padding: '12px 18px', borderBottom: i < sec.terms.length - 1 ? `1px solid ${C.border}` : 'none', background: i % 2 === 0 ? '#fff' : '#fafafa', alignItems: 'start', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: C.charcoal, fontSize: 13, fontFamily: MONO, marginBottom: t.full ? 3 : 0 }}>{t.term}</div>
                    {t.full && <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.3 }}>{t.full}</div>}
                  </div>
                  <div style={{ fontSize: 12, color: C.charcoal, lineHeight: 1.65 }}>{t.def}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 2 }}>
                    {t.screens.map(s => (
                      <span key={s} style={{ fontSize: 9, fontWeight: 600, background: `${col}14`, color: col, borderRadius: 4, padding: '2px 6px', border: `1px solid ${col}30`, whiteSpace: 'nowrap' }}>{s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {mode === 'glossary' && filteredSections.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>⌕</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.charcoal, marginBottom: 4 }}>No terms match "{query}"</div>
          </div>
        )}
      </div>
    </div>
  );
}

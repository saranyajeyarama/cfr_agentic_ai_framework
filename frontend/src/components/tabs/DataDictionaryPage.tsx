/**
 * Data Dictionary — searchable glossary of supply-chain terminology.
 *
 * Restored to navigation in this phase (Phase 6.1). Pure static content
 * — pulls from src/lib/dictionaryData.ts. No backend dependency.
 *
 * Visual layout ported verbatim from the AI Studio reference
 * (context/mars-supply-ai-v2_02-restyled.jsx lines 3387–3537). Inline
 * styles preserved per the Phase 0.2 aesthetic rule.
 */

import { useState } from 'react';
import { Search } from 'lucide-react';
import { C, MONO } from '../../lib/constants';
import { DICT_SECTIONS } from '../../lib/dictionaryData';

const SECTION_COLORS: Record<string, string> = {
  'Order & Fulfillment':       C.blue,
  'Inventory':                 C.teal,
  'Demand & Forecast':         C.orange,
  'Transportation & Logistics': C.red,
  'Retail Intelligence':       C.purple,
  'Financial':                 C.green,
  'Agent & System':            C.charcoal,
};

export function DataDictionaryPage() {
  const [query, setQuery]               = useState<string>('');
  const [activeSection, setActiveSection] = useState<string>('All');

  const q = query.toLowerCase().trim();

  const filteredSections = DICT_SECTIONS
    .map(s => ({
      ...s,
      terms: s.terms.filter(t =>
        !q ||
        t.term.toLowerCase().includes(q) ||
        (t.full || '').toLowerCase().includes(q) ||
        t.def.toLowerCase().includes(q),
      ),
    }))
    .filter(s =>
      s.terms.length > 0 && (activeSection === 'All' || s.section === activeSection),
    );

  const totalTerms  = DICT_SECTIONS.reduce((sum, sec) => sum + sec.terms.length, 0);
  const matchCount  = filteredSections.reduce((sum, sec) => sum + sec.terms.length, 0);

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.off }}>

      {/* ── Charcoal header ───────────────────────────────────────────── */}
      <div style={{
        background: C.charcoal, padding: '22px 28px 20px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -20, right: -20, width: 160, height: 160,
          borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -30, right: 80, width: 100, height: 100,
          borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{
            fontSize: 10, color: 'rgba(255,255,255,0.55)',
            textTransform: 'uppercase', letterSpacing: '0.2em',
            marginBottom: 8, fontWeight: 700,
          }}>Info</div>
          <div style={{
            fontSize: 28, fontWeight: 700, color: '#fff',
            marginBottom: 10, letterSpacing: '-0.02em', lineHeight: 1.1,
          }}>Data Dictionary</div>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 10,
          }}>
            <span style={{
              fontSize: 14, color: 'rgba(255,255,255,0.4)', flexShrink: 0, lineHeight: 1.5,
            }}>◈</span>
            <span style={{
              fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.6,
            }}>
              Functional definitions for every KPI and metric used across the
              Supply AI platform. {totalTerms} terms across {DICT_SECTIONS.length} domains.
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>

        {/* ── Search + section filter ───────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 12, marginBottom: 20,
          alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ position: 'relative', flex: '1 1 320px', minWidth: 260 }}>
            <Search size={14} style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none',
            }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${totalTerms} terms...`}
              style={{
                width: '100%', padding: '9px 14px 9px 32px',
                border: `1px solid ${C.border}`, borderRadius: 6,
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
                background: '#fff', color: C.charcoal, boxSizing: 'border-box',
              }}
            />
          </div>
          {['All', ...DICT_SECTIONS.map(s => s.section)].map(sec => {
            const active = activeSection === sec;
            return (
              <button key={sec} onClick={() => setActiveSection(sec)} style={{
                padding: '7px 12px',
                border: `1px solid ${active ? C.red : C.border}`,
                borderRadius: 6, fontSize: 11,
                fontWeight: active ? 700 : 500,
                background: active ? C.redLight : '#fff',
                color: active ? C.red : C.muted,
                cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {sec === 'All' ? 'All Sections' : sec}
              </button>
            );
          })}
        </div>

        {q && (
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
            {matchCount} result{matchCount !== 1 ? 's' : ''} for "{query}"
          </div>
        )}

        {/* ── Dictionary sections ────────────────────────────────────── */}
        {filteredSections.map(sec => {
          const col = SECTION_COLORS[sec.section] || C.charcoal;
          return (
            <div key={sec.section} style={{
              background: '#fff', border: `1px solid ${C.border}`,
              borderRadius: 8, overflow: 'hidden', marginBottom: 16,
            }}>
              {/* Section header */}
              <div style={{
                padding: '12px 18px', borderBottom: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc',
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', background: col,
                  display: 'inline-block', flexShrink: 0,
                  boxShadow: `0 0 0 3px ${col}22`,
                }} />
                <div style={{
                  fontSize: 14, fontWeight: 700, color: C.charcoal, flex: 1,
                }}>{sec.section}</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {sec.terms.length} term{sec.terms.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Term rows */}
              {sec.terms.map((t, i) => (
                <div key={t.term} style={{
                  display: 'grid', gridTemplateColumns: '200px 1fr 160px',
                  padding: '12px 18px',
                  borderBottom: i < sec.terms.length - 1 ? `1px solid ${C.border}` : 'none',
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                  alignItems: 'start', gap: 16,
                }}>
                  {/* Term + abbreviation */}
                  <div>
                    <div style={{
                      fontWeight: 700, color: C.charcoal, fontSize: 13,
                      fontFamily: MONO, marginBottom: t.full ? 3 : 0,
                    }}>{t.term}</div>
                    {t.full && (
                      <div style={{
                        fontSize: 10, color: C.muted, lineHeight: 1.3,
                      }}>{t.full}</div>
                    )}
                  </div>
                  {/* Definition */}
                  <div style={{
                    fontSize: 12, color: C.charcoal, lineHeight: 1.65,
                  }}>{t.def}</div>
                  {/* Used in */}
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 2,
                  }}>
                    {t.screens.map(s => (
                      <span key={s} style={{
                        fontSize: 9, fontWeight: 600,
                        background: `${col}14`, color: col,
                        borderRadius: 4, padding: '2px 6px',
                        border: `1px solid ${col}30`, whiteSpace: 'nowrap',
                      }}>{s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* ── No-match empty state ──────────────────────────────────── */}
        {filteredSections.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>⌕</div>
            <div style={{
              fontSize: 15, fontWeight: 600, color: C.charcoal, marginBottom: 4,
            }}>No terms match "{query}"</div>
            <div style={{ fontSize: 13 }}>Try a different keyword or clear the search.</div>
          </div>
        )}
      </div>
    </div>
  );
}

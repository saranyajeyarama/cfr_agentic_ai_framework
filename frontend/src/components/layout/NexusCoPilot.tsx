/**
 * NexusCoPilot — v2.3 AI chat panel.
 * Extracted from mars-supply-ai-v2_02-restyled.jsx (function NexusCoPilot).
 *
 * Inline-style aesthetic preserved. PHASE 0.2 NOTE: this is the
 * shell-only version — the Gemini API wiring is intentionally NOT
 * carried over yet. With no NEXUS_API_KEY configured the panel
 * renders its `no_key` warning state and the input stays disabled.
 * Phase 1/2 wires the chat backend (Gemini direct OR routed through
 * the Cloud Run /chat endpoint).
 *
 * New file alongside RightSidebar.tsx — App.tsx is not yet swapped over.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PanelRightClose, PanelRightOpen, Bot } from 'lucide-react';
import { C, MONO } from '../../lib/constants';

// Read at module load so swapping in a build-time env var is straight-
// forward later. Phase 0.2: deliberately blank.
const NEXUS_API_KEY = '';

type Role = 'user' | 'agent';
type Message = { role: Role; text: string };
type ApiStatus = 'ready' | 'error' | 'no_key' | 'idle';

const STATUS_DOT: Record<ApiStatus, string> = {
  ready: C.green, error: C.red, no_key: '#f59e0b', idle: '#94a3b8',
};

const STATUS_LABEL: Record<ApiStatus, string> = {
  ready:  'Gemini 2.0 Flash · Ready',
  error:  'API Error',
  no_key: 'API Key Required',
  idle:   'Initialising…',
};

const QUICK_PROMPTS = [
  'What should I prioritize right now?',
  'Summarize the Chewy stockout risk',
  'Which orders have agent conflicts?',
];

const OPENING_MESSAGE: Message = {
  role: 'agent',
  text: 'Good morning. Phase 0.2 placeholder — Nexus is not wired up yet. Configure your API key (Phase 1/2) to begin chatting.',
};

export function NexusCoPilot() {
  const [col, setCol]       = useState(false);
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>(NEXUS_API_KEY ? 'ready' : 'no_key');
  const [messages, setMessages]   = useState<Message[]>([OPENING_MESSAGE]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!col) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, col]);

  // Phase 0.2: send is a no-op apart from echoing a placeholder warning.
  async function handleSend() {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setLoading(true);
    // Simulate latency for visual fidelity, then surface the not-wired-yet state.
    await new Promise(r => setTimeout(r, 400));
    setMessages(prev => [...prev, {
      role: 'agent',
      text: 'Nexus is not connected in this Phase 0.2 build. Wire NEXUS_API_KEY or backend /chat route in Phase 1/2 to enable conversation.',
    }]);
    setApiStatus('no_key');
    setLoading(false);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const statusDot   = STATUS_DOT[apiStatus];
  const statusLabel = STATUS_LABEL[apiStatus];
  const disabled    = loading || !NEXUS_API_KEY;

  // ── Collapsed ─────────────────────────────────────────────────────────────
  if (col) {
    return (
      <aside style={{
        width: 60, borderLeft: `1px solid ${C.border}`, background: '#fff',
        display: 'flex', flexDirection: 'column', flexShrink: 0, zIndex: 20,
      }}>
        <div style={{
          height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <button onClick={() => setCol(false)} style={{
            width: 36, height: 36, display: 'flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: 8,
            border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted,
          }}>
            <PanelRightOpen size={18} />
          </button>
        </div>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', paddingTop: 20, gap: 0,
        }}>
          <div onClick={() => setCol(false)}
               title="Open Nexus — Mars AI Co-Pilot"
               style={{ position: 'relative', cursor: 'pointer' }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%', background: C.redLight,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${C.border}`,
            }}>
              <Bot size={18} color={C.red} />
            </div>
            <div style={{
              position: 'absolute', top: 1, right: 1, width: 10, height: 10,
              borderRadius: '50%', border: '2px solid #fff', background: statusDot,
            }} />
          </div>
        </div>
      </aside>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────
  return (
    <aside style={{
      width: 320, borderLeft: `1px solid ${C.border}`, background: '#fff',
      display: 'flex', flexDirection: 'column', flexShrink: 0, zIndex: 20,
    }}>
      <style>{`
        @keyframes nx-b{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        .nx-d{width:6px;height:6px;border-radius:50%;background:#94a3b8;
          animation:nx-b 1s ease-in-out infinite;display:inline-block;}
        .nx-d:nth-child(2){animation-delay:0.15s}
        .nx-d:nth-child(3){animation-delay:0.30s}
        .nx-qp:hover{border-color:#DB033B!important;background:#fef2f2!important;color:#1e293b!important}
      `}</style>

      {/* Header */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: statusDot,
            }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.charcoal }}>
              Nexus — Mars AI Co-Pilot
            </span>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: C.muted, paddingLeft: 15,
          }}>{statusLabel}</span>
        </div>
        <button onClick={() => setCol(true)} style={{
          padding: 6, border: 'none', background: 'transparent', cursor: 'pointer',
          color: C.muted, borderRadius: 6, display: 'flex', alignItems: 'center',
        }}>
          <PanelRightClose size={16} />
        </button>
      </div>

      {/* No-key warning */}
      {apiStatus === 'no_key' && (
        <div style={{
          margin: '12px 12px 0', padding: '10px 12px', background: '#fffbeb',
          border: '1px solid #fcd34d', borderRadius: 8, fontSize: 11,
          color: '#92400e', lineHeight: 1.7,
        }}>
          <strong>API key required.</strong> Set{' '}
          <code style={{
            background: '#fef3c7', padding: '1px 5px', borderRadius: 3,
            fontFamily: MONO, fontSize: 10,
          }}>NEXUS_API_KEY</code>{' '}
          in <code style={{
            background: '#fef3c7', padding: '1px 5px', borderRadius: 3,
            fontFamily: MONO, fontSize: 10,
          }}>NexusCoPilot.tsx</code> to enable chat. Phase 1/2 wires this up.
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '14px 12px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex',
            flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
          }}>
            <div style={{
              padding: '9px 12px', fontSize: 12, lineHeight: 1.65, maxWidth: '86%',
              background: m.role === 'agent' ? '#f1f5f9' : C.red,
              color:      m.role === 'agent' ? '#334155' : '#fff',
              borderRadius: m.role === 'agent' ? '2px 12px 12px 12px' : '12px 2px 12px 12px',
            }} dangerouslySetInnerHTML={{
              __html: m.text
                .replace(/\n/g, '<br/>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
            }} />
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex' }}>
            <div style={{
              padding: '10px 14px', background: '#f1f5f9',
              borderRadius: '2px 12px 12px 12px',
              display: 'flex', gap: 5, alignItems: 'center',
            }}>
              <div className="nx-d" />
              <div className="nx-d" />
              <div className="nx-d" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts + input */}
      <div style={{
        padding: '10px 12px 14px', borderTop: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
          {QUICK_PROMPTS.map(q => (
            <button key={q} className="nx-qp"
                    onClick={() => setInput(q)}
                    disabled={disabled}
                    style={{
                      fontSize: 10, textAlign: 'left', padding: '6px 10px',
                      border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
                      color: C.muted, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
                      opacity: disabled ? 0.4 : 1, transition: 'all 0.12s',
                    }}>{q}</button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <input value={input}
                 onChange={e => setInput(e.target.value)}
                 onKeyDown={handleKey}
                 disabled={disabled}
                 placeholder={NEXUS_API_KEY ? 'Ask Nexus anything…' : 'Set NEXUS_API_KEY to chat'}
                 style={{
                   width: '100%', background: '#f1f5f9', border: 'none', borderRadius: 20,
                   padding: '9px 42px 9px 16px', fontSize: 12, color: C.charcoal,
                   fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                   opacity: !NEXUS_API_KEY ? 0.55 : 1,
                 }} />
          <button onClick={handleSend}
                  disabled={!input.trim() || disabled}
                  style={{
                    position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
                    width: 30, height: 30, borderRadius: '50%', background: C.red, border: 'none',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: !input.trim() || disabled ? 0.35 : 1,
                    transition: 'opacity 0.15s',
                  }}>
            <svg width="12" height="12" fill="none" stroke="#fff" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"
                    d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

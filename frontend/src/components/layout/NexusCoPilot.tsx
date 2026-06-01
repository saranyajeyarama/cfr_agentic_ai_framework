/**
 * NexusCoPilot — v2.3 AI chat panel.
 * Extracted from mars-supply-ai-v2_02-restyled.jsx (function NexusCoPilot).
 *
 * Phase 4.1 — wired to the backend /chat route via chatNexus().
 *
 *   - No client-side Gemini / Vertex credentials. The backend service
 *     account holds the Vertex AI auth. The frontend POSTs the user
 *     message + history to /chat and renders response.text.
 *   - Conversation history is held in component state and passed to
 *     every chatNexus() call so the backend can stitch it into the
 *     system prompt itself.
 *   - All the legacy NEXUS_API_KEY / generativelanguage.googleapis.com
 *     / buildNexusContext() machinery from the AI Studio source has
 *     been removed.
 *
 * Visual aesthetic preserved verbatim from the reference (inline styles,
 * red brand colour, bot avatar, quick prompts, animated dots).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PanelRightClose, PanelRightOpen, Bot } from 'lucide-react';
import { C } from '../../lib/constants';
import { chatNexus, ValidationError, BackendError, NetworkError } from '../../lib/api';
import type { ChatMessage } from '../../lib/types';

type ApiStatus = 'ready' | 'error';

const STATUS_DOT: Record<ApiStatus, string> = {
  ready: C.green,
  error: C.red,
};

const STATUS_LABEL: Record<ApiStatus, string> = {
  ready: 'Backend /chat · Ready',
  error: 'Backend /chat · Error',
};

const QUICK_PROMPTS = [
  'What should I prioritize right now?',
  'Summarize the highest-risk order in the queue',
  'Which orders have agent conflicts?',
];

const OPENING_MESSAGE: ChatMessage = {
  role: 'agent',
  text: 'Good morning. I have full visibility into your active orders, network status, and financial risk landscape. Ask me anything about the OpEx Tower — I have the same data the specialist agents do.',
};

export function NexusCoPilot() {
  const [col, setCol]       = useState(false);
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('ready');
  const [messages, setMessages]   = useState<ChatMessage[]>([OPENING_MESSAGE]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!col) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, col]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput('');

    // Snapshot the conversation BEFORE appending — chatNexus() will append
    // the new user message itself when building the request body.
    const historyBeforeSend = [...messages];

    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setLoading(true);

    try {
      const reply = await chatNexus(userText, historyBeforeSend);
      setMessages(prev => [...prev, { role: 'agent', text: reply }]);
      setApiStatus('ready');
    } catch (e) {
      let errMsg: string;
      if (e instanceof ValidationError) {
        errMsg = `⚠ Backend rejected the message (422). ${
          typeof e.detail === 'string' ? e.detail : 'Check the chat payload shape.'
        }`;
      } else if (e instanceof BackendError) {
        errMsg = `⚠ Backend error (HTTP ${e.status}). ${e.message}`;
      } else if (e instanceof NetworkError) {
        errMsg = '⚠ Could not reach the backend. Is the orchestrator container running?';
      } else {
        errMsg = `⚠ ${(e as Error)?.message ?? 'Chat failed for an unknown reason.'}`;
      }
      setMessages(prev => [...prev, { role: 'agent', text: errMsg }]);
      setApiStatus('error');
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const statusDot   = STATUS_DOT[apiStatus];
  const statusLabel = STATUS_LABEL[apiStatus];
  const disabled    = loading;

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
                 placeholder="Ask Nexus anything…"
                 style={{
                   width: '100%', background: '#f1f5f9', border: 'none', borderRadius: 20,
                   padding: '9px 42px 9px 16px', fontSize: 12, color: C.charcoal,
                   fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
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

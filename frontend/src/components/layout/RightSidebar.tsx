import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, PanelRightClose, PanelRightOpen, Loader2, Wifi, WifiOff, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DashboardData } from '../../types/dashboard';

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  role: 'agent' | 'user';
  text: string;
};

type HealthStatus = {
  status: 'ok' | 'error' | 'loading';
  provider?: string;
  providerName?: string;
};

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(data: DashboardData): string {
  return `You are Nexus, an AI Co-Pilot embedded in a supply chain operations workspace for a pet nutrition CPG company (Mars Pet Nutrition). You assist the Customer Supply Team in making faster, better-informed fulfillment decisions.

You have full visibility into today's operational state. Here is the live network data:

${JSON.stringify(data, null, 2)}

Answer questions concisely and always in the context of this data. Reference specific customers, SKUs, PO numbers, agents, financial figures, and risk amounts where relevant. If the user asks what to prioritize, lead with the highest financial risk items. If they ask about a specific customer or SKU, pull the relevant data directly. Never make up data that is not in the dataset above.

Format your responses clearly. Use bullet points for lists. Keep answers focused and actionable.`;
}

// ─── Provider Badge ───────────────────────────────────────────────────────────

function ProviderBadge({ health }: { health: HealthStatus }) {
  if (health.status === 'loading') {
    return (
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
        <Loader2 className="w-2.5 h-2.5 animate-spin" /> connecting…
      </span>
    );
  }
  if (health.status === 'error') {
    return (
      <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest flex items-center gap-1">
        <WifiOff className="w-2.5 h-2.5" /> backend offline
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1">
      <Wifi className="w-2.5 h-2.5" /> {health.providerName || health.provider}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RightSidebar({ data }: { data: DashboardData }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus>({ status: 'loading' });
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'agent',
      text: 'Good morning. Overnight, the <span class="font-bold text-[#DB033B]">Transportation Agent</span> flagged 2 high-risk OTIF delays, and the <span class="font-bold text-[#DB033B]">Customer Supply Agent</span> placed 4 above-forecast orders in your triage queue. Where would you like to start?'
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const systemPrompt = useRef<string>(buildSystemPrompt(data));

  // ── Health check on mount ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(data => setHealth({ status: 'ok', provider: data.provider, providerName: data.providerName }))
      .catch(() => setHealth({ status: 'error' }));
  }, []);

  // ── Scroll to bottom when messages change ─────────────────────────────────
  useEffect(() => {
    if (!isCollapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isCollapsed]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');

    const updatedMessages: Message[] = [...messages, { role: 'user', text: userText }];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          systemPrompt: systemPrompt.current,
          agentId: 'nexus'
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      setMessages(prev => [...prev, { role: 'agent', text: data.text }]);
    } catch (error: any) {
      const isBackendDown = error.message?.includes('fetch') || error.message?.includes('Failed');
      setMessages(prev => [
        ...prev,
        {
          role: 'agent',
          text: isBackendDown
            ? 'Cannot reach the backend server. Make sure you ran <code class="bg-slate-200 px-1 rounded font-mono text-slate-800">npm run dev</code> — it starts both the frontend and the API server.'
            : `Error: ${error.message}`
        }
      ]);
      setHealth(prev => isBackendDown ? { ...prev, status: 'error' } : prev);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickPrompt = (text: string) => {
    setInput(text);
    setTimeout(() => handleSend(), 0);
  };

  // ── Collapsed state ───────────────────────────────────────────────────────
  if (isCollapsed) {
    return (
      <aside className="w-16 border-l border-slate-200 bg-white flex flex-col shrink-0 z-20 transition-all duration-300">
        <div className="h-16 flex items-center justify-center border-b border-slate-100 shrink-0">
          <button
            onClick={() => setIsCollapsed(false)}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <PanelRightOpen className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center pt-6 gap-6 relative">
          <div className="relative group cursor-pointer" onClick={() => setIsCollapsed(false)}>
            <div className="w-10 h-10 bg-[#fef2f2] text-[#DB033B] rounded-full flex items-center justify-center relative shadow-sm border border-[#fef2f2]">
              <Bot className="w-5 h-5" />
              <div className={cn(
                "absolute top-0 right-0 w-3 h-3 border-2 border-white rounded-full",
                health.status === 'ok' ? 'bg-emerald-500' : health.status === 'error' ? 'bg-red-500' : 'bg-amber-400 animate-pulse'
              )} />
            </div>
            <div className="absolute right-full mr-4 top-1/2 -translate-y-1/2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none transition-opacity">
              Open Nexus — Mars AI Co-Pilot
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // ── Expanded state ────────────────────────────────────────────────────────
  return (
    <aside className="w-80 border-l border-slate-200 bg-white flex flex-col shrink-0 z-20 transition-all duration-300">

      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100 shrink-0">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              health.status === 'ok' ? 'bg-emerald-500' : health.status === 'error' ? 'bg-red-500' : 'bg-amber-400 animate-pulse'
            )} />
            <h3 className="text-sm font-bold text-slate-800">Nexus — Mars AI Co-Pilot</h3>
          </div>
          <ProviderBadge health={health} />
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100 ml-2 shrink-0"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Backend offline warning */}
      {health.status === 'error' && (
        <div className="mx-3 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700 leading-relaxed">
          <strong>Backend not running.</strong> In your terminal, run:
          <code className="block mt-1 bg-red-100 px-2 py-1 rounded font-mono text-red-800 text-[10px]">
            npm run dev
          </code>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.map((message, i) => (
          <div key={i} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`space-y-1 w-full flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={cn(
                  'p-3 text-xs leading-relaxed',
                  message.role === 'agent'
                    ? 'bg-slate-100 rounded-tr-xl rounded-bl-xl rounded-br-xl text-slate-700'
                    : 'bg-[#DB033B] rounded-tl-xl rounded-bl-xl rounded-br-xl text-white'
                )}
                dangerouslySetInnerHTML={{ __html: message.text }}
              />
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="p-3 text-xs leading-relaxed bg-slate-100 rounded-tr-xl rounded-bl-xl rounded-br-xl text-slate-700 flex items-center min-w-[60px]">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts + input */}
      <div className="p-4 border-t border-slate-100 bg-white">
        <div className="flex flex-col gap-2 mb-4">
          {[
            'Analyze Walmart OTIF risk ($45k)',
            'Review Target Triage Queue',
            'What are the top 3 risks today?'
          ].map(prompt => (
            <button
              key={prompt}
              onClick={() => setInput(prompt)}
              disabled={isLoading}
              className="text-[10px] text-left p-2 border border-slate-200 rounded-lg hover:border-[#DB033B] hover:bg-[#fef2f2] transition-colors text-slate-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="relative">
          <input
            type="text"
            className="w-full bg-slate-100 border-none rounded-full px-4 py-2.5 text-xs text-slate-800 placeholder:text-slate-500 focus:ring-2 focus:ring-[#DB033B] pr-10 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Ask Nexus anything..."
            value={input}
            disabled={isLoading}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center bg-[#DB033B] text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

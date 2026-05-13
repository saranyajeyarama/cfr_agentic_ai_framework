import React, { useState, useRef, useEffect } from 'react';
import { Bot, PanelRightClose, PanelRightOpen, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { GoogleGenAI } from '@google/genai';
import mockData from '../../data/mockData.json';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function RightSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'agent',
      text: 'Good morning. Overnight, the <span class="font-bold text-[#DB033B]">Transportation Agent</span> flagged 2 high-risk OTIF delays, and the <span class="font-bold text-[#DB033B]">Customer Supply Agent</span> placed 4 above-forecast orders in your triage queue. Where would you like to start?'
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    const systemPrompt = `You are Nexus, an AI Co-Pilot embedded in a supply chain operations workspace for a pet nutrition CPG company. You assist the Customer Supply Team in making faster, better-informed fulfillment decisions.

You have full visibility into today's operational state. Here is the live network data:

${JSON.stringify(mockData, null, 2)}

Answer questions concisely and always in the context of this data. Reference specific customers, SKUs, PO numbers, agents, financial figures, and risk amounts where relevant. If the user asks what to prioritize, lead with the highest financial risk items. If they ask about a specific customer or SKU, pull the relevant data directly. Never make up data that is not in the dataset above.`;

    const history = messages.map(m => ({
      role: m.role === 'agent' ? 'model' : 'user',
      parts: [{ text: m.text.replace(/<[^>]+>/g, '') }]
    }));

    try {
      const chat = ai.chats.create({
        model: 'gemini-2.0-flash',
        config: { systemInstruction: systemPrompt },
        history
      });

      const response = await chat.sendMessage({
        message: userMessage
      });

      setMessages(prev => [...prev, {
        role: 'agent',
        text: response.text
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'agent',
        text: 'I encountered an error accessing the network data. Please try again.'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  useEffect(() => {
    if (!isCollapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isCollapsed]);
  
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
              <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 border-2 border-white rounded-full"></div>
            </div>
            <div className="absolute right-full mr-4 top-1/2 -translate-y-1/2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none transition-opacity">
              Open Nexus — Mars AI Co-Pilot
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 border-l border-slate-200 bg-white flex flex-col shrink-0 z-20 transition-all duration-300">
      <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-[#DB033B] rounded-full animate-pulse"></div>
          <h3 className="text-sm font-bold text-slate-800">Nexus — Mars AI Co-Pilot</h3>
        </div>
        <button 
          onClick={() => setIsCollapsed(true)}
          className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.map((message, i) => (
          <div key={i} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`space-y-1 w-full flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div 
                className={`p-3 text-xs leading-relaxed ${
                  message.role === 'agent' 
                    ? 'bg-slate-100 rounded-tr-xl rounded-bl-xl rounded-br-xl text-slate-700' 
                    : 'bg-[#DB033B] rounded-tl-xl rounded-bl-xl rounded-br-xl text-white'
                }`}
                dangerouslySetInnerHTML={{ __html: message.text }}
              />
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="space-y-1 w-full flex flex-col items-start">
              <div className="p-3 text-xs leading-relaxed bg-slate-100 rounded-tr-xl rounded-bl-xl rounded-br-xl text-slate-700 flex items-center justify-center min-w-[60px]">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-slate-100 bg-white">
        <div className="flex flex-col gap-2 mb-4">
          <button 
            onClick={() => setInput('Analyze Walmart OTIF risk ($45k)')}
            disabled={isLoading}
            className="text-[10px] text-left p-2 border border-slate-200 rounded-lg hover:border-[#DB033B] hover:bg-[#fef2f2] transition-colors text-slate-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            Analyze Walmart OTIF risk ($45k)
          </button>
          <button 
            onClick={() => setInput('Review Target Triage Queue')}
            disabled={isLoading}
            className="text-[10px] text-left p-2 border border-slate-200 rounded-lg hover:border-[#DB033B] hover:bg-[#fef2f2] transition-colors text-slate-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            Review Target Triage Queue
          </button>
        </div>
        <div className="relative">
          <input
            type="text"
            className="w-full bg-slate-100 border-none rounded-full px-4 py-2.5 text-xs text-slate-800 placeholder:text-slate-500 focus:ring-2 focus:ring-[#DB033B] pr-10 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Ask Nexus anything..."
            value={input}
            disabled={isLoading}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center bg-[#DB033B] text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
          </button>
        </div>
      </div>
    </aside>
  );
}


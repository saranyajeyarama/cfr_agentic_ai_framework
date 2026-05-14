/**
 * OpEx Tower — Local Backend Server
 *
 * Provides a provider-agnostic AI backend so the frontend never touches an API
 * key directly. Switch between Gemini, Claude, or Resilience agents by changing
 * AI_PROVIDER in your .env.local file.
 *
 * Endpoints:
 *   GET  /api/health   — liveness check, returns active provider info
 *   GET  /api/agents   — list configured agents and their status
 *   POST /api/chat     — main chat endpoint (provider-agnostic)
 */

import express from 'express';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Load .env.local first (takes priority), then fall back to .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3001;
const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

// ─── Utility ──────────────────────────────────────────────────────────────────

function stripHtml(str = '') {
  return str.replace(/<[^>]+>/g, '');
}

// ─── Provider: Gemini ─────────────────────────────────────────────────────────

class GeminiProvider {
  get id() { return 'gemini'; }
  get name() { return 'Gemini 2.0 Flash'; }

  async chat(messages, systemPrompt) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set. Add it to .env.local');
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Build history from all messages except the last (which is the new user message)
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'agent' ? 'model' : 'user',
      parts: [{ text: stripHtml(m.text) }]
    }));

    const lastMessage = messages[messages.length - 1];

    const chat = ai.chats.create({
      model: 'gemini-2.0-flash',
      config: { systemInstruction: systemPrompt },
      history
    });

    const response = await chat.sendMessage({ message: stripHtml(lastMessage.text) });
    return response.text;
  }
}

// ─── Provider: Claude (Anthropic) ────────────────────────────────────────────

class ClaudeProvider {
  get id() { return 'claude'; }
  get name() { return 'Claude (Anthropic)'; }

  async chat(messages, systemPrompt) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local');
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Claude requires messages to alternate user/assistant and start with user
    const formatted = messages.map(m => ({
      role: m.role === 'agent' ? 'assistant' : 'user',
      content: stripHtml(m.text)
    }));

    // Ensure conversation starts with a user message
    const cleanMessages = formatted[0]?.role === 'user'
      ? formatted
      : [{ role: 'user', content: '(start of conversation)' }, ...formatted];

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: cleanMessages
    });

    return response.content[0].text;
  }
}

// ─── Provider: Resilience Agents ─────────────────────────────────────────────
//
// This is the integration point for the Resilience agent architecture.
// When your agents are ready:
//   1. Set RESILIENCE_AGENT_URL in .env.local
//   2. Set RESILIENCE_AGENT_TOKEN if your API requires auth
//   3. Adjust the request/response shape below to match your agent API contract
//   4. Set AI_PROVIDER=resilience in .env.local

class ResilienceProvider {
  get id() { return 'resilience'; }
  get name() { return 'Resilience Agent Network'; }

  async chat(messages, systemPrompt, agentId = 'nexus') {
    const url = process.env.RESILIENCE_AGENT_URL;
    if (!url) {
      throw new Error(
        'RESILIENCE_AGENT_URL is not set. Add it to .env.local.\n' +
        'Example: RESILIENCE_AGENT_URL=http://localhost:8080'
      );
    }

    // ── TODO: Adjust this to match your Resilience agent API contract ─────────
    const requestBody = {
      agent_id: agentId,
      messages: messages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : 'user',
        content: stripHtml(m.text)
      })),
      system_prompt: systemPrompt,
      context: {
        source: 'opextower',
        version: '1.0.0'
      }
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    if (process.env.RESILIENCE_AGENT_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.RESILIENCE_AGENT_TOKEN}`;
    }

    const response = await fetch(`${url}/agents/${agentId}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Resilience agent returned ${response.status}: ${body || response.statusText}`
      );
    }

    const data = await response.json();

    // ── TODO: Adjust this to match your Resilience agent response shape ───────
    //    Common response shapes to try: data.text | data.message | data.content?.[0]?.text
    const text = data.text ?? data.message ?? data.content?.[0]?.text ?? data.response;

    if (!text) {
      throw new Error(
        `Resilience agent returned an unrecognized response shape: ${JSON.stringify(data)}`
      );
    }

    return text;
  }
}

// ─── Provider Registry ────────────────────────────────────────────────────────

const PROVIDERS = {
  gemini: GeminiProvider,
  claude: ClaudeProvider,
  resilience: ResilienceProvider
};

function getProvider() {
  const ProviderClass = PROVIDERS[AI_PROVIDER];
  if (!ProviderClass) {
    throw new Error(
      `Unknown AI_PROVIDER: "${AI_PROVIDER}". Valid values: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return new ProviderClass();
}

// ─── Named Agents ─────────────────────────────────────────────────────────────
//
// These are the agents referenced in the OpEx Tower UI. Currently Nexus is
// fully wired. The others are stubs ready to be connected to Resilience.
//
// To wire a Resilience agent:
//   1. Set AI_PROVIDER=resilience in .env.local
//   2. The ResilienceProvider will route by agentId automatically
//   3. Update the status field below when live

const AGENTS = [
  {
    id: 'nexus',
    name: 'Nexus — Mars AI Co-Pilot',
    description: 'Primary supply chain ops assistant with full network visibility.',
    status: 'active',
    capabilities: ['chat', 'data-analysis', 'recommendations']
  },
  {
    id: 'transportation',
    name: 'Transportation Agent',
    description: 'Monitors carrier performance, OTIF risk, and freight optimization.',
    status: 'stub',  // TODO: Wire to Resilience — update status to 'active' when ready
    capabilities: ['otif-monitoring', 'freight-optimization', 'carrier-scoring']
  },
  {
    id: 'customer-supply',
    name: 'Customer Supply Agent',
    description: 'Monitors above-forecast orders and customer allocation risk.',
    status: 'stub',  // TODO: Wire to Resilience — update status to 'active' when ready
    capabilities: ['demand-sensing', 'allocation-guardrails', 'order-triage']
  },
  {
    id: 'retail-intelligence',
    name: 'Retail Intelligence Agent',
    description: 'Tracks retailer rulebooks, MRSL, shelf-life compliance.',
    status: 'stub',  // TODO: Wire to Resilience
    capabilities: ['mrsl-monitoring', 'retailer-compliance', 'penalty-avoidance']
  },
  {
    id: 'supply-planning',
    name: 'Supply Planning Agent',
    description: 'Plant adherence, production scheduling, safety stock optimization.',
    status: 'stub',  // TODO: Wire to Resilience
    capabilities: ['production-monitoring', 'safety-stock', 'capacity-planning']
  }
];

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  let providerName = 'unknown';
  try { providerName = getProvider().name; } catch (_) {}

  res.json({
    status: 'ok',
    provider: AI_PROVIDER,
    providerName,
    agentCount: AGENTS.length,
    activeAgents: AGENTS.filter(a => a.status === 'active').map(a => a.id),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/agents', (req, res) => {
  res.json({
    agents: AGENTS,
    activeProvider: AI_PROVIDER,
    providerName: getProvider().name
  });
});

app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt, agentId = 'nexus' } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required and must not be empty' });
  }

  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) {
    return res.status(400).json({
      error: `Unknown agentId: "${agentId}"`,
      validAgents: AGENTS.map(a => a.id)
    });
  }

  try {
    const provider = getProvider();
    console.log(`[OpEx Tower] Chat request → agent: ${agentId}, provider: ${provider.id}, messages: ${messages.length}`);

    const text = await provider.chat(messages, systemPrompt, agentId);

    res.json({
      text,
      provider: provider.id,
      agentId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[OpEx Tower] Chat error (provider: ${AI_PROVIDER}):`, error.message);
    res.status(500).json({
      error: error.message,
      provider: AI_PROVIDER,
      hint: getConfigHint()
    });
  }
});

// ─── Config Hints ─────────────────────────────────────────────────────────────

function getConfigHint() {
  switch (AI_PROVIDER) {
    case 'gemini':
      return 'Ensure GEMINI_API_KEY is set in .env.local — get one at aistudio.google.com/apikey';
    case 'claude':
      return 'Ensure ANTHROPIC_API_KEY is set in .env.local — get one at console.anthropic.com';
    case 'resilience':
      return 'Ensure RESILIENCE_AGENT_URL is set in .env.local and the agent service is running';
    default:
      return `Check that AI_PROVIDER is one of: ${Object.keys(PROVIDERS).join(', ')}`;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

let providerName = 'unknown';
try { providerName = getProvider().name; } catch (e) {
  console.warn(`[OpEx Tower] Warning: ${e.message}`);
}

app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       OpEx Tower — Backend Server      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n  URL:      http://localhost:${PORT}`);
  console.log(`  Provider: ${AI_PROVIDER} (${providerName})`);
  console.log(`  Agents:   ${AGENTS.length} configured (${AGENTS.filter(a => a.status === 'active').length} active)\n`);
  console.log('  To switch providers, set AI_PROVIDER in .env.local:');
  console.log('    AI_PROVIDER=gemini      → Google Gemini 2.0 Flash');
  console.log('    AI_PROVIDER=claude      → Anthropic Claude Sonnet');
  console.log('    AI_PROVIDER=resilience  → Resilience Agent Network\n');
});

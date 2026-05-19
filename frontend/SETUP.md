# OpEx Tower — Local Setup Guide

## Quick Start (2 minutes)

### 1. Install dependencies
```bash
npm install
```

### 2. Create your environment file
```bash
cp .env.example .env.local
```

Open `.env.local` and add your API key. The default provider is Gemini:
```
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

> Get a free Gemini key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### 3. Run the app
```bash
npm run dev
```

This starts **both** servers simultaneously:
- **Frontend** → http://localhost:3000
- **API backend** → http://localhost:3001

Open http://localhost:3000 in your browser. The Nexus co-pilot panel on the right should show a green dot and the provider name when the backend is connected.

---

## Switching AI Providers

Change `AI_PROVIDER` in `.env.local` and restart with `npm run dev`.

| Provider | AI_PROVIDER value | Key needed |
|---|---|---|
| Google Gemini (default) | `gemini` | `GEMINI_API_KEY` |
| Anthropic Claude | `claude` | `ANTHROPIC_API_KEY` |
| Resilience Agents | `resilience` | `RESILIENCE_AGENT_URL` |

---

## Resilience Agent Integration

When your Resilience agents are ready:

1. Set in `.env.local`:
   ```
   AI_PROVIDER=resilience
   RESILIENCE_AGENT_URL=http://your-resilience-service:8080
   RESILIENCE_AGENT_TOKEN=your_token_if_needed
   ```

2. In `server.js`, update the `ResilienceProvider.chat()` method:
   - **Request shape** (~line 110): match your agent's API contract
   - **Response shape** (~line 130): map `data.yourField` to the returned text

3. Update the `AGENTS` array in `server.js` to set `status: 'active'` for wired agents.

That's it. The frontend is already written to handle multiple agents — no UI changes needed.

---

## Architecture Overview

```
Browser (localhost:3000)
    │
    │  /api/* requests
    ▼
Vite dev proxy
    │
    ▼
Express backend (localhost:3001)   ← server.js
    │
    ├── GeminiProvider             ← @google/genai
    ├── ClaudeProvider             ← @anthropic-ai/sdk
    └── ResilienceProvider         ← fetch() to your agent URL
```

**API keys live only in the backend.** They are never in the browser bundle.

---

## Troubleshooting

**Nexus says "backend not running"**  
→ Make sure you ran `npm run dev` (not `npm run dev:ui`)

**"GEMINI_API_KEY is not set"**  
→ Check your `.env.local` file exists and has the key

**Chat errors with provider X**  
→ Check the terminal running the API server for detailed error logs

**Port conflicts**  
→ Change `PORT=3001` in `.env.local` — Vite picks it up automatically

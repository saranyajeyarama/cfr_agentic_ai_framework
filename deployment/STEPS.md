# Deployment Steps — CFR Agentic AI

The complete runbook: deploy on **Local / GCP / Databricks**, run over a client's own data
(Option B), and **switch the LLM provider** (Gemini → OpenAI / Anthropic / others). Run commands
from the **repo root** unless noted.

---

## Prerequisites
| Target | Needs |
|---|---|
| All | Python 3.10+, this package, access to the target platform |
| Local | Docker Desktop running |
| GCP | `gcloud` authenticated; SA with BigQuery *Data Viewer* (Silver) + *Data Editor* (decisions) + *Job User* + *Vertex AI User* |
| Databricks | `databricks` CLI; a SQL warehouse; a PAT in `DATABRICKS_TOKEN` |
| Non-Gemini LLM | the provider API key in env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) |

Everything platform-specific lives in **`deployment/config/<platform>/`**; the deploy entry point is
**`deployment/scripts/driver.py`** (or `driver.sh`).

---

## The 5 steps

### 1 — Pick the platform
```bash
export DEPLOY_PLATFORM=gcp          # or: databricks | local
```
*Selects which `deployment/config/<platform>/` the driver loads.*

### 2 — Configure
Edit `deployment/config/<platform>/silver.config.json` (where the data lives):
- **GCP:** `project`, `semantic_ds`, `decisions_ds` (defaults already point at the reference project).
- **Databricks:** replace `<...>` — `host`, `sql_warehouse_id`, `catalog`.

*The app only reads `{SEMANTIC_DS}.<view>.<column>`; this file sets that target.*

### 3 — Map the client's data → virtual views *(only if their schema differs — else skip)*
An agent maps the client's tables onto our standard schema and creates rename-only **virtual views**.
```bash
# a) Introspect (no LLM, read-only) — see what's there:
py deployment/scripts/run_schema_mapping.py --platform gcp --source <proj.client_raw> --introspect-only
# b) Propose (agent maps → standard schema; writes proposal.json + mapping_worksheet.md, then STOPS):
py deployment/scripts/run_schema_mapping.py --platform gcp --source <proj.client_raw>
# c) Resolve: open schema_mapping_out/mapping_worksheet.md, confirm/fix the ambiguous + unmapped rows,
#    add corrected entries to proposal.json `mapped[]`.   (Nothing is invented — the agent never guesses.)
# d) Apply (create the views; preview first with --dry-run):
py deployment/scripts/run_schema_mapping.py --platform gcp --source <proj.client_raw> --apply --dry-run
py deployment/scripts/run_schema_mapping.py --platform gcp --source <proj.client_raw> --apply
```
Then point the app at the mapped dataset via `SEMANTIC_DS` (or `silver.config.json`). On Databricks use
`--platform databricks --source <catalog>.client_raw`.

### 4 — Deploy (one command → live URL)
```bash
py deployment/scripts/driver.py --platform local      --smoke   # → http://localhost:3001
py deployment/scripts/driver.py --platform gcp        --smoke   # wraps deploy.sh → Cloud Run URL
py deployment/scripts/driver.py --platform databricks           # bundle + apps → App URL
```
Add `--dry-run` to print the resolved config + commands without executing. The driver runs the mapping
inline with `--map --source <...>` (add `--map-apply` to create views).

### 5 — Verify
`--smoke` (or check manually) hits:
```
GET <url>/healthz             → 200
GET <url>/api/health          → 200
GET <url>/api/data-dictionary → 200 with non-empty "views"   # data binding resolved ✓
```

---

## Switching the LLM provider (Gemini → OpenAI / Anthropic / …)

**Default is Gemini (Vertex) — no keys, no change needed.** To use another provider, set env vars only
(no code edits). One factory (`model_provider.py`) routes every agent and the direct chat/recommend calls.

```bash
# Use OpenAI for everything:
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export LLM_MODEL_DEFAULT=gpt-4o            # optional; else provider default applies

# Use Anthropic:
export LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
export LLM_MODEL_DEFAULT=claude-3-5-sonnet

# Mix per agent (overrides win over the global default):
export LLM_MODEL_CUSTOMER_SUPPLY=gpt-4o
export LLM_MODEL_SUPPLY_PLANNING=gpt-4o-mini
export LLM_TEMP_CUSTOMER_SUPPLY=0.2        # optional per-agent temperature
```

- **Knobs:** `LLM_PROVIDER` · `LLM_MODEL_DEFAULT` · `LLM_MODEL_<AGENT>` · `LLM_TEMP_<AGENT>`.
  Agent names: `customer_supply`, `supply_planning`, `demand_planning`, `transportation`,
  `retail_intelligence`, `fulfillment`, `schema_mapping`, plus the direct calls `chat`, `fulfillment_recommend`.
- **Model ids:** bare (e.g. `gpt-4o` — auto-prefixed with the provider) or explicit (`openai/gpt-4o`).
- **Mechanism:** non-Gemini providers go through ADK's **LiteLlm** wrapper (one dependency, ~100 providers).
- **Cost tracking:** FinOps prices exist for `gpt-4o(/mini)` and `claude-3-5-sonnet/haiku`; tune
  `MODEL_PRICES` in `data_pipeline.py` to your contract.
- Set these in `deployment/config/<platform>/env.<platform>` (or `--set-env-vars` on Cloud Run / the
  Databricks app) so they ship with the deploy.

### Prerequisite — `litellm` must be in the image
Non-Gemini providers go through `litellm`, which is installed **non-fatally** in `backend/Dockerfile` (so a
Gemini build can never break on it). To actually use OpenAI/Anthropic it must be present:
- After building, check the build log. If you see `WARN: litellm not installed under current pins`, litellm did
  **not** install — Gemini still works, but non-Gemini providers won't until you fix it.
- To require it: add `litellm>=1.40,<2.0` to `backend/code/orchestrator_service/requirements.txt` and rebuild
  (resolve any pip conflict, e.g. pin a specific litellm version).

### Where to set it
- **Local (docker compose):** add `LLM_PROVIDER`, `OPENAI_API_KEY` (+ optional `LLM_MODEL_*`) to the backend
  `environment:` block in `docker-compose.yml`, then `docker compose up --build`.
- **GCP (deploy scripts):** export them before running — the pass-through is wired into `deploy.sh` and
  `deploy-gcp.sh`:
  ```bash
  LLM_PROVIDER=openai OPENAI_API_KEY=sk-... LLM_MODEL_DEFAULT=gpt-4o bash deploy-gcp.sh
  ```

### Verify + production
- **Verify:** `curl <url>/api/health` → `"provider": "openai"`, then run an Order Triage.
- **Production keys:** on Cloud Run use **Secret Manager**, not plaintext env —
  `--set-secrets=OPENAI_API_KEY=openai-api-key:latest` (never put the key in the deploy command or substitutions).

---

## Copy-paste quickstarts
```bash
# LOCAL (fastest URL)
py deployment/scripts/driver.py --platform local --smoke

# GCP
gcloud auth login
py deployment/scripts/driver.py --platform gcp --smoke

# DATABRICKS
databricks configure --token
py deployment/scripts/driver.py --platform databricks
```

## Regenerate the standard contract
```bash
py deployment/scripts/gen_data_model.py     # rewrites deployment/data-model.md from the live schema
```

## Adding a new platform (AWS / Azure native) — 3 pieces, no app rewrite
1. `deployment/config/<platform>/silver.config.json` — the data binding.
2. `backend/code/platform_adapters/<platform>_adapter.py` — implement the 5-method `CatalogAdapter` and
   register it in `get_adapter()`.
3. A deploy branch in `deployment/scripts/driver.py`.
The 5 steps above stay identical.

## Status / notes
- **GCP** end-to-end today. **Databricks**: mapping + view creation work; the app's read-path against
  Unity Catalog is **Milestone B** (the seam is in place).
- Gemini stays the default everywhere, so deployments work with no provider keys until you opt in.

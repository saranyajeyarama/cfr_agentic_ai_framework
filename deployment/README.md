# deployment/ — CFR Agentic AI deployment package

One place for everything needed to deploy the app on **GCP / Databricks / Local**, run it over a
client's own data (**Option B** dynamic mapping), and **switch the LLM provider** by env var.

> **Start here:** [`STEPS.md`](STEPS.md) — the full runbook (5 steps + Step-3 detail + the LLM switch).

## What's in this folder
```
deployment/
  STEPS.md                 # ← the runbook (read this)
  README.md                # this index
  data-model.md            # the standard Silver-layer contract (generated; the mapping target)
  config/
    platform.env.example   # every env knob, incl. the LLM_* vars
    gcp/        silver.config.json · env.gcp · deploy.config.json
    databricks/ silver.config.json · env.databricks · databricks.app.yaml · databricks.bundle.yml
  scripts/
    driver.py · driver.sh        # platform-selectable deploy → live URL
    run_schema_mapping.py        # Option-B mapping runner (introspect → propose → gate → apply)
    gen_data_model.py            # regenerates data-model.md from the live schema
  docs/                    # proposal deck, one-pager, guide, workflow, context (html/pdf/png)
```

## What is NOT here (and why)
The modules the **running app imports** stay in `backend/code/` so they sit on the container's flat
`/app` path:
- `backend/code/orchestrator_service/silver_target.py` — the data seam (`SEMANTIC_DS`/`DECISIONS_DS`).
- `backend/code/orchestrator_service/model_provider.py` — the env-driven LLM provider factory.
- `backend/code/platform_adapters/` + `backend/code/mapping_tools.py` — Option-B introspection/mapping.

The Dockerfile COPYs these into the image; `deploy.sh` / `docker-compose.yml` / `cloudbuild.yaml`
remain at the repo root (the driver wraps them).

## One-liners
```bash
py deployment/scripts/driver.py --platform local --smoke      # local URL in minutes
py deployment/scripts/driver.py --platform gcp --dry-run      # preview the GCP deploy
LLM_PROVIDER=openai OPENAI_API_KEY=sk-... py deployment/scripts/driver.py --platform local   # use OpenAI
```

## Status
GCP end-to-end · Databricks mapping+views done (app read-path = Milestone B) · AWS/Azure = config + one
adapter + one driver branch. Gemini is the default LLM; other providers are env-only opt-in.

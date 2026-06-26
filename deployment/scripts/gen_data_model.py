#!/usr/bin/env python3
"""Generate `data-model.md` — the authoritative standard Silver-layer contract.

This is the `data-model.md` that DEPLOY.md expects. It is GENERATED, not hand
written, so it never drifts from the live schema: the per-view column dictionary
is pulled from the same `fetch_data_dictionary()` that powers GET /data-dictionary
(live BigQuery INFORMATION_SCHEMA + curated SAP lineage + glossary). The narrative
sections (contract, fact-area grouping, conventions) are templated here.

Usage (from the repo root):
    py tools/gen_data_model.py            # writes ./data-model.md
    py tools/gen_data_model.py --out X.md # custom output path

It reuses the app's own code (single source of truth):
    data_pipeline.fetch_data_dictionary()  -> {totalViews, totalColumns, views[], glossary}

The Option-B schema-mapping agent maps a client's discovered schema onto THIS
contract (view names + column names), so identical names mean the app consumes
the mapped virtual views with zero code change.
"""
import argparse
import json
import os
import sys

_THIS = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_THIS))   # deployment/scripts -> repo root
_CODE = os.path.join(_ROOT, "backend", "code")
_PKG = os.path.dirname(_THIS)                      # the deployment/ folder
_OS = os.path.join(_CODE, "orchestrator_service")
sys.path.insert(0, _OS)
sys.path.insert(0, _CODE)

# Default the SA key for local generation (Cloud Run / CI uses ADC instead).
_SA_KEY = os.path.join(_ROOT, "backend", "resilience-riskradar-2c010597a83b.json")
if os.path.exists(_SA_KEY):
    os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", _SA_KEY)

_GLOSSARY_JSON = os.path.join(_OS, "config", "glossary.json")

# Fact-area buckets (CDM domains, per backend/reference/cdm_domain_mapping_v2.md).
# Views are matched by keyword against their name; dims are handled separately.
_FACT_AREAS = [
    ("Sales, Orders & Customer Service",
     ["sales_order", "delivery", "deliveries", "otif", "chargeback", "edi", "order"]),
    ("Inventory & Fulfilment",
     ["inventory", "fulfilment", "fulfillment", "stock"]),
    ("Supply & Production",
     ["production", "bill_of_material", "bills_of_material", "bom", "supply"]),
    ("Procurement (Procure-to-Pay)",
     ["procurement", "purchase", "purchasing", "vendor_", "goods_receipt"]),
    ("Forecast & Demand Planning",
     ["forecast", "demand", "promo", "consensus"]),
    ("Logistics & Transportation",
     ["shipment", "carrier", "lane", "transport", "freight"]),
    ("Retail Signals (v3 — may be absent)",
     ["retail", "store", "pos", "syndicated"]),
]

# Views known to be v3-deferred (optional coverage; absence is expected, not an error).
_V3_HINTS = ["retail", "store", "pos", "syndicated", "promotion"]


def _bucket_for(view_name: str) -> str:
    n = view_name.lower()
    for label, keys in _FACT_AREAS:
        if any(k in n for k in keys):
            return label
    return "Other fact areas"


def _is_dim(view_name: str) -> bool:
    return view_name.lower().startswith("dim_")


def _col_row(c: dict) -> str:
    nn = "" if c.get("nullable", True) else "NOT NULL"
    lin = " / ".join(x for x in (c.get("sourceTable"), c.get("sourceField"),
                                 c.get("infoObject")) if x) or "—"
    desc = (c.get("description") or "—").replace("|", "\\|").replace("\n", " ")
    return (f"| `{c.get('name','')}` | {c.get('dataType','')} | "
            f"{c.get('classification','')} | {nn} | {desc} | {lin} ({c.get('lineageSource','')}) |")


def _view_block(v: dict) -> str:
    lines = [f"#### `{v['name']}`  —  grain: {v.get('grainHint') or '—'}  ·  {v.get('columnCount',0)} cols",
             "",
             "| column | type | class | null | description | lineage (src) |",
             "|---|---|---|---|---|---|"]
    for c in sorted(v.get("columns", []), key=lambda x: x.get("ordinal") or 0):
        lines.append(_col_row(c))
    lines.append("")
    return "\n".join(lines)


def _glossary_md() -> str:
    try:
        with open(_GLOSSARY_JSON, "r", encoding="utf-8") as fh:
            g = json.load(fh)
    except Exception:
        return "_(glossary.json not found at generation time)_\n"
    rows = ["| term | full | definition |", "|---|---|---|"]

    def _safe(s) -> str:
        return str(s or "").replace("|", "\\|").replace("\n", " ").strip()

    def emit(term, full, definition):
        t = _safe(term)
        if t:
            rows.append(f"| **{t}** | {_safe(full)} | {_safe(definition)} |")

    if isinstance(g, list):
        # List of sections: [{section, terms:[{term, full, def}]}]
        for section in g:
            if isinstance(section, dict):
                for t in section.get("terms", []):
                    if isinstance(t, dict):
                        emit(t.get("term"), t.get("full"),
                             t.get("def") or t.get("definition") or t.get("description"))
    elif isinstance(g, dict):
        for term in sorted(g.keys()):
            val = g[term]
            if isinstance(val, dict):
                emit(term, val.get("full"),
                     val.get("def") or val.get("definition") or val.get("description"))
            else:
                emit(term, "", val)
    return "\n".join(rows) + "\n"


def render(dd: dict, generated_at: str) -> str:
    views = dd.get("views", [])
    dims = [v for v in views if _is_dim(v["name"])]
    facts = [v for v in views if not _is_dim(v["name"])]

    out = []
    out.append("# data-model.md — Standard Silver-Layer Contract")
    out.append("")
    out.append("> **Generated** by `tools/gen_data_model.py` from the live schema "
               "(`fetch_data_dictionary()` → BigQuery INFORMATION_SCHEMA + curated SAP "
               "lineage + glossary). Do not hand-edit — re-run the generator.")
    out.append(f"> Generated at: {generated_at}")
    out.append("")
    out.append("## 1. Contract & binding rule")
    out.append("")
    out.append("This is the platform-agnostic **Silver-layer contract**. Any deployment must expose "
               "these **view names** and **column names** (or a documented superset) so the app reads "
               "them unchanged. The app references only `{SEMANTIC_DS}.<view>.<column>`; `SEMANTIC_DS` "
               "is resolved at runtime (see `silver_target.py`), so a virtual Silver layer with identical "
               "names is consumed transparently.")
    out.append("")
    out.append("**Option B (custom mapping):** the schema-mapping agent maps a client's discovered "
               "schema onto this contract and emits virtual views named exactly as below. Ambiguous or "
               "unmapped required columns are surfaced for human approval — never invented (DEPLOY.md §5).")
    out.append("")
    out.append(f"**Scale:** {dd.get('totalViews', 0)} views · {dd.get('totalColumns', 0)} columns · "
               f"{len(dims)} dimensions · {len(facts)} fact/other views.")
    out.append("")
    out.append("## 2. Dimensions")
    out.append("")
    out.append("| dimension | grain (key) | cols |")
    out.append("|---|---|---|")
    for v in sorted(dims, key=lambda x: x["name"]):
        out.append(f"| `{v['name']}` | {v.get('grainHint') or '—'} | {v.get('columnCount',0)} |")
    out.append("")
    out.append("## 3. Fact areas (CDM domains)")
    out.append("")
    buckets: dict = {}
    for v in facts:
        buckets.setdefault(_bucket_for(v["name"]), []).append(v["name"])
    for label, _keys in _FACT_AREAS + [("Other fact areas", [])]:
        if label in buckets:
            names = ", ".join(f"`{n}`" for n in sorted(buckets[label]))
            out.append(f"- **{label}** — {names}")
    out.append("")
    out.append("## 4. Per-view column dictionary")
    out.append("")
    out.append("Classification: `key` (grain/identifier) · `measure` (numeric) · `date` · `dimension` "
               "(descriptive). Lineage: source table / field / BW InfoObject, with origin "
               "(`ddl` = from the view's own DDL, `curated` = SAP-standard fallback, `derived` = inferred).")
    out.append("")
    for v in sorted(views, key=lambda x: ("" if _is_dim(x["name"]) else "z", x["name"])):
        out.append(_view_block(v))
    out.append("## 5. Key conventions")
    out.append("")
    out.append("- `sold_to` = SAP customer (KUNNR); `material_number` = SAP material (MATNR, FERT level).")
    out.append("- `material_zrep_number` / `zrep_parent_material` = ZREP planning parent — the join key "
               "for forecast/DRP (resolve FERT→ZREP via `dim_material`).")
    out.append("- `plant_code` = SAP plant (WERKS); `vendor_number` = LIFNR.")
    out.append("- Quantities are in **cases (CS)** unless a `*_uom` column says otherwise.")
    out.append("- Boolean-like flags are `'Y'`/`'N'` strings (e.g. `otif_flag`, `on_time_flag`).")
    out.append("- 'Open' order = `rejection_reason IS NULL` (no status column).")
    out.append("")
    out.append("## 6. Business glossary")
    out.append("")
    out.append(_glossary_md())
    out.append("## 7. Write layer (decisions)")
    out.append("")
    out.append("Agent decisions/audit are written to a **separate** dataset (`DECISIONS_DS`, default "
               "`<project>.tiger_decisions`): `fct_allocation_decisions`, `fct_fulfillment_plan`, and the "
               "case/finops log tables. A client deployment must provision a writable decisions dataset; "
               "it is NOT mapped from client sources (it is the app's own output).")
    out.append("")
    out.append("## 8. Required vs v3-deferred")
    out.append("")
    v3 = sorted([v["name"] for v in views if any(h in v["name"].lower() for h in _V3_HINTS)])
    out.append("All dimensions + the Sales/Inventory/Supply/Procurement/Forecast/Logistics fact areas are "
               "**required**. The following are **v3-deferred** — absence is expected, not an error:")
    out.append("")
    out.append(", ".join(f"`{n}`" for n in v3) if v3 else "_(none detected)_")
    out.append("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(_PKG, "data-model.md"))
    ap.add_argument("--generated-at", default="(unstamped)")
    args = ap.parse_args()

    from data_pipeline import fetch_data_dictionary
    dd = fetch_data_dictionary()
    if not dd.get("views"):
        print("ERROR: fetch_data_dictionary returned no views — check BigQuery access / SEMANTIC_DS.",
              file=sys.stderr)
        return 2
    md = render(dd, args.generated_at)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(md)
    print(f"Wrote {args.out}: {dd.get('totalViews')} views, {dd.get('totalColumns')} columns.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

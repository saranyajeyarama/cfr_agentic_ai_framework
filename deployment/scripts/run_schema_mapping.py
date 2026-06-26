#!/usr/bin/env python3
"""Deploy-time runner for the dynamic Silver-layer mapping (DEPLOY.md Option B).

Pipeline:  introspect -> profile -> propose (LLM) -> human resolution gate -> apply

  py tools/run_schema_mapping.py --platform gcp --source <proj.client_raw>
        # introspect + run the schema-mapping agent, write proposal.json +
        # mapping_worksheet.md, then STOP for human review.
  py tools/run_schema_mapping.py --platform gcp --source <proj.client_raw> --introspect-only
        # introspect only (no LLM, no creds beyond read) — host-runnable.
  py tools/run_schema_mapping.py --platform gcp --source <proj.client_raw> --apply [--dry-run]
        # build virtual-view DDL from the APPROVED proposal.json mapped[] and
        # (unless --dry-run) execute it against the Silver target.

DEPLOY.md guardrails enforced here:
  - never invents mappings (mapping_tools.flag_ambiguities backstops the LLM);
  - ambiguous / unmapped-required columns BLOCK apply until a human resolves them
    (edit proposal.json mapped[] then re-run with --apply).

ADK / Vertex imports are lazy (only the propose path needs them), so this module
imports on the host and --introspect-only runs without google-adk installed.
"""
import argparse
import json
import os
import sys
import uuid

_THIS = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_THIS))   # deployment/scripts -> repo root
_CODE = os.path.join(_ROOT, "backend", "code")
_OS = os.path.join(_CODE, "orchestrator_service")
sys.path.insert(0, _OS)
sys.path.insert(0, _CODE)

_SA_KEY = os.path.join(_ROOT, "backend", "resilience-riskradar-2c010597a83b.json")
if os.path.exists(_SA_KEY):
    os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", _SA_KEY)

import platform_adapters as pa       # noqa: E402  (host-ok)
import mapping_tools as mt           # noqa: E402  (host-ok)


# ───────────────────────── config resolution ────────────────────────────────
def _resolve_target() -> str:
    """The Silver target the virtual views are created in (resolved SEMANTIC_DS)."""
    try:
        from silver_target import SEMANTIC_DS
        return SEMANTIC_DS
    except Exception:
        pid = os.environ.get("PROJECT_ID", "resilience-riskradar")
        return os.environ.get("SEMANTIC_DS") or f"{pid}.tiger_semantic"


def _build_adapter(platform: str):
    p = (platform or "gcp").lower()
    if p in ("gcp", "bigquery", "bq"):
        return pa.get_adapter("bigquery",
                              project=os.environ.get("PROJECT_ID", "resilience-riskradar"),
                              location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"))
    if p in ("databricks", "dbx", "unity"):
        return pa.get_adapter("databricks",
                              host=os.environ.get("DATABRICKS_HOST"),
                              http_path=os.environ.get("DATABRICKS_HTTP_PATH"),
                              token=os.environ.get("DATABRICKS_TOKEN"),
                              catalog=os.environ.get("DATABRICKS_CATALOG"))
    raise SystemExit(f"unknown --platform {platform!r} (use gcp|databricks)")


# ───────────────────────── phases ───────────────────────────────────────────
def do_introspect(adapter, source: str, out_dir: str) -> dict:
    cols = adapter.introspect_columns(source)
    tables: dict = {}
    for c in cols:
        tables.setdefault(c.get("table"), []).append(c)
    client_dict = {"source": source, "table_count": len(tables),
                   "column_count": len(cols),
                   "tables": [{"table": t, "columns": cs} for t, cs in sorted(tables.items())]}
    path = os.path.join(out_dir, "client_dictionary.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(client_dict, fh, indent=2, default=str)
    print(f"[introspect] {len(tables)} tables / {len(cols)} columns -> {path}")
    return client_dict


def _run_agent_sync(source: str) -> str:
    """Run the schema-mapping ADK agent once; return its final JSON text.
    Lazy-imports ADK so the rest of this module works without it."""
    import asyncio
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types
    from agents import get_agent

    async def _go() -> str:
        agent = get_agent("schema_mapping")
        svc = InMemorySessionService()
        app = "tiger-schema-mapping"
        sid = f"map-{uuid.uuid4().hex[:10]}"
        runner = Runner(app_name=app, agent=agent, session_service=svc)
        await svc.create_session(app_name=app, user_id="mapper", session_id=sid)
        msg = genai_types.Content(role="user", parts=[genai_types.Part.from_text(
            text=json.dumps({"instruction": "Map the client source onto the standard "
                             "Silver schema. Call get_standard_schema and the client "
                             "introspection tools, then output the SchemaMappingProposal "
                             "JSON only.", "source": source}))])
        final = ""
        async for event in runner.run_async(user_id="mapper", session_id=sid, new_message=msg):
            if event.is_final_response() and event.content and event.content.parts:
                final = "".join(p.text for p in event.content.parts
                                if getattr(p, "text", None))
        return final

    return asyncio.run(_go())


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    t = text.strip()
    if t.startswith("```"):
        t = t[3:]
        if t[:4].lower() == "json":
            t = t[4:]
        if "```" in t:
            t = t[:t.rfind("```")]
    s, e = t.find("{"), t.rfind("}")
    cand = t[s:e + 1] if (s != -1 and e > s) else t
    try:
        return json.loads(cand)
    except Exception:
        return {}


def _write_worksheet(graded: dict, out_dir: str) -> str:
    lines = ["# Schema-Mapping Resolution Worksheet", "",
             f"- coverage: **{graded.get('coverage_pct')}** "
             f"({len(graded.get('mapped', []))} mapped / "
             f"{graded.get('standard_columns')} standard columns)",
             f"- required (key) columns covered: "
             f"{graded.get('required_covered')}/{graded.get('required_total')}", "",
             "Resolve every **ambiguous** and **unmapped (required)** row below, then add "
             "the corrected entry to `proposal.json` `mapped[]` and re-run with `--apply`. "
             "Nothing is created until you do — no mapping is invented.", ""]
    amb = graded.get("ambiguous", [])
    lines.append(f"## Ambiguous ({len(amb)}) — pick a client column or reject")
    lines.append("")
    for e in amb:
        lines.append(f"- `{e.get('std_view')}.{e.get('std_column')}` ← "
                     f"`{e.get('client_table')}.{e.get('client_column')}`? "
                     f"conf={e.get('confidence')} — {e.get('basis') or e.get('_demoted_reason') or ''}")
    lines.append("")
    un = graded.get("unmapped", [])
    lines.append(f"## Unmapped ({len(un)}) — required keys have no source")
    lines.append("")
    for e in un[:200]:
        lines.append(f"- `{e.get('std_view')}.{e.get('std_column')}` — "
                     f"{e.get('basis') or e.get('_reason') or 'no candidate'}")
    if len(un) > 200:
        lines.append(f"- … and {len(un) - 200} more")
    path = os.path.join(out_dir, "mapping_worksheet.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return path


def do_propose(adapter, source: str, out_dir: str, min_conf: float) -> int:
    mt.set_context(adapter, source)
    print("[propose] running schema-mapping agent (LLM) …")
    raw = _run_agent_sync(source)
    proposal = _extract_json(raw)
    if not proposal:
        print("[propose] ERROR: agent returned no parseable JSON.", file=sys.stderr)
        with open(os.path.join(out_dir, "agent_raw.txt"), "w", encoding="utf-8") as fh:
            fh.write(raw or "")
        return 3
    graded = mt.flag_ambiguities(proposal, min_conf=min_conf)
    with open(os.path.join(out_dir, "proposal.json"), "w", encoding="utf-8") as fh:
        json.dump(graded, fh, indent=2, default=str)
    ws = _write_worksheet(graded, out_dir)
    blocked = bool(graded.get("ambiguous")) or bool(graded.get("unmapped"))
    print(f"[propose] coverage={graded.get('coverage_pct')} "
          f"mapped={len(graded.get('mapped', []))} "
          f"ambiguous={len(graded.get('ambiguous', []))} "
          f"unmapped={len(graded.get('unmapped', []))}")
    print(f"[propose] worksheet -> {ws}")
    if blocked:
        print("[propose] BLOCKED: resolve the worksheet, update proposal.json mapped[], "
              "then re-run with --apply. (No views created — no mapping invented.)")
    else:
        print("[propose] clean mapping — re-run with --apply to create the virtual views.")
    return 0


def do_apply(adapter, source: str, target: str, out_dir: str, dry_run: bool) -> int:
    ppath = os.path.join(out_dir, "proposal.json")
    if not os.path.exists(ppath):
        print(f"[apply] ERROR: {ppath} not found — run propose first.", file=sys.stderr)
        return 4
    with open(ppath, "r", encoding="utf-8") as fh:
        graded = json.load(fh)
    if graded.get("unmapped"):
        print(f"[apply] WARNING: {len(graded['unmapped'])} unmapped (required) columns remain — "
              "their views will be incomplete. Resolve them in proposal.json mapped[] to fix.")
    ddls = mt.build_view_ddls(graded.get("mapped", []), adapter, target, source)
    created, skipped = 0, 0
    for d in ddls:
        if not d.get("ddl"):
            print(f"[apply] skip {d['view']}: {d['warnings']}")
            skipped += 1
            continue
        if d.get("warnings"):
            print(f"[apply] {d['view']} warnings: {d['warnings']}")
        if dry_run:
            print(f"[apply][dry-run] {d['view']}:\n{d['ddl']}\n")
        else:
            adapter.execute_ddl(d["ddl"])
            print(f"[apply] created view {target}.{d['view']} (src {d['source_table']})")
        created += 1
    print(f"[apply] {'(dry-run) ' if dry_run else ''}{created} view(s), {skipped} skipped.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Dynamic Silver-layer mapping (DEPLOY.md Option B)")
    ap.add_argument("--platform", default=os.environ.get("DEPLOY_PLATFORM", "gcp"))
    ap.add_argument("--source", help="client raw namespace (proj.dataset | catalog.schema)")
    ap.add_argument("--target", default=None, help="Silver target (default: resolved SEMANTIC_DS)")
    ap.add_argument("--out-dir", default=os.path.join(_ROOT, "schema_mapping_out"))
    ap.add_argument("--introspect-only", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--min-conf", type=float, default=0.6)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    target = args.target or _resolve_target()
    adapter = _build_adapter(args.platform)

    if args.apply:
        if not args.source:
            raise SystemExit("--apply needs --source (the client raw namespace for the views' FROM).")
        return do_apply(adapter, args.source, target, args.out_dir, args.dry_run)

    if not args.source:
        raise SystemExit("--source is required (e.g. --source myproj.client_raw)")

    if args.introspect_only:
        do_introspect(adapter, args.source, args.out_dir)
        return 0

    do_introspect(adapter, args.source, args.out_dir)
    return do_propose(adapter, args.source, args.out_dir, args.min_conf)


if __name__ == "__main__":
    raise SystemExit(main())

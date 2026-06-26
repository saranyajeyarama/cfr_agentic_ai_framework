"""Dynamic Silver-layer mapping tools (DEPLOY.md Option B).

Pure Python — NO ADK / FastAPI imports — so it stays unit-testable on the host.
The ADK FunctionTool wrapping happens in agents.py (which already depends on ADK).

The schema-mapping agent uses the four *agent tools* below to (1) read the
standard Silver schema (the mapping TARGET) and (2) introspect + profile the
client's own source, then emits a SchemaMappingProposal (schemas.py). The two
*runner helpers* (flag_ambiguities, build_view_ddls) are deterministic and run
in run_schema_mapping.py — they backstop the LLM (the no-invented-mappings
guardrail is enforced in code, not just in the prompt).

NOTE: no `from __future__ import annotations` here — ADK's automatic function
calling needs real (non-stringized) annotations on the tool functions.
"""


def load_standard_silver_schema() -> dict:
    """The standard Silver schema (mapping target) from the app's own
    fetch_data_dictionary() — single source of truth (== data-model.md)."""
    try:
        from data_pipeline import fetch_data_dictionary
        return fetch_data_dictionary()
    except Exception as exc:  # degrade: caller surfaces the empty schema
        return {"error": f"could not load standard schema: {exc}",
                "totalViews": 0, "views": []}


# Runtime context — the runner binds the platform adapter + client source here
# before invoking the agent, so the zero-arg agent tools can reach them.
_CTX: dict = {"adapter": None, "source": None, "standard": None}


def set_context(adapter, source: str, standard: dict = None) -> None:
    """Bind the platform adapter + client source namespace for the agent tools.
    `source` is 'project.dataset' (BigQuery) or 'catalog.schema' (Databricks)."""
    _CTX["adapter"] = adapter
    _CTX["source"] = source
    _CTX["standard"] = standard or load_standard_silver_schema()


def _adapter():
    a = _CTX.get("adapter")
    if a is None:
        raise RuntimeError("mapping_tools context not set — call set_context() first.")
    return a


# ───────────────────────── agent tools (simple signatures) ──────────────────
def get_standard_schema() -> dict:
    """Return the standard Silver schema — the mapping TARGET. Each standard view
    lists its columns with classification (key/measure/date/dimension). Map the
    client's tables/columns onto THESE exact view + column names."""
    std = _CTX.get("standard") or load_standard_silver_schema()
    views = [{
        "name": v.get("name"),
        "grainHint": v.get("grainHint"),
        "columns": [{"name": c.get("name"), "dataType": c.get("dataType"),
                     "classification": c.get("classification")}
                    for c in v.get("columns", [])],
    } for v in std.get("views", [])]
    return {"totalViews": std.get("totalViews"), "views": views}


def list_client_tables() -> dict:
    """List the client source tables available for mapping.
    Returns {source, tables:[...], table_count}."""
    a = _adapter()
    src = _CTX["source"]
    tables = a.list_tables(src)
    return {"source": src, "tables": tables, "table_count": len(tables)}


def describe_client_table(table: str) -> dict:
    """Return the columns of one client table (name, data_type, nullable). Use
    before mapping, to see what the table actually contains."""
    a = _adapter()
    src = _CTX["source"]
    cols = [c for c in a.introspect_columns(src) if c.get("table") == table]
    return {"table": table, "columns": cols, "column_count": len(cols)}


def profile_client_column(table: str, column: str) -> dict:
    """Profile one client column (row_count, null_pct, distinct_count,
    sample_values) so a mapping can be confirmed by CONTENT, not just by name."""
    a = _adapter()
    src = _CTX["source"]
    return a.profile_column(src, table, column)


# ───────────────────────── runner helpers (deterministic) ───────────────────
def flag_ambiguities(proposal: dict, standard: dict = None,
                     min_conf: float = 0.6) -> dict:
    """Backstop the LLM proposal: demote low-confidence / column-less 'mapped'
    entries to ambiguous, surface any required (key) standard column that has no
    mapping as unmapped, and compute coverage. Never invents a mapping.

    Returns {mapped, ambiguous, unmapped, coverage_pct, required_total,
    required_covered, standard_columns}.
    """
    standard = standard or load_standard_silver_schema()
    std_cols, required = set(), set()
    for v in standard.get("views", []):
        for c in v.get("columns", []):
            key = (v.get("name"), c.get("name"))
            std_cols.add(key)
            if c.get("classification") == "key":
                required.add(key)

    def norm(e):
        return (e.get("std_view"), e.get("std_column"))

    mapped, ambiguous, unmapped = [], list(proposal.get("ambiguous") or []), \
        list(proposal.get("unmapped") or [])
    for e in (proposal.get("mapped") or []):
        try:
            conf = float(e.get("confidence") or 0)
        except (TypeError, ValueError):
            conf = 0.0
        if conf >= min_conf and e.get("client_column"):
            mapped.append(e)
        else:
            d = dict(e)
            d["_demoted_reason"] = "low confidence or missing client_column"
            ambiguous.append(d)

    covered = {norm(e) for e in mapped}
    already = {norm(e) for e in unmapped} | {norm(e) for e in ambiguous}
    for (vw, col) in sorted(required - covered):
        if (vw, col) not in already:
            unmapped.append({"std_view": vw, "std_column": col,
                             "_reason": "required key column with no mapping"})

    coverage = round(len(covered) / len(std_cols), 4) if std_cols else 0.0
    return {"mapped": mapped, "ambiguous": ambiguous, "unmapped": unmapped,
            "coverage_pct": coverage,
            "required_total": len(required),
            "required_covered": len(required & covered),
            "standard_columns": len(std_cols)}


def build_view_ddls(approved: list, adapter, target: str, source: str) -> list:
    """Render one CREATE OR REPLACE VIEW per standard view from APPROVED column
    mappings. Groups approved columns by std_view; each becomes
    `<client_column|transform> AS <std_column>` over the client source table.
    Flags views whose columns reference more than one client table.
    """
    by_view: dict = {}
    for e in approved:
        vw = e.get("std_view")
        if vw:
            by_view.setdefault(vw, []).append(e)

    out = []
    for vw, entries in sorted(by_view.items()):
        tables = sorted({e.get("client_table") for e in entries if e.get("client_table")})
        warnings = []
        if len(tables) > 1:
            warnings.append(f"columns span multiple client tables {tables}; "
                            f"using {tables[0]} — a join may be required (review)")
        src_table = tables[0] if tables else None
        if not src_table:
            out.append({"view": vw, "ddl": None, "source_table": None,
                        "warnings": ["no client source table on any mapped column; skipped"]})
            continue
        parts = []
        for e in entries:
            std_col = e.get("std_column")
            expr = e.get("transform") or e.get("client_column")
            if std_col and expr:
                parts.append(f"{expr} AS {std_col}")
        if not parts:
            out.append({"view": vw, "ddl": None, "source_table": src_table,
                        "warnings": ["no usable column expressions; skipped"]})
            continue
        select_expr = ",\n       ".join(parts)
        source_fqn = f"{source}.{src_table}"
        ddl = adapter.render_view_ddl(vw, target, select_expr, source_fqn)
        out.append({"view": vw, "ddl": ddl, "source_table": src_table,
                    "warnings": warnings})
    return out

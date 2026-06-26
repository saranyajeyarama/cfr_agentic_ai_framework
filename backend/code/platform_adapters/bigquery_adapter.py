"""BigQuery (GCP) CatalogAdapter.

Introspection reuses the same INFORMATION_SCHEMA approach as the app's
fetch_data_dictionary(). Unquoted paths are used deliberately — BigQuery permits
hyphenated project ids in unquoted table paths (e.g. resilience-riskradar.ds.tbl),
which is the convention the app already relies on. Leaf identifiers are validated
via safe_ident().
"""
from google.cloud import bigquery

from .base import CatalogAdapter, safe_ident


class BigQueryAdapter(CatalogAdapter):
    kind = "bigquery"

    def __init__(self, project: str | None = None, location: str = "us-central1"):
        self._client = bigquery.Client(project=project, location=location)

    def _q(self, sql: str, params: list | None = None) -> list[dict]:
        cfg = bigquery.QueryJobConfig(query_parameters=params or [])
        return [dict(r) for r in self._client.query(sql, job_config=cfg).result()]

    def list_tables(self, source: str) -> list[str]:
        # Derive from COLUMNS (distinct) rather than TABLES — COLUMNS is the
        # access path data-viewer reliably grants (same as fetch_data_dictionary).
        rows = self._q(
            f"SELECT DISTINCT table_name FROM {source}.INFORMATION_SCHEMA.COLUMNS "
            f"ORDER BY table_name")
        return [r["table_name"] for r in rows]

    def introspect_columns(self, source: str) -> list[dict]:
        rows = self._q(f"""
            SELECT table_name, column_name, data_type, is_nullable, ordinal_position
            FROM {source}.INFORMATION_SCHEMA.COLUMNS
            ORDER BY table_name, ordinal_position
        """)
        return [{
            "table":     r.get("table_name"),
            "column":    r.get("column_name"),
            "data_type": r.get("data_type"),
            "nullable":  (str(r.get("is_nullable", "YES")) or "").upper() == "YES",
            "ordinal":   r.get("ordinal_position"),
        } for r in rows]

    def profile_column(self, source: str, table: str, column: str,
                       sample: int = 8, scan_cap: int = 100_000) -> dict:
        t, c = safe_ident(table), safe_ident(column)
        sql = f"""
          WITH s AS (SELECT `{c}` AS v FROM {source}.{t} LIMIT {int(scan_cap)})
          SELECT COUNT(*)                                            AS row_count,
                 COUNTIF(v IS NULL)                                  AS null_count,
                 APPROX_COUNT_DISTINCT(v)                            AS distinct_count,
                 ARRAY_AGG(DISTINCT CAST(v AS STRING)
                           IGNORE NULLS LIMIT {int(sample)})         AS sample_values
          FROM s
        """
        r = (self._q(sql) or [{}])[0]
        rc = int(r.get("row_count") or 0)
        nc = int(r.get("null_count") or 0)
        return {
            "row_count":      rc,
            "null_count":     nc,
            "null_pct":       round(nc / rc, 4) if rc else None,
            "distinct_count": r.get("distinct_count"),
            "sample_values":  [str(x) for x in (r.get("sample_values") or [])],
        }

    def render_view_ddl(self, view_name: str, target: str, select_expr: str,
                        source_fqn: str) -> str:
        return (f"CREATE OR REPLACE VIEW {target}.{safe_ident(view_name)} AS\n"
                f"SELECT {select_expr}\n"
                f"FROM {source_fqn};")

    def execute_ddl(self, ddl: str) -> None:
        self._client.query(ddl).result()

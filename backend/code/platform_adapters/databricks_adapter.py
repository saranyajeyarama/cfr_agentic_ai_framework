"""Databricks (Unity Catalog) CatalogAdapter.

Uses databricks-sql-connector against a SQL warehouse. The connector import is
GUARDED so GCP-only installs (which don't ship it) can still import this package;
the methods raise a clear error if it's actually used without the dependency.

NOTE: view creation + introspection are in scope now (Milestone A). The app's
own read path against Unity Catalog is Milestone B — see README_DEPLOY.md.
"""
from .base import CatalogAdapter, safe_ident

try:                                   # optional dependency — guarded
    from databricks import sql as _dbsql
except Exception:                      # pragma: no cover - absent on GCP installs
    _dbsql = None


class DatabricksAdapter(CatalogAdapter):
    kind = "databricks"

    def __init__(self, host: str | None = None, http_path: str | None = None,
                 token: str | None = None, catalog: str | None = None):
        self._host = host
        self._http_path = http_path
        self._token = token
        self._catalog = catalog
        self._conn = None

    def _connect(self):
        if _dbsql is None:
            raise RuntimeError(
                "databricks-sql-connector is not installed. Add it to "
                "requirements.txt to use the Databricks adapter.")
        if self._conn is None:
            self._conn = _dbsql.connect(
                server_hostname=self._host,
                http_path=self._http_path,
                access_token=self._token)
        return self._conn

    def _q(self, sql: str, params: list | None = None) -> list[dict]:
        cur = self._connect().cursor()
        try:
            cur.execute(sql, params or None)
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            cur.close()

    @staticmethod
    def _split(source: str) -> tuple[str, str]:
        parts = (source or "").split(".")
        cat = parts[0] if parts else ""
        sch = parts[1] if len(parts) > 1 else ""
        return cat, sch

    def list_tables(self, source: str) -> list[str]:
        cat, sch = self._split(source)
        rows = self._q(
            f"SELECT DISTINCT table_name FROM {safe_ident(cat)}.information_schema.columns "
            f"WHERE table_schema = ? ORDER BY table_name", [sch])
        return [r["table_name"] for r in rows]

    def introspect_columns(self, source: str) -> list[dict]:
        cat, sch = self._split(source)
        rows = self._q(f"""
            SELECT table_name, column_name, data_type, is_nullable, ordinal_position
            FROM {safe_ident(cat)}.information_schema.columns
            WHERE table_schema = ?
            ORDER BY table_name, ordinal_position
        """, [sch])
        return [{
            "table":     r.get("table_name"),
            "column":    r.get("column_name"),
            "data_type": r.get("data_type"),
            "nullable":  (str(r.get("is_nullable", "YES")) or "").upper() == "YES",
            "ordinal":   r.get("ordinal_position"),
        } for r in rows]

    def profile_column(self, source: str, table: str, column: str,
                       sample: int = 8, scan_cap: int = 100_000) -> dict:
        cat, sch = self._split(source)
        t, c = safe_ident(table), safe_ident(column)
        sql = f"""
          WITH s AS (SELECT `{c}` AS v
                     FROM {safe_ident(cat)}.{safe_ident(sch)}.{t} LIMIT {int(scan_cap)})
          SELECT COUNT(*)                                              AS row_count,
                 COUNT(*) - COUNT(v)                                   AS null_count,
                 approx_count_distinct(v)                              AS distinct_count,
                 slice(array_distinct(collect_list(cast(v AS string))),
                       1, {int(sample)})                               AS sample_values
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
        # target = 'catalog.schema'; source_fqn = 'catalog.schema.table'
        return (f"CREATE OR REPLACE VIEW {target}.{safe_ident(view_name)} AS\n"
                f"SELECT {select_expr}\n"
                f"FROM {source_fqn};")

    def execute_ddl(self, ddl: str) -> None:
        self._q(ddl)

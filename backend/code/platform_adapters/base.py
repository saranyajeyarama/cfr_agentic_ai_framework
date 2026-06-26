"""CatalogAdapter — read-only catalog introspection + profiling + view-DDL
rendering for one data platform.

Two implementations exist: BigQuery (GCP) and Databricks (Unity Catalog). The
schema-mapping agent (DEPLOY.md Option B) uses these to (a) auto-build a client
data dictionary by introspection + profiling, and (b) render virtual-view DDL
that exposes the standard Silver schema over the client's own source. All methods
are read-only EXCEPT execute_ddl, which is invoked only after human approval.
"""
from abc import ABC, abstractmethod
import re

_IDENT = re.compile(r"^[A-Za-z0-9_]+$")


def safe_ident(name: str) -> str:
    """Guard a single SQL identifier (table/column/view/schema leaf). Identifiers
    come from catalog introspection, but we validate anyway so a malformed name
    can never be interpolated into DDL/queries. Does NOT accept dotted paths."""
    if not name or not _IDENT.match(str(name)):
        raise ValueError(f"unsafe SQL identifier: {name!r}")
    return str(name)


class CatalogAdapter(ABC):
    """One platform's catalog surface. `source` is the client's raw namespace
    (BigQuery: 'project.dataset'; Databricks: 'catalog.schema'). `target` is the
    Silver namespace the virtual views are created in (resolved SEMANTIC_DS)."""

    kind: str = "base"

    @abstractmethod
    def list_tables(self, source: str) -> list[str]:
        """Table names in the client source namespace."""

    @abstractmethod
    def introspect_columns(self, source: str) -> list[dict]:
        """One dict per column: {table, column, data_type, nullable, ordinal}."""

    @abstractmethod
    def profile_column(self, source: str, table: str, column: str,
                       sample: int = 8, scan_cap: int = 100_000) -> dict:
        """Bounded content profile: {row_count, null_count, null_pct,
        distinct_count, sample_values[]}. Scans at most `scan_cap` rows."""

    @abstractmethod
    def render_view_ddl(self, view_name: str, target: str, select_expr: str,
                        source_fqn: str) -> str:
        """CREATE OR REPLACE VIEW text mapping a client table onto a standard
        Silver view. Returns DDL text only — never executes."""

    @abstractmethod
    def execute_ddl(self, ddl: str) -> None:
        """Execute a DDL statement. Called only after human approval of the mapping."""

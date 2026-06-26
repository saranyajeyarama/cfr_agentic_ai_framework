"""platform_adapters — per-platform catalog adapters for Silver-layer mapping.

Named `platform_adapters` (NOT `platform`) to avoid shadowing the Python stdlib
`platform` module on the flat /app import path.

    from platform_adapters import get_adapter
    adapter = get_adapter("bigquery", project="my-proj")
"""
from .base import CatalogAdapter, safe_ident
from .bigquery_adapter import BigQueryAdapter
from .databricks_adapter import DatabricksAdapter

_BQ = {"bigquery", "gcp", "bq"}
_DBX = {"databricks", "dbx", "unity", "unity_catalog"}


def get_adapter(kind: str, **cfg) -> CatalogAdapter:
    """Resolve a CatalogAdapter from a platform `kind` + config kwargs.

    kind 'bigquery'|'gcp'|'bq'        -> BigQueryAdapter(project, location)
    kind 'databricks'|'dbx'|'unity'   -> DatabricksAdapter(host, http_path, token, catalog)
    """
    k = (kind or "").lower()
    if k in _BQ:
        return BigQueryAdapter(project=cfg.get("project"),
                               location=cfg.get("location", "us-central1"))
    if k in _DBX:
        return DatabricksAdapter(host=cfg.get("host"),
                                 http_path=cfg.get("http_path"),
                                 token=cfg.get("token"),
                                 catalog=cfg.get("catalog"))
    raise ValueError(f"unknown platform kind: {kind!r}")


__all__ = ["CatalogAdapter", "BigQueryAdapter", "DatabricksAdapter",
           "get_adapter", "safe_ident"]

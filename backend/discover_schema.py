"""
Run this to discover actual BigQuery table schemas.
Usage (from backend/ dir):
  $env:GOOGLE_APPLICATION_CREDENTIALS = "backend/resilience-riskradar-2c010597a83b.json"
  python discover_schema.py
"""
import os, sys
sys.path.insert(0, "code/orchestrator_service")

from google.cloud import bigquery

PROJECT = os.environ.get("PROJECT_ID", "resilience-riskradar")
client = bigquery.Client(project=PROJECT)

TABLES = [
    ("tiger_semantic", "fct_otif"),
    ("tiger_semantic", "fct_sales_orders"),
    ("tiger_semantic", "fct_inventory_movements"),
    ("tiger_semantic", "fct_forecast_accuracy"),
    ("tiger_semantic", "dim_customer"),
    ("tiger_semantic", "agg_cfr_weekly"),
    ("tiger_decisions", "fct_allocation_decisions"),
]

for dataset, table in TABLES:
    ref = f"{PROJECT}.{dataset}.{table}"
    print(f"\n{'='*60}")
    print(f"TABLE: {ref}")
    print('='*60)
    try:
        t = client.get_table(ref)
        for field in t.schema:
            print(f"  {field.name:40s} {field.field_type}")
    except Exception as e:
        print(f"  ERROR: {e}")

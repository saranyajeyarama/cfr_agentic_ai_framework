"""Check delivery data in known tiger_semantic tables."""
from google.cloud import bigquery
import json

c = bigquery.Client(project="resilience-riskradar", location="us-central1")

# 1. fct_otif - check what delivery columns exist
print("=== fct_otif sample (Walmart, 5 rows) ===")
rows = list(c.query("""
    SELECT *
    FROM `tiger_semantic.fct_otif`
    WHERE sold_to = '1000001'
    ORDER BY delivery_date_promised DESC
    LIMIT 2
""").result())
if rows:
    print(f"  Columns: {list(dict(rows[0]).keys())}")
    for r in rows:
        print(json.dumps({k: str(v) for k, v in dict(r).items()}, indent=2))

# 2. Try common delivery table names
for tname in ["fct_deliveries", "fct_shipments", "fct_delivery", "fct_shipment",
              "fct_transportation", "fct_freight", "fct_open_deliveries",
              "fct_delivery_performance", "fct_logistics",
              "dim_plant", "dim_transportation", "dim_carrier",
              "dim_route", "dim_lane", "dim_logistics"]:
    try:
        rows = list(c.query(f"SELECT * FROM `tiger_semantic.{tname}` LIMIT 1").result())
        if rows:
            print(f"\n=== {tname} EXISTS ===")
            print(f"  Columns: {list(dict(rows[0]).keys())}")
            print(f"  Sample: {json.dumps({k: str(v) for k, v in dict(rows[0]).items()}, indent=2)}")
    except Exception as e:
        if "Not found" in str(e):
            pass  # table doesn't exist
        else:
            print(f"  {tname}: {str(e)[:100]}")

# 3. fct_sales_orders sample
print("\n=== fct_sales_orders sample ===")
rows = list(c.query("""
    SELECT *
    FROM `tiger_semantic.fct_sales_orders`
    WHERE sold_to_number = '1000001'
    ORDER BY requested_delivery_date DESC
    LIMIT 2
""").result())
if rows:
    print(f"  Columns: {list(dict(rows[0]).keys())}")
    for r in rows:
        print(json.dumps({k: str(v) for k, v in dict(r).items()}, indent=2))

# 4. fct_inventory_projection sample
print("\n=== fct_inventory_projection sample (plant-level) ===")
rows = list(c.query("""
    SELECT *
    FROM `tiger_semantic.fct_inventory_projection`
    WHERE material_number = '70010203'
    ORDER BY projection_week_start DESC
    LIMIT 3
""").result())
if rows:
    print(f"  Columns: {list(dict(rows[0]).keys())}")
    for r in rows:
        print(json.dumps({k: str(v) for k, v in dict(r).items()}, indent=2))

# 5. Check dim_plant
print("\n=== dim_plant ===")
try:
    rows = list(c.query("SELECT * FROM `tiger_semantic.dim_plant` LIMIT 5").result())
    if rows:
        print(f"  Columns: {list(dict(rows[0]).keys())}")
        for r in rows:
            print(f"  {dict(r)}")
except Exception as e:
    print(f"  Not found or error: {str(e)[:120]}")

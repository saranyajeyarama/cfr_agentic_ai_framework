"""Check what plant codes and customer regions exist in tiger_semantic."""
from google.cloud import bigquery
c = bigquery.Client(project="resilience-riskradar", location="us-central1")

print("=== PLANT CODES in fct_inventory_projection ===")
rows = list(c.query("""
    SELECT DISTINCT plant_code
    FROM `tiger_semantic.fct_inventory_projection`
    ORDER BY plant_code
""").result())
for r in rows:
    print(f"  {r['plant_code']}")

print("\n=== PLANT CODES in fct_sales_orders ===")
rows = list(c.query("""
    SELECT DISTINCT plant_code
    FROM `tiger_semantic.fct_sales_orders`
    ORDER BY plant_code
""").result())
for r in rows:
    print(f"  {r['plant_code']}")

print("\n=== CUSTOMER REGIONS in dim_customer ===")
try:
    rows = list(c.query("""
        SELECT column_name
        FROM `tiger_semantic.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = 'dim_customer'
        ORDER BY ordinal_position
    """).result())
    print("  Columns:", [r["column_name"] for r in rows])
except Exception as e:
    print(f"  Error: {e}")

try:
    rows = list(c.query("""
        SELECT DISTINCT customer_region
        FROM `tiger_semantic.dim_customer`
        WHERE customer_region IS NOT NULL
        ORDER BY customer_region
        LIMIT 20
    """).result())
    print("  Regions:", [r["customer_region"] for r in rows])
except Exception as e:
    print(f"  customer_region column not found, trying alternatives...")
    # Try to find any region-like column
    rows = list(c.query("""
        SELECT customer_number, customer_name, *
        FROM `tiger_semantic.dim_customer`
        LIMIT 3
    """).result())
    for r in rows:
        print(f"  Sample row keys: {list(dict(r).keys())}")
        print(f"  Sample row: {dict(r)}")
        break

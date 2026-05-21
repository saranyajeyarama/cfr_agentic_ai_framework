"""Check what delivery-related tables exist in tiger_semantic."""
from google.cloud import bigquery
import json

c = bigquery.Client(project="resilience-riskradar", location="us-central1")

# 1. List all tables in tiger_semantic
print("=== ALL TABLES in tiger_semantic ===")
tables = list(c.list_tables("tiger_semantic"))
for t in tables:
    print(f"  {t.table_id}")

# 2. Check for delivery-related tables
delivery_tables = [t.table_id for t in tables if "deliv" in t.table_id.lower() or "ship" in t.table_id.lower() or "transport" in t.table_id.lower() or "freight" in t.table_id.lower() or "route" in t.table_id.lower() or "lane" in t.table_id.lower()]
print(f"\n=== DELIVERY/SHIPPING RELATED TABLES ===")
for t in delivery_tables:
    print(f"  {t}")

# 3. Check fct_otif columns (it has delivery data)
print("\n=== fct_otif columns ===")
table = c.get_table("tiger_semantic.fct_otif")
for field in table.schema:
    print(f"  {field.name}: {field.field_type}")

# 4. Check if there's a delivery/shipment fact table
for tname in ["fct_deliveries", "fct_shipments", "fct_delivery", "fct_shipment",
              "fct_transportation", "fct_freight", "fct_routes", "fct_lanes",
              "dim_plant", "dim_transportation", "dim_route", "dim_lane"]:
    try:
        t = c.get_table(f"tiger_semantic.{tname}")
        print(f"\n=== {tname} columns ===")
        for field in t.schema:
            print(f"  {field.name}: {field.field_type}")
    except Exception:
        pass

# 5. Check fct_sales_orders for delivery/freight columns
print("\n=== fct_sales_orders columns ===")
table = c.get_table("tiger_semantic.fct_sales_orders")
for field in table.schema:
    print(f"  {field.name}: {field.field_type}")

# 6. Check fct_inventory_projection columns
print("\n=== fct_inventory_projection columns ===")
table = c.get_table("tiger_semantic.fct_inventory_projection")
for field in table.schema:
    print(f"  {field.name}: {field.field_type}")

# 7. Sample from fct_otif - delivery-related fields
print("\n=== fct_otif sample (delivery fields) ===")
rows = list(c.query("""
    SELECT sold_to, primary_material_number,
           delivery_number, delivery_date_promised, delivery_date_actual,
           carrier_name, transportation_mode, ship_from_plant,
           ordered_quantity_cases, delivered_quantity_cases,
           days_late, otif_flag, otif_fail_reason
    FROM `tiger_semantic.fct_otif`
    WHERE sold_to = '1000001'
    ORDER BY delivery_date_promised DESC
    LIMIT 5
""").result())
for r in rows:
    d = dict(r)
    print(json.dumps({k: str(v) for k, v in d.items()}, indent=2))

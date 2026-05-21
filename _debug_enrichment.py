"""Check what enrichment data is available for real risk calculations."""
from google.cloud import bigquery
import json

c = bigquery.Client(project="resilience-riskradar", location="us-central1")

# 1. Check dim_customer OTIF fields
print("=== dim_customer OTIF fields for Walmart (1000001) ===")
rows = list(c.query("""
    SELECT customer_number, customer_name, otif_target_pct,
           fill_rate_threshold_pct, otif_aggressive_flag,
           on_time_window_days_early, on_time_window_days_late,
           mabd_enforcement_type, otif_program_name
    FROM `tiger_semantic.dim_customer`
    WHERE customer_number = '1000001'
""").result())
for r in rows:
    print(json.dumps(dict(r), indent=2, default=str))

# 2. Check recent OTIF history for Walmart + material
print("\n=== fct_otif recent failures for Walmart + 70010203 ===")
rows = list(c.query("""
    SELECT sold_to, primary_material_number,
           otif_flag, days_late, otif_fail_reason, otif_root_cause_category,
           delivery_date_promised, ordered_quantity_cases
    FROM `tiger_semantic.fct_otif`
    WHERE sold_to = '1000001'
      AND primary_material_number = '70010203'
    ORDER BY delivery_date_promised DESC
    LIMIT 10
""").result())
print(f"  Found {len(rows)} rows")
total = len(rows)
fails = sum(1 for r in rows if r.get("otif_flag") == "N")
print(f"  Total: {total}, Fails: {fails}, Fail rate: {fails/total*100:.0f}%" if total else "  No data")
for r in rows[:5]:
    print(f"  {r['delivery_date_promised']} | flag={r['otif_flag']} | days_late={r['days_late']} | reason={r['otif_fail_reason']} | root_cause={r['otif_root_cause_category']}")

# 3. Check chargebacks
print("\n=== fct_chargebacks for Walmart ===")
rows = list(c.query("""
    SELECT sold_to, COUNT(*) as cnt,
           AVG(chargeback_amount_usd) as avg_chargeback,
           SUM(chargeback_amount_usd) as total_chargeback,
           MAX(chargeback_amount_usd) as max_chargeback
    FROM `tiger_semantic.fct_chargebacks`
    WHERE sold_to = '1000001'
    GROUP BY sold_to
""").result())
for r in rows:
    print(json.dumps(dict(r), indent=2, default=str))

# 4. Check Amazon too
print("\n=== fct_otif recent failures for Amazon + 70010405 ===")
rows = list(c.query("""
    SELECT sold_to, primary_material_number,
           otif_flag, days_late, otif_fail_reason, otif_root_cause_category,
           delivery_date_promised
    FROM `tiger_semantic.fct_otif`
    WHERE sold_to = '1000002'
      AND primary_material_number = '70010405'
    ORDER BY delivery_date_promised DESC
    LIMIT 10
""").result())
print(f"  Found {len(rows)} rows")
total = len(rows)
fails = sum(1 for r in rows if r.get("otif_flag") == "N")
print(f"  Total: {total}, Fails: {fails}, Fail rate: {fails/total*100:.0f}%" if total else "  No data")
for r in rows[:5]:
    print(f"  {r['delivery_date_promised']} | flag={r['otif_flag']} | days_late={r['days_late']} | reason={r['otif_fail_reason']} | root_cause={r['otif_root_cause_category']}")

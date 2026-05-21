"""Quick script to inspect the DCE table."""
from google.cloud import bigquery
c = bigquery.Client(project="resilience-riskradar", location="US")
q = """
SELECT
  decision_id,
  decision_status,
  sold_to,
  JSON_VALUE(decision_reason, '$.agent_recommendation') AS agent_rec,
  JSON_VALUE(decision_reason, '$.trigger.material_number') AS mat,
  JSON_VALUE(decision_reason, '$.trigger.customer_name') AS cust
FROM `tiger_decisions.fct_allocation_decisions`
ORDER BY decision_date DESC
LIMIT 10
"""
for r in c.query(q).result():
    print(dict(r))

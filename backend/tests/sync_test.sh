#!/usr/bin/env bash
echo "=== POST /sessions/sync ==="
T0=$(date +%s)
curl -m 300 -s -X POST \
  -H 'Content-Type: application/json' \
  --data '{"trigger_type":"new_order","trigger_source":"demo_payload","demo_order":{"ordered_quantity_cases":105,"requested_delivery_date":"2026-12-15","customer_name":"Walmart Inc.","material_description":"CUBC CHOC CHIP F/S 36/9 OZ PROMO","sold_to":"1000001","material_number":"70040102","sales_order_number":"004500055880"}}' \
  http://localhost:8080/sessions/sync > /tmp/sync.json
T1=$(date +%s)
echo "elapsed: $((T1 - T0))s"
echo "size: $(wc -c < /tmp/sync.json 2>/dev/null) bytes"
echo "--- summary ---"
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/sync.json'))
except Exception as e:
    print('failed to parse /tmp/sync.json:', e)
    raise SystemExit(0)
fac = d.get('final_action_card') or {}
rec = fac.get('recommendation') or {}
chain = fac.get('reasoning_chain') or {}
print('status         :', d.get('status'))
print('_schema_valid  :', fac.get('_schema_valid'))
print('rec type       :', type(rec).__name__)
if isinstance(rec, dict):
    print('  action       :', rec.get('action'))
    print('  raw_action   :', rec.get('raw_action'))
    print('  fulfill_qty  :', rec.get('fulfill_qty_cs'))
    print('  confidence   :', rec.get('confidence'))
else:
    print('  value        :', rec)
print('chain type     :', type(chain).__name__)
if isinstance(chain, dict):
    items = chain.get('key_trade_offs') or []
    print('  key_trade_offs:', len(items), 'items')
PY

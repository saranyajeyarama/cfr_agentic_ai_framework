#!/usr/bin/env bash
# Full end-to-end run: start a session, poll until awaiting_approval/error,
# print the final state. Run from the host (hits localhost:8080 directly).
set -u

BODY='{"trigger_type":"new_order","trigger_source":"demo_payload","demo_order":{"ordered_quantity_cases":1800,"requested_delivery_date":"2026-05-26","customer_name":"Dollar General","material_description":"Whiskas Purrfectly Chicken 24ct","material_number":"WHC-330","sales_order_number":"44025"}}'

echo "=== POST /sessions ==="
RESP=$(curl -m 60 -s -X POST -H 'Content-Type: application/json' --data "$BODY" http://localhost:8080/sessions)
echo "$RESP"
SID=$(python3 -c 'import sys, json; print(json.loads(sys.argv[1])["session_id"])' "$RESP")
echo "session_id=$SID"

echo "=== polling /sessions/$SID up to 5 min ==="
for i in $(seq 1 60); do
  RESP=$(curl -m 5 -s "http://localhost:8080/sessions/$SID")
  STATUS=$(python3 -c 'import sys, json; print(json.loads(sys.argv[1]).get("status","?"))' "$RESP")
  echo "  t=$((i*5))s status=$STATUS"
  case "$STATUS" in
    awaiting_approval|error) break ;;
  esac
  sleep 5
done

echo
echo "=== final session summary ==="
python3 - <<PY "$RESP"
import json, sys
d = json.loads(sys.argv[1])
print("status:", d.get("status"))
print("error :", d.get("error"))
fac = d.get("final_action_card") or {}
print("final_action_card keys:", list(fac.keys()) if fac else "<none>")
rec = (fac.get("recommendation") or {})
print("  action            :", rec.get("action"))
print("  fulfill_qty_cs    :", rec.get("fulfill_qty_cs"))
print("  confidence        :", rec.get("confidence"))
print("  expected_outcome  :", str(rec.get("expected_outcome"))[:200])
print("  _schema_valid     :", fac.get("_schema_valid"))
print("  _schema_error     :", fac.get("_schema_error"))
PY

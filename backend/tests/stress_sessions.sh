#!/usr/bin/env bash
# Fire N sessions in parallel and check each reaches awaiting_approval
# without ConnectError-style failures in the background tasks.
set -u
N="${1:-3}"
BODY='{"trigger_type":"new_order","trigger_source":"demo_payload","demo_order":{"ordered_quantity_cases":1800,"requested_delivery_date":"2026-05-26","customer_name":"Dollar General","material_description":"Whiskas Purrfectly Chicken 24ct","material_number":"WHC-330","sales_order_number":"44025"}}'

echo "=== firing $N sessions in parallel ==="
SIDS=()
for i in $(seq 1 "$N"); do
  RESP=$(curl -m 60 -s -X POST -H 'Content-Type: application/json' --data "$BODY" http://localhost:8080/sessions)
  SID=$(python3 -c 'import sys, json; print(json.loads(sys.argv[1])["session_id"])' "$RESP")
  echo "  $i started: $SID"
  SIDS+=("$SID")
done

echo
echo "=== polling each up to 8 min ==="
for SID in "${SIDS[@]}"; do
  for t in $(seq 1 96); do
    RESP=$(curl -m 5 -s "http://localhost:8080/sessions/$SID")
    STATUS=$(python3 -c 'import sys, json; print(json.loads(sys.argv[1]).get("status","?"))' "$RESP" 2>/dev/null)
    case "$STATUS" in
      awaiting_approval) echo "  $SID -> awaiting_approval at t=$((t*5))s"; break ;;
      error)             echo "  $SID -> ERROR at t=$((t*5))s"; break ;;
      "")                ;;
      *)                 ;;
    esac
    sleep 5
  done
done

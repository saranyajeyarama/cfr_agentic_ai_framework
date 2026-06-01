#!/usr/bin/env bash
set -u
for SID in "$@"; do
  echo "=== $SID ==="
  curl -m 5 -s "http://localhost:8080/sessions/$SID" > /tmp/s.json
  if [ ! -s /tmp/s.json ]; then echo "  (empty response)"; continue; fi
  python3 - <<'PY'
import json, sys
d = json.load(open('/tmp/s.json'))
print(f"  status        : {d.get('status')}")
print(f"  started_at    : {d.get('started_at')}")
print(f"  ended_at      : {d.get('ended_at')}")
print(f"  current_round : {d.get('current_round')}")
print(f"  error         : {d.get('error')}")
fac = d.get('final_action_card') or {}
sigs = fac.get('specialist_signals') or {}
print(f"  signals filed : {list(sigs.keys())}")
PY
done

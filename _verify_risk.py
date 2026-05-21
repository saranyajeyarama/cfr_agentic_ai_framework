"""Verify enriched risk data in incidents API response."""
import json, urllib.request

with urllib.request.urlopen("http://localhost:8080/fulfillment/incidents") as r:
    data = json.loads(r.read())

for inc in data["incidents"]:
    print(f"\n{'='*70}")
    print(f"  {inc['customer']} | {inc['materialNumber']}")
    print(f"{'='*70}")
    print(f"  riskProbability:    {inc['riskProbability']}% (OTIF fail rate)")
    print(f"  fineAtRisk:         ${inc['fineAtRisk']}")
    print(f"  otifTarget:         {inc.get('otifTarget')}%")
    print(f"  otifProgram:        {inc.get('otifProgram')}")
    print(f"  otifFailRate:       {inc.get('otifFailRate')}%")
    print(f"  recentFails:        {inc.get('recentFails')}/{inc.get('totalDeliveries')}")
    print(f"  maxDaysLate:        {inc.get('maxDaysLate')}d")
    print(f"  avgDaysLate:        {inc.get('avgDaysLate')}d")
    print(f"  lastFailReason:     {inc.get('lastFailReason')}")
    print(f"  lastRootCause:      {inc.get('lastRootCause')}")
    print(f"  avgChargebackUsd:   ${inc.get('avgChargebackUsd')}")
    print(f"  totalChargebackUsd: ${inc.get('totalChargebackUsd')}")
    print(f"  chargebackCount:    {inc.get('chargebackCount')}")
    print(f"  mabdEnforcement:    {inc.get('mabdEnforcement')}")
    print(f"  otifAggressive:     {inc.get('otifAggressive')}")
    print(f"  otifRulebook:       {inc.get('otifRulebook')}")
    print(f"  description:        {inc.get('description')[:120]}...")

"""Debug: trace the full LP optimizer flow for each incident."""
import json, urllib.request

# 1. Get incidents
with urllib.request.urlopen("http://localhost:8080/fulfillment/incidents") as r:
    incidents = json.loads(r.read())["incidents"]

for inc in incidents:
    print(f"\n{'='*80}")
    print(f"INCIDENT: {inc['customer']} | {inc['materialNumber']} | qty={inc['orderedQty']} | plant={inc['originPlant']}")
    print(f"{'='*80}")

    # 2. Simulate
    payload = json.dumps({
        "sold_to": inc["soldTo"],
        "material_number": inc["materialNumber"],
        "ordered_quantity_cases": inc["orderedQty"],
        "requested_delivery_date": inc["mabd"],
        "origin_plant": inc["originPlant"],
    }).encode()
    req = urllib.request.Request(
        "http://localhost:8080/fulfillment/simulate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r2:
        sim = json.loads(r2.read())

    meta = sim.get("meta", {})
    print(f"\nMETA: solver={meta.get('solver_status')} | elapsed={meta.get('elapsed_ms')}ms")
    print(f"  origin_plant_in_network: {meta.get('origin_plant_in_network')}")
    print(f"  available_plants: {meta.get('available_plants')}")
    print(f"  penalty_per_case: ${meta.get('penalty_per_case_usd')}")
    print(f"  no_alternate_reason: {meta.get('no_alternate_reason')}")

    # 3. Show raw inventory data
    inv_detail = meta.get("inventory_snapshot", {})
    if inv_detail:
        print(f"\n  INVENTORY SNAPSHOT:")
        for plant, vals in inv_detail.items():
            print(f"    {plant}: {vals}")

    # 4. Show each scenario in detail
    for s in sim.get("scenarios", []):
        print(f"\n  SCENARIO: {s['name']}")
        print(f"    dcSource:       {s['dcSource']}")
        print(f"    freightCost:    ${s['freightCost']}")
        print(f"    fine:           ${s['fine']}")
        print(f"    netImpact:      ${s['netImpact']}")
        print(f"    savingsVsDefault: ${s['savingsVsDefault']}")
        print(f"    isRecommended:  {s['isRecommended']}")
        print(f"    rationale:      {s.get('rationale', 'N/A')}")
        print(f"    arrival:        {s.get('arrival', 'N/A')}")

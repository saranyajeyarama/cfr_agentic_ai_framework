"""Quick check of API responses."""
import json, urllib.request

# 1. Incidents
with urllib.request.urlopen("http://localhost:8080/fulfillment/incidents") as r:
    inc = json.loads(r.read())
    print("=== /fulfillment/incidents ===")
    print(f"  count: {inc['meta']['count']}")
    print(f"  approved_only: {inc['meta']['approved_only']}")
    for i in inc["incidents"]:
        print(f"  - {i['id']}: {i['customer']} | {i['skuCode']} | action={i['description'][:60]}...")

# 2. Simulate (using the first incident if it exists)
if inc["incidents"]:
    first = inc["incidents"][0]
    payload = json.dumps({
        "sold_to": first["soldTo"],
        "material_number": first["materialNumber"],
        "ordered_quantity_cases": first["orderedQty"],
        "requested_delivery_date": first["mabd"],
        "origin_plant": first["originPlant"],
    }).encode()
    req = urllib.request.Request(
        "http://localhost:8080/fulfillment/simulate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r2:
        sim = json.loads(r2.read())
        print("\n=== /fulfillment/simulate ===")
        print(f"  solver_status: {sim.get('meta', {}).get('solver_status')}")
        for s in sim.get("scenarios", []):
            print(f"  - {s['name']} | dcSource={s['dcSource']} | freight=${s['freightCost']:.0f} | fine=${s['fine']:.0f} | net=${s['netImpact']:.0f} | recommended={s['isRecommended']}")
            if s.get("rationale"):
                print(f"    rationale: {s['rationale'][:120]}")

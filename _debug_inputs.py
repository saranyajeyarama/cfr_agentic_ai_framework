"""Debug: check the raw inputs to the LP optimizer."""
import json
from agent_tools import get_network_inventory, get_customer_penalty_profile

print("=== INVENTORY for 70010405 (Amazon, sold_to=1000002) ===")
inv = get_network_inventory(material_number="70010405", sold_to="1000002")
for r in inv.get("rows", []):
    print(f"  {r['plant_code']}: ending={r.get('ending')}, committed={r.get('committed')}, available={r.get('available')}")
print(f"  total_rows: {len(inv.get('rows', []))}")

print("\n=== INVENTORY for 70010203 (Walmart, sold_to=1000001) ===")
inv2 = get_network_inventory(material_number="70010203", sold_to="1000001")
for r in inv2.get("rows", []):
    print(f"  {r['plant_code']}: ending={r.get('ending')}, committed={r.get('committed')}, available={r.get('available')}")
print(f"  total_rows: {len(inv2.get('rows', []))}")

print("\n=== PENALTY PROFILE for Amazon (1000002) ===")
pen = get_customer_penalty_profile(sold_to="1000002")
print(json.dumps(pen, indent=2, default=str))

print("\n=== PENALTY PROFILE for Walmart (1000001) ===")
pen2 = get_customer_penalty_profile(sold_to="1000001")
print(json.dumps(pen2, indent=2, default=str))

# Check freight costs config
print("\n=== FREIGHT COSTS CONFIG ===")
try:
    with open("/app/config/freight_costs.json") as f:
        fc = json.load(f)
    print(json.dumps(fc, indent=2))
except Exception as e:
    print(f"Error loading freight config: {e}")
    # Check what optimize() sees
    from fulfillment_optimizer import _load_freight_costs
    print("Loaded from module:", json.dumps(_load_freight_costs(), indent=2))

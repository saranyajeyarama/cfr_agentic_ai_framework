"""
Checkpoint script: pull real data from BigQuery and save to checkpoint.json.

Usage (from repo root):
  $env:GOOGLE_APPLICATION_CREDENTIALS = "backend\resilience-riskradar-2c010597a83b.json"
  $env:PROJECT_ID = "resilience-riskradar"
  cd backend
  python generate_checkpoint.py

The output is saved to backend/checkpoint.json. Open it to verify
BigQuery data is coming in correctly before wiring the frontend.
"""

import json
import logging
import os
import sys

# Add orchestrator_service to path so data_pipeline can import cleanly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "code", "orchestrator_service"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "code"))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

from data_pipeline import fetch_dashboard_data

OUTPUT = os.path.join(os.path.dirname(__file__), "checkpoint.json")


def main() -> None:
    print("Fetching dashboard data from BigQuery...")
    data = fetch_dashboard_data()

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"\nCheckpoint saved → {OUTPUT}")
    print(f"\nSummary:")
    print(f"  globalKPIs.networkCFR          : {data['globalKPIs'].get('networkCFR')}%")
    print(f"  globalKPIs.otifFinesAtRisk7Day  : ${data['globalKPIs'].get('otifFinesAtRisk7Day', 0):,}")
    print(f"  alerts                          : {len(data['alerts'])} items")
    print(f"  networkNodes                    : {len(data['networkNodes'])} nodes")
    print(f"  purchaseOrders                  : {len(data['purchaseOrders'])} orders")
    print(f"  fulfillmentIncidents            : {len(data['fulfillmentIncidents'])} incidents")
    print(f"  safetyStockRecommendations      : {len(data['safetyStockRecommendations'])} SKUs")
    print(f"  decisionCaptureLog              : {len(data['decisionCaptureLog'])} entries")
    print(f"\nOpen backend/checkpoint.json to inspect the full output.")


if __name__ == "__main__":
    main()

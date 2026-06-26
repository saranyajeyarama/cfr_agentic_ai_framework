#!/usr/bin/env bash
# Thin wrapper for driver.py (the platform-selectable deployment driver).
# Usage: bash driver.sh --platform local|gcp|databricks [--map --source ...] [--smoke] [--dry-run]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${PYTHON:-python3}"
exec "$PY" "$HERE/driver.py" "$@"

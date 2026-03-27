#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[FAISS] Checking Python dependencies..."
pip install -q -r requirements.txt

FAISS_PORT="${FAISS_PORT:-8000}"
echo "[FAISS] Starting TRION FAISS Intelligence Engine on port ${FAISS_PORT}..."
exec python faiss_service.py

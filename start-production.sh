#!/usr/bin/env bash
set -e

echo "[TRION] ============================================"
echo "[TRION]  TRION Protocol — Production Startup"
echo "[TRION] ============================================"

echo "[TRION] Starting Rust L0 daemon (Arbitrum Mainnet)..."
./trion-l0/target/release/trion-l0 &
DAEMON_PID=$!
echo "[TRION] L0 Daemon PID: $DAEMON_PID"

echo "[TRION] Starting API + dashboard server on :8080..."
NODE_ENV=production node artifacts/api-server/dist/index.cjs &
SERVER_PID=$!
echo "[TRION] API Server PID: $SERVER_PID"

echo "[TRION] Starting Relayer (Arbitrum Sepolia Oracle)..."
node artifacts/api-server/dist/relayer.cjs &
RELAYER_PID=$!
echo "[TRION] Relayer PID: $RELAYER_PID"

echo "[TRION] All systems nominal. Monitoring..."

trap "echo '[TRION] Shutting down gracefully...'; kill $DAEMON_PID $SERVER_PID $RELAYER_PID 2>/dev/null" EXIT INT TERM

wait $SERVER_PID

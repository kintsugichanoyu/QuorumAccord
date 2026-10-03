#!/usr/bin/env bash
# Daemon-based happy-path run: launches the real producer/consumer binaries
# against the mock-oracle data source, then fetch-verifies the result.
#
# Timings below are generous and approximate (devnet ~0.4s/slot, feed window
# = 300 slots ≈ 120s). For a deterministic, self-timing run instead use:
#     cd workers && cargo run -p e2e -- run-happy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -f "$ROOT/.env.devnet" ]] || { echo "missing .env.devnet — run 00_deploy.sh first"; exit 1; }
set -a; source "$ROOT/.env.devnet"; set +a

cd "$ROOT/workers"
echo "==> build binaries"
cargo build --release -p e2e -p producer -p consumer
BIN="$ROOT/workers/target/release"

echo "==> e2e setup (registry, operators, feeds, alloc-state, mocks + seed values)"
"$BIN/e2e" setup

PIDS=()
cleanup() { kill "${PIDS[@]}" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> launch producers (3 operators per feed)"
while read -r pool data _mock_id mock_pda _venue _role; do
  for op in 1 2 3; do
    POOL_ID="$pool" DATA_ID="$data" TARGET_ACCOUNT="$mock_pda" \
      OFFSET=8 SCALE_NUM=1 SCALE_DEN=1 POLL_MS=2000 \
      KEYPAIR="$(cat "$ROOT/keys/op$op.json")" \
      "$BIN/producer" >/dev/null 2>&1 &
    PIDS+=($!)
  done
done < <("$BIN/e2e" print-feeds)
echo "   ${#PIDS[@]} producer daemons up"

echo "==> waiting ~180s for producers to finalize a first sample window"
sleep 180

echo "==> open allocation round"
"$BIN/e2e" open-round

echo "==> launch 2 consumers"
FEEDS_JSON="$("$BIN/e2e" consumer-feeds)"
for op in 1 2; do
  FEEDS="$FEEDS_JSON" POLL_MS=5000 KEYPAIR="$(cat "$ROOT/keys/op$op.json")" \
    "$BIN/consumer" >/dev/null 2>&1 &
  PIDS+=($!)
done

echo "==> waiting ~150s for the allocation round to close"
sleep 150

echo "==> crank finalize_allocation"
"$BIN/e2e" crank-alloc || true

cleanup; trap - EXIT

echo "==> verify"
"$BIN/e2e" verify

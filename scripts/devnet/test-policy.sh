#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
for task_bin in "$HOME"/.nvm/versions/node/*/bin "$HOME/.local/share/reflect-toolchains/solana-release/bin"; do
  [[ ! -d "$task_bin" ]] || export PATH="$task_bin:$PATH"
done
mkdir -p deployment/devnet/.state/tests
python3 - <<'PYPORT'
import socket
with socket.socket() as s:
 try:s.bind(('127.0.0.1',18899))
 except OSError:raise SystemExit('Port 18899 is occupied; stop the previous local validator first.')
PYPORT
task_dir="$(mktemp -d "$root/deployment/devnet/.state/tests/run.XXXXXX")"
solana-keygen new --no-bip39-passphrase --silent --outfile "$task_dir/admin.json" >/dev/null
export TEST_ADMIN="$task_dir/admin.json" TEST_RESULTS="${TEST_RESULTS:-$task_dir/results.json}"
task_admin="$(solana-keygen pubkey "$TEST_ADMIN")"
python3 - "$task_dir" "$task_admin" "$root" <<'PY' > "$task_dir/validator.log" 2>&1 &
import os,sys,shutil
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:4])
args=[shutil.which('solana-test-validator'),'--ledger',sys.argv[1]+'/ledger','--upgradeable-program','DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz',sys.argv[3]+'/target/deploy/quorum_allocation.so',sys.argv[2],'--rpc-port','18899','--gossip-port','18910','--dynamic-port-range','18911-18960','--faucet-port','18901','--ticks-per-slot','16','--limit-blockstore-size','1000000','--quiet']
os.execv(args[0],args)
PY
task_pid=$!
trap 'kill -TERM "$task_pid" 2>/dev/null || true' EXIT
for task_i in {1..120}; do
  kill -0 "$task_pid" 2>/dev/null || { cat "$task_dir/validator.log" >&2; exit 1; }
  if curl -s -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://127.0.0.1:18899 | rg -q '"ok"'; then break; fi
  sleep 1
done
node deployment/devnet/tests/onchain-v2.mjs
printf 'Evidence: %s\n' "$TEST_RESULTS"

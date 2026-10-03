#!/usr/bin/env bash
# Compatibility entry point; deterministic signed integration tests replace the
# old wall-clock sleeps and unmanaged production daemon fleet.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec python3 "$ROOT/testing/devnet/run.py" --network devnet --legacy-allocation "$@"

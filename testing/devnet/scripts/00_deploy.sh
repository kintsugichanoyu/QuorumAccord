#!/usr/bin/env bash
# Compatibility entry point: the isolated runner owns funding/deployment/tests.
# It does not change global CLI config or write a root .env.devnet file.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec python3 "$ROOT/testing/devnet/run.py" --network devnet --legacy-allocation "$@"

#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$task_root"
watch -n 2 'sudo -n docker compose -f deployment/devnet/compose.yaml ps'

#!/usr/bin/env bash
# A startup check only: never connects to RPC or supplies a signing key.
set -euo pipefail
image="${1:-quorum-workers:local}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

for binary in quorum-producer quorum-consumer; do
  status=0
  docker run --rm --network none --entrypoint "/usr/local/bin/$binary" "$image" > "$log" 2>&1 || status=$?
  if [[ "$status" != 1 || "$(cat "$log")" != *'SOLANA_RPC_URL not set'* ]]; then
    cat "$log"
    printf '%s failed its missing-configuration startup check (exit %s)\n' "$binary" "$status" >&2
    exit 1
  fi
  printf '%s starts and rejects missing configuration\n' "$binary"
done

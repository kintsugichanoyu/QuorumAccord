#!/usr/bin/env bash
set -euo pipefail
umask 077
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$task_root"
# Discover tools used by the repository without changing global CLI configuration.
export PATH="$HOME/.cargo/bin:$PATH"
for task_bin in "$HOME"/.nvm/versions/node/*/bin; do
  if [[ -x "$task_bin/node" ]]; then export PATH="$task_bin:$PATH"; fi
done
for task_bin in "$HOME/.local/share/solana/install/active_release/bin" "$HOME/.local/share/quorum-toolchains/solana-release/bin" "$HOME/.local/share/reflect-toolchains/solana-release/bin"; do
  if [[ -x "$task_bin/solana" ]]; then export PATH="$task_bin:$PATH"; break; fi
done
# Node reads .env without shell-evaluating its contents.
task_env=()
task_compose_env=()
if [[ -f deployment/devnet/.env ]]; then task_env=(--env-file=deployment/devnet/.env); task_compose_env=(--env-file deployment/devnet/.env); fi
export FLEET_UID="${FLEET_UID:-$(id -u)}" FLEET_GID="${FLEET_GID:-$(id -g)}"
for task_tool in node npm solana cargo-build-sbf docker; do command -v "$task_tool" >/dev/null || { echo "Missing tool: $task_tool" >&2; exit 1; }; done
task_docker=(docker)
if ! docker info >/dev/null 2>&1; then task_docker=(sudo -n docker); fi
"${task_docker[@]}" info >/dev/null
npm --prefix testing/devnet ci --no-audit --no-fund
npm --prefix testing/devnet run build
npm --prefix deployment/devnet ci --no-audit --no-fund
mkdir -p deployment/devnet/.state
if [[ "${SKIP_BUILD:-0}" != 1 ]]; then cargo-build-sbf --arch v3 --manifest-path programs/quorum-allocation/Cargo.toml; fi
npm --prefix sdk ci --no-audit --no-fund
npm --prefix sdk run idl
npm --prefix sdk run build
npm --prefix demo-site ci --no-audit --no-fund
npm --prefix demo-site run build
if [[ "${SKIP_DEPLOY:-0}" != 1 ]]; then
  node "${task_env[@]}" deployment/devnet/deploy.mjs
fi
node "${task_env[@]}" deployment/devnet/setup.mjs
node "${task_env[@]}" deployment/devnet/env.mjs
"${task_docker[@]}" compose "${task_compose_env[@]}" -f deployment/devnet/compose.yaml up --build --force-recreate --detach --remove-orphans --wait --wait-timeout 240
node "${task_env[@]}" deployment/devnet/start-fleet-monitor.mjs
node "${task_env[@]}" deployment/devnet/observe-v2.mjs
node "${task_env[@]}" deployment/devnet/audit-v2.mjs
node "${task_env[@]}" deployment/devnet/walkthrough.mjs
node "${task_env[@]}" deployment/devnet/pitch.mjs
"${task_docker[@]}" compose "${task_compose_env[@]}" -f deployment/devnet/compose.yaml ps
echo "Interactive demo: http://localhost:${FLEET_WEB_PORT:-18880}"
echo "Pitch deck: http://localhost:${FLEET_WEB_PORT:-18880}/pitch.html"
echo "Nine producers, three consumers, coordinator, RPC gateway and demo remain running."

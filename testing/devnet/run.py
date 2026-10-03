#!/usr/bin/env python3
"""Build, fund, deploy and test the real program on localnet or Solana devnet.

All generated keys, ledgers and raw evidence stay in ignored .state/. The mock
backend and provider processes never enter the production daemon fleet.
"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
LAB = ROOT / "testing/devnet"
STATE = LAB / ".state"
DEVNET = "https://api.devnet.solana.com"
DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"


def rpc(url, method, params=None):
    request = Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode(),
                      {"Content-Type": "application/json"})
    with urlopen(request, timeout=20) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(f"{method}: {result['error']}")
    return result["result"]


def command(args, env, *, capture=False):
    print("+ " + " ".join(map(str, args)), file=sys.stderr, flush=True)
    return subprocess.run(list(map(str, args)), cwd=ROOT, env=env, check=True,
                          text=True, capture_output=capture)


def find_tools():
    env = os.environ.copy()
    for path in [Path.home() / ".local/share/solana/install/active_release/bin",
                 Path.home() / ".local/share/reflect-toolchains/solana-release/bin"]:
        if (path / "solana").is_file():
            env["PATH"] = str(path) + os.pathsep + env["PATH"]
            break
    for name in ["solana", "solana-keygen", "cargo-build-sbf", "cargo"]:
        if not shutil.which(name, path=env["PATH"]):
            raise RuntimeError(f"missing {name}; see testing/devnet/README.md")
    return env


def prepare_keys(env):
    directory = STATE / "keys"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    paths = {}
    for name in ["admin", "op1", "op2", "op3", "outsider", "program", "mock-program", "program-buffer", "mock-buffer"]:
        path = directory / f"{name}.json"
        if not path.exists():
            command(["solana-keygen", "new", "--no-bip39-passphrase", "--silent", "-o", path], env, capture=True)
        path.chmod(0o600)
        paths[name] = path
    return paths


def public_key(path, env):
    return command(["solana-keygen", "pubkey", path], env, capture=True).stdout.strip()


def sync_ids(program, mock):
    # Equivalent to Anchor keys sync, confined to the two test deployment IDs.
    for path, address in [(ROOT / "programs/reflect-allocation/src/lib.rs", program),
                          (LAB / "programs/mock-oracle/src/lib.rs", mock)]:
        text = path.read_text()
        updated = re.sub(r'declare_id!\("[^"]+"\);', f'declare_id!("{address}");', text)
        if updated != text:
            path.write_text(updated)
    path = ROOT / "Anchor.toml"
    text = path.read_text()
    for name, address in [("reflect_allocation", program), ("mock_oracle", mock)]:
        text = re.sub(rf'{name} = "[^"]+"', f'{name} = "{address}"', text)
    if text != path.read_text():
        path.write_text(text)


def wait_http(url, process, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"process exited before {url} became available")
        try:
            with urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (URLError, OSError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url}")


def fund(url, address, key, env, network):
    target = 5_000_000_000
    balance = rpc(url, "getBalance", [address, {"commitment": "confirmed"}])["value"]
    if balance >= target:
        return {"starting_lamports": balance, "airdrop": "not needed"}
    amount = "10" if network == "localnet" else "2"
    attempt = subprocess.run(["solana", "airdrop", amount, "--url", url, "--keypair", str(key), "--commitment", "confirmed"],
                             env=env, text=True, capture_output=True, timeout=90)
    balance = rpc(url, "getBalance", [address, {"commitment": "confirmed"}])["value"]
    evidence = {"balance_lamports": balance, "airdrop_exit_code": attempt.returncode,
                "airdrop_stdout": attempt.stdout.strip(), "airdrop_stderr": attempt.stderr.strip()}
    if balance < target:
        if network == "localnet":
            raise RuntimeError(f"localnet funding failed for {address}: {evidence}")
        raise RuntimeError(f"devnet funding unavailable: wallet {address} has {balance / 1e9} SOL; "
                           f"fund it with about 5 devnet SOL at https://faucet.solana.com/ and rerun. Evidence: {evidence}")
    return evidence


def deployment_capacity(url, binary, buffer_address):
    # A resumed buffer can be a few bytes larger than a rebuilt ELF. The loader
    # requires ProgramData capacity >= the entire buffer, not only the new ELF.
    account = rpc(url, "getAccountInfo", [buffer_address, {"encoding": "base64", "commitment": "confirmed"}])["value"]
    buffer_size = max(0, account["space"] - 37) if account else 0
    required = max(binary.stat().st_size, buffer_size)
    return ((required + 65535) // 65536) * 65536


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", choices=["devnet", "localnet"], default="devnet")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--skip-deploy", action="store_true")
    parser.add_argument("--legacy-allocation", action="store_true", help="also run existing allocation happy path and brake/trigger invariants")
    parser.add_argument("--window-slots", type=int, default=120)
    parser.add_argument("--sbf-arch", choices=["v0", "v1", "v2", "v3"], default="v3",
                        help="Agave 4.3 local validator enables SIMD-0500; use v3 (ABIv1)")
    parser.add_argument("--backend-port", type=int, default=18787)
    parser.add_argument("--local-ledger", type=Path, help="optional dedicated local ledger path; never reset")
    args = parser.parse_args()
    os.umask(0o077)
    env = find_tools()
    network_state = STATE / args.network
    network_state.mkdir(parents=True, exist_ok=True)
    processes = []
    handles = []
    report = {"status": "started", "network": args.network}
    try:
        keys = prepare_keys(env)
        program = public_key(keys["program"], env)
        mock = public_key(keys["mock-program"], env)
        admin = public_key(keys["admin"], env)
        url = DEVNET if args.network == "devnet" else "http://127.0.0.1:8899"
        backend = f"http://127.0.0.1:{args.backend_port}"
        config = {"network": args.network, "rpc_url": url, "program_id": program, "backend_url": backend,
                  "admin_keypair": str(keys["admin"]), "operator_keypairs": [str(keys[f"op{i}"]) for i in [1,2,3]],
                  "outsider_keypair": str(keys["outsider"]), "window_slots": args.window_slots,
                  "assets": [{"symbol": symbol, "pool_id": 160+i, "data_id": 240, "base_price_micro_usd": price}
                             for i, (symbol, price) in enumerate([("SOL",198_250_000),("BTC",64_000_000_000),("ETH",3_200_000_000)])]}
        config_path = network_state / "config.json"
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        env["LAB_CONFIG"] = str(config_path)
        report.update({"program": program, "mock_program": mock, "admin": admin, "rpc": url})
        if not args.skip_build:
            sync_ids(program, mock)
            command(["cargo-build-sbf", "--arch", args.sbf_arch, "--manifest-path", ROOT / "programs/reflect-allocation/Cargo.toml"], env)
            if args.legacy_allocation:
                command(["cargo-build-sbf", "--arch", args.sbf_arch, "--manifest-path", LAB / "programs/mock-oracle/Cargo.toml"], env)
            command(["cargo", "build", "--manifest-path", ROOT / "workers/Cargo.toml", "--locked", "-p", "devnet-price-lab", "-p", "e2e"], env)
        if args.network == "localnet":
            # Never reset an existing ledger. Keep this test-owned validator in
            # its own ignored directory and stop only the child we started.
            try:
                rpc(url, "getHealth")
            except (RuntimeError, URLError, OSError):
                log = open(network_state / "validator.log", "w")
                handles.append(log)
                ledger = args.local_ledger or network_state / "ledger"
                validator = subprocess.Popen(["solana-test-validator", "--quiet", "--ledger", str(ledger),
                                               "--rpc-port", "8899", "--faucet-port", "9900"], env=env, stdout=log, stderr=log)
                processes.append(validator)
                wait_http(url + "/health", validator)
                # /health can succeed while the initial/replayed bank is still
                # at genesis. Wait for a rooted slot before funding or decoding
                # existing accounts; otherwise the faucet may sign a duplicate
                # transaction against the genesis blockhash.
                deadline = time.monotonic() + 90
                starting_slot = rpc(url, "getSlot", [{"commitment": "confirmed"}])
                while (rpc(url, "getSlot", [{"commitment": "finalized"}]) == 0
                       or rpc(url, "getSlot", [{"commitment": "confirmed"}]) < starting_slot + 32):
                    if time.monotonic() >= deadline or validator.poll() is not None:
                        raise RuntimeError("local validator did not produce a rooted slot")
                    time.sleep(0.5)
        genesis = rpc(url, "getGenesisHash")
        if args.network == "devnet" and genesis != DEVNET_GENESIS:
            raise RuntimeError("refusing non-devnet RPC")
        report["genesis"] = genesis
        report["funding"] = fund(url, admin, keys["admin"], env, args.network)
        if not args.skip_deploy:
            binary = ROOT / "target/deploy/reflect_allocation.so"
            capacity = deployment_capacity(url, binary, public_key(keys["program-buffer"], env))
            result = command(["solana", "program", "deploy", binary, "--url", url,
                              "--keypair", keys["admin"], "--program-id", keys["program"], "--buffer", keys["program-buffer"],
                              "--max-len", capacity, "--use-rpc", "--commitment", "confirmed", "--output", "json"], env, capture=True)
            report["deployment"] = json.loads(result.stdout)
            if args.legacy_allocation:
                binary = ROOT / "target/deploy/mock_oracle.so"
                capacity = deployment_capacity(url, binary, public_key(keys["mock-buffer"], env))
                result = command(["solana", "program", "deploy", binary, "--url", url,
                                  "--keypair", keys["admin"], "--program-id", keys["mock-program"], "--buffer", keys["mock-buffer"],
                                  "--max-len", capacity, "--use-rpc", "--commitment", "confirmed", "--output", "json"], env, capture=True)
                report["mock_deployment"] = json.loads(result.stdout)
        log = open(network_state / "backend.log", "w")
        handles.append(log)
        backend_process = subprocess.Popen([sys.executable, str(LAB / "backend/server.py"), "--port", str(args.backend_port)], stdout=log, stderr=log)
        processes.append(backend_process)
        wait_http(backend + "/health", backend_process)
        binary = ROOT / "workers/target/debug/devnet-price-lab"
        with open(network_state / "suite.json", "w") as output, open(network_state / "suite.stderr.log", "w") as errors:
            result = subprocess.run([str(binary), "suite"], cwd=ROOT, env=env, stdout=output, stderr=errors)
        if result.returncode:
            raise RuntimeError("price suite failed: " + (network_state / "suite.stderr.log").read_text())
        report["price_suite"] = json.loads((network_state / "suite.json").read_text())
        if args.legacy_allocation:
            env.update({"SOLANA_RPC_URL": url, "PROGRAM_ID": program, "MOCK_PROGRAM_ID": mock,
                        "ADMIN_KEYPAIR": str(keys["admin"]), "OP_KEYPAIRS": ",".join(str(keys[f"op{i}"]) for i in [1,2,3]),
                        "OUTSIDER_KEYPAIR": str(keys["outsider"]), "ROUND": str(rpc(url, "getSlot") + 100),
                        "STALENESS_SLOTS": "1000000", "RUST_LOG": "info"})
            if args.network == "localnet":
                env["E2E_WINDOW_SLOTS"] = "60"
            for scenario in ["run-happy", "run-invariants"]:
                result = command([ROOT / "workers/target/debug/e2e", scenario], env, capture=True)
                (network_state / f"{scenario}.log").write_text(result.stdout + result.stderr)
                report[scenario] = "passed"
        report["ending_balance_lamports"] = rpc(url, "getBalance", [admin])["value"]
        report["status"] = "passed"
        print(json.dumps(report, indent=2))
        return 0
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired, URLError, OSError) as error:
        report["status"] = "blocked" if "funding unavailable" in str(error) else "failed"
        report["error"] = str(error)
        if isinstance(error, subprocess.CalledProcessError):
            report["stdout"] = error.stdout
            report["stderr"] = error.stderr
        print(json.dumps(report, indent=2))
        return 2
    finally:
        (network_state / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for handle in handles:
            handle.close()


if __name__ == "__main__":
    sys.exit(main())

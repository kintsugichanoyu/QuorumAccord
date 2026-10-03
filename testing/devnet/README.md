# Test-only protocol and price lab

Everything in this directory is for localnet/devnet verification. The backend
returns invented, deterministic USD prices, not real market data. Production
program logic remains in `programs/reflect-allocation/`; production account
drivers and allocation consumers remain in `workers/`.

```
backend/server.py  (atlas / boreal / cygnus mock protocol APIs)
     │ three separate HTTP callers + three independent Solana signing keys
     ▼
price-lab provide → production propose/corroborate_sample instructions
     ▼
DataFeedConsensus (3-of-3, median) → production finalize_sample → DataFeed ring
     ▼
price-lab consume/watch (chain reads only; integer millionths of USD)
```

There is one centralized fixture backend; separate provider processes and keys
do not make its data independent. The outlier scenario proves median behavior
with two honest providers and one bad provider, not resistance to a bad majority.
The prices are separate metrics, not APY inputs to the financial allocation rubric.

## Requirements

- Rust 1.88 or newer (tested with host Rust 1.96).
- Solana CLI / `cargo-build-sbf` / `solana-test-validator` (tested with Agave 4.3.0,
  platform-tools v1.57); the Rust program uses Anchor 1.0.2.
- A C compiler, pkg-config, OpenSSL/udev development headers and protobuf compiler.
- Python 3. No Python packages, Docker, Anchor CLI or Node are required by this lab.

Official installation references: [Solana](https://solana.com/docs/intro/installation)
and [Anchor](https://www.anchor-lang.com/docs/installation). A typical Debian setup
needs `build-essential pkg-config libssl-dev libudev-dev protobuf-compiler`.

## Run

From the repository root:

```bash
# Compiles actual SBF programs, starts a test-owned validator, airdrops local SOL,
# deploys, runs the multi-provider suite, then the original allocation scenarios.
python3 testing/devnet/run.py --network localnet --legacy-allocation

# Checks the RPC genesis hash is devnet, requests devnet SOL, deploys and tests.
python3 testing/devnet/run.py --network devnet

# Reuse built artifacts; useful after a faucet refusal has been resolved.
python3 testing/devnet/run.py --network devnet --skip-build

# Unit/HTTP checks without a validator:
cargo test --locked
cargo test --manifest-path workers/Cargo.toml --locked
python3 -m unittest discover -s testing/devnet/backend -v
python3 -m unittest discover -s testing/devnet -p test_run.py -v
```

The runner generates dedicated admin, three operator, outsider and program
keypairs under ignored `.state/keys/`, with restrictive permissions. It synchronizes
the two `declare_id!` values and `Anchor.toml` with these deployment keys, like
`anchor keys sync`. Those public ID edits may appear in Git after a fresh checkout.
No wallet's global CLI configuration is changed and existing ledgers are never reset.
`--local-ledger <path>` chooses a separate local ledger without deleting an old one.
Devnet funding failures produce `status: blocked`, never a successful test result.
The default build is SBPF v3 with the normal ABIv1; Agave 4.3's local feature set
disables new v0/v1/v2 deployments (SIMD-0500). `--sbf-arch` can select an older
format for a cluster with a different feature set. Build artifacts must match
the current keys when using `--skip-build`. Explicit, ignored deployment buffer
keys prevent the CLI from printing an ephemeral recovery seed on failure.
See the [Agave feature definitions](https://github.com/anza-xyz/agave/blob/v4.3.0/feature-set/src/lib.rs)
for the deployment-version gate.
The backend defaults to port 18787 (`--backend-port` overrides it). Operators are
funded from the test admin and topped up before price windows to cover round rent.
The devnet CLI requests 2 SOL once; if the balance is insufficient, the runner
stops and reports the wallet and funding evidence instead of repeatedly hitting
the public faucet.

## Standalone providers and price consumer

The runner writes `.state/<network>/config.json`. Keep the configured RPC running.

```bash
export LAB_CONFIG="$PWD/testing/devnet/.state/devnet/config.json"
workers/target/debug/devnet-price-lab consume
workers/target/debug/devnet-price-lab watch

# With backend/server.py running, submit operator index 0, 1 or 2 in the chosen
# chain-derived window floor(current_slot / config.window_slots).
workers/target/debug/devnet-price-lab provide 0 <window_index>
```

The consumer returns source PDAs, ticks, finalized window slots and actual RPC
context slots. It verifies account ownership, discriminator, ring bounds and
freshness. It never calls the backend and it does not claim a coherent allocation
snapshot across independently updating feeds.

## Scenarios and evidence

The price suite launches three separate provider processes, queries all three
mock HTTP protocol APIs, checks their request counters, confirms transactions,
finalizes on chain and executes a separate price consumer process.

1. Baseline: SOL $198.25, BTC $64,000, ETH $3,200; three votes publish the median.
2. Missing quorum: two of three providers submit; prior published prices remain.
3. Dishonest outlier: Cygnus reports 10x; median remains the two honest prices.
4. Price change: all sources update by 10%; rings and consumer advance exactly once.
5. Backend outage: Cygnus returns HTTP 503; it submits nothing and prices do not advance.
6. Exact custom-error checks: outsider registry bootstrap, zero/65 quorum,
   duplicate sample votes, unauthorized votes and premature sample finalization.
7. Allocation checks: publish mean weights with rounding, preserve excluded zero
   venues, reject zero/65 quorum and reject an older allocation after a newer one.
8. Sample ordering: defer a full-quorum window, finalize a later window, then
   require exact stale-round rejection for the older window on all three assets.

`--legacy-allocation` additionally deploys `testing/devnet/programs/mock-oracle/`, exercises the
five-venue allocation golden vector and quorum/brake/no-trigger/forced-refresh/
unauthorized sample scenarios using `allocation-e2e/`.

Generated config, logs, validator ledger, transaction signatures and machine-readable
results live under ignored `.state/<network>/`. See [RESULTS.md](RESULTS.md) for the
checked-in run summary and [../../OPEN_QUESTIONS.md](../../OPEN_QUESTIONS.md) for
remaining work.

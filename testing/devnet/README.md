# TypeScript protocol and price tests

All off-chain test code in this directory is TypeScript: the HTTP mock backend,
providers, consumer, deployment runner, unit tests and integration assertions.
The production Solana program and workers remain Rust. The small Rust
`programs/mock-oracle/` program is an on-chain fixture, not a Rust test harness.

```text
TypeScript backend (Atlas / Boreal / Cygnus invented protocol APIs)
    → three separate TypeScript provider processes / independent signing keys
    → production propose/corroborate_sample → on-chain median consensus / feeds
    → standalone TypeScript consumer (chain reads only, no signing keys)
```

One centralized fixture backend serves all providers. Separate signing processes
do not establish independent source truth. Prices are invented USD values, not
real market data or APY inputs to the financial allocation rubric.

## Setup and run

Node >=22.12 and npm are required (tested with Node 24.16.0, TypeScript 5.9.3).
For validator execution, install Solana CLI, cargo-build-sbf and
solana-test-validator; tested with Agave 4.3.0/platform-tools v1.57 and Anchor
1.0.2 in the Rust program. Anchor CLI, Python and compiled Rust workers are not
required by the test workflow.

From the repository root:

```bash
npm --prefix testing/devnet ci
npm --prefix testing/devnet test                # 36 TypeScript unit/HTTP tests
npm --prefix testing/devnet run localnet        # builds SBF; full integration
npm --prefix testing/devnet run devnet          # same tests on public devnet

# Reuse matching SBF artifacts:
npm --prefix testing/devnet run localnet -- --skip-build
npm --prefix testing/devnet run devnet -- --skip-build

# Price/consensus checks only, without the account-fixture allocation scenarios:
npm --prefix testing/devnet run localnet -- --prices-only

# A separate fresh ledger; relative paths are resolved from the repository root:
npm --prefix testing/devnet run localnet -- --local-ledger testing/devnet/.state/localnet/my-ledger
```

The runner creates ignored test keys in `.state/keys/` with restrictive
permissions. It synchronizes public program IDs before SBF builds, verifies the
devnet genesis hash, requests test SOL and funds provider account rent from the
test admin. It never changes global Solana CLI configuration or resets/deletes
existing ledgers. It stops only services it started.

The default build is SBPF v3, normal ABIv1, because Agave 4.3's local feature set
disables new v0/v1/v2 deployments. See the
[Agave feature definitions](https://github.com/anza-xyz/agave/blob/v4.3.0/feature-set/src/lib.rs).
Explicit ignored deployment buffer keys prevent the CLI from printing recovery
seeds on failure; resumed-buffer capacity is checked before deployment.

The full fresh devnet run targets about 8 devnet SOL; `--prices-only` targets 5.
With `--skip-deploy`, verified existing programs need 4 or 2 devnet SOL respectively.
The CLI requests 2 SOL once. If funding is refused or insufficient, the runner
records `blocked` and stops before deployment. It does not claim a test pass.
The backend defaults to loopback port 18787 (`--backend-port` overrides it).

Devnet deployment defaults to TPU (`--deploy-transport tpu`); localnet defaults
to RPC. `--deploy-transport rpc` remains available explicitly. The public RPC
failed bulk upload with retries exhausted; resuming the same buffer over TPU
deployed both programs. All test HTTP RPC calls share a loopback pacing gateway,
with bounded 429/503 retries and unchanged upstream bodies/responses. Network
identity is verified through the gateway too; it is not a fake RPC server.

Devnet price windows default to 240 slots. The ten-feed allocation fixture uses
600-slot windows and batches at most five vote instructions into each transaction;
it still records all ten feeds and two matching operator submissions. Single-feed
invariants use 120-slot windows. Localnet behavior is unchanged. The full suite's
timeout is 40 minutes to accommodate public-network latency.

The private npm package pins its dependencies and lockfile. A test-only
Jayson 5 override avoids the older transitive UUID/stream-json advisories.
Its RPC compatibility is exercised by the integration tests.

## Standalone providers and consumer

Keep the configured RPC and backend running. The runner writes
`.state/<network>/config.json`; set `LAB_CONFIG` to its absolute path.

```bash
export LAB_CONFIG="$PWD/testing/devnet/.state/localnet/config.json"
npm --prefix testing/devnet run consume
npm --prefix testing/devnet run watch
npm --prefix testing/devnet run backend

# After npm run build, operator index 0, 1 or 2 in the current chain-derived window:
node testing/devnet/dist/src/cli.js provide 0 <window_index>
```

The consumer needs no existing signing files. It verifies owner, discriminator,
feed identity, ring bounds and freshness, and reports actual RPC context slots.
Every u64 value is a `bigint` internally and a decimal string in JSON, avoiding
JavaScript number precision loss. Price units are six decimal places.
The runner stops its pacing gateway and restores the direct RPC URL in the saved
configuration afterward. The final stale-price test deliberately leaves prices
old; a subsequent standalone consumer can therefore correctly reject them.

To run the TypeScript integration tests against an already deployed cluster and
running backend without orchestration:

```bash
LAB_ALLOCATION=1 npm --prefix testing/devnet run test:integration
```

Set `LAB_REPORT` to an output JSON path to retain suite evidence. Production
allocation snapshots are not yet coherent historical snapshots: RPC
`minContextSlot` is only a freshness lower bound.

## Covered scenarios

The Node test runner executes the assertions directly in TypeScript:

- Fresh registry bootstrap authority and zero/65 quorum rejection.
- Three providers publish SOL $198.25, BTC $64,000 and ETH $3,200.
- Two providers cannot reach quorum; a 10× outlier does not change the median.
- A 10% price update advances every feed and the standalone consumer.
- HTTP 503 prevents the affected provider from submitting.
- Duplicate/unauthorized votes and early finalization return exact program errors.
- Consumers work with nonexistent signing files and make no backend calls.
- Older full-quorum sample windows and allocation rounds cannot overwrite newer results.
- Mean allocation rounding preserves excluded zeros.
- Ten mock APY/CRR accounts, independently computed golden weights and two matching submissions.
- Quorum misses, brakes, no-trigger windows, forced refresh and unauthorized openers.
- Stale published prices are rejected without backend calls.

[RESULTS.md](RESULTS.md) records actual execution, including public devnet funding
limitations. [OPEN_QUESTIONS.md](../../OPEN_QUESTIONS.md) records unresolved design
and production work. The superseded Python and Rust off-chain harnesses are
removed; their history and prior evidence remain in Git.

The [mdBook integration frontend](../../docs/book/README.md) documents protocol
adapter gaps and offers a separately tested read-only browser devnet inspector.
Its builder reads only committed public evidence, never the test wallet files.

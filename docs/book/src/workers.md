# Integrate Quorum workers

Quorum's on-chain program, producer, allocation consumer, and integer rubric are
Rust. TypeScript supports browser interactions, SDK generation, and the isolated
integration lab. Production workers run outside the browser.

## Build the Rust workspace

Run from the repository root, using Rust and the native build dependencies
`pkg-config`, OpenSSL development headers, libudev development headers, and
`protobuf-compiler` (the worker image in `docker/Dockerfile` installs
these on Debian).

```bash
cargo build --manifest-path workers/Cargo.toml --release --locked
```

This produces `workers/target/release/quorum-producer` and
`workers/target/release/quorum-consumer`. The shared crates are
`quorum-worker-core` and `quorum-rubric`.

## Prepare the deployment and operators

Before starting a worker, an authorized administrator must initialize the
registry, add the operator's public key, and initialize the assigned data feed.
Registry initialization requires the deployed program's upgrade authority. Each
operator needs its own funded signing keypair; changing an environment variable
does not register an operator on chain.

Use `quorum_worker_core::ix::{init_registry, add_operator, init_data_feed}` in a
Rust admin client, or the [SDK generation scaffold](sdk.md).
The Rust instruction builders accept the deployed program ID and administrator
public key; sign and submit them with
`quorum_worker_core::tx::send_with_retry`. Skip initialization for existing
accounts. Feed configuration uses `ix::DataFeedConfig` and must explicitly set
the units, slot-window width, quorum, aggregation rule, and publication brakes.
See the [instruction contract](contract.md) for authority and PDA details.

All workers require these environment variables:

| Variable | Meaning |
|---|---|
| `SOLANA_RPC_URL` | One RPC endpoint or comma-separated endpoints on the same cluster |
| `PROGRAM_ID` | Public key of the Quorum program deployed on that cluster |
| `KEYPAIR_FILE` | Path to a readable Solana JSON keypair file or mounted Docker secret |
| `KEYPAIR` | Alternative secret as a JSON byte array or base58 value; set exactly one signing source |
| `RUST_LOG` | Optional logging filter, such as `info` |

Configure a readable signer file with `KEYPAIR_FILE`, or load the secret directly
into `KEYPAIR`. Keep it outside source control, the website, and the handbook.
For a local shell, a standard `solana-keygen` JSON file can be used as follows:

```bash
export SOLANA_RPC_URL='https://api.devnet.solana.com'
export PROGRAM_ID='YOUR_DEPLOYED_QUORUM_PROGRAM_PUBLIC_KEY'
unset KEYPAIR
export KEYPAIR_FILE=/absolute/path/to/operator.json
export RUST_LOG=info
```

Replace the program and key-file placeholders before running. Production RPC
reads use `minContextSlot` as a lower bound; they do not provide an exact shared
historical snapshot or establish source provenance.

## Configure a producer

One producer instance serves one `(pool_id, data_id)` feed for one operator.
The implemented driver is `offset_u64`: it reads a little-endian integer at a
configured byte offset and rescales it to the agreed metric units.

| Variable | Meaning / default |
|---|---|
| `DRIVER` | `offset_u64` (the only shipped selector) |
| `POOL_ID`, `DATA_ID` | Required u8 identifiers of the initialized feed |
| `TARGET_ACCOUNT` | Required public key of the source account |
| `OFFSET` | Byte offset of its u64 field; default `0` |
| `SCALE_NUM`, `SCALE_DEN` | Integer scaling numerator / denominator; default `1` / `1` |
| `POLL_MS` | Poll interval in milliseconds; default `2000` |

With the shared configuration above loaded:

```bash
export DRIVER=offset_u64
export POOL_ID=1 DATA_ID=0
export TARGET_ACCOUNT='YOUR_VALIDATED_SOURCE_ACCOUNT_PUBLIC_KEY'
export OFFSET=8 SCALE_NUM=1 SCALE_DEN=1
export POLL_MS=2000
cargo run --manifest-path workers/Cargo.toml --release --locked --bin quorum-producer
```

The account and offset are illustrative. Select a field using the source's exact
schema and define its units before configuring a feed. APY and CRR inputs for the
allocation rubric use basis points; invented price fixtures use micro-USD.
Generic decoding does not validate protocol owner or schema, and its scaling
still has hardening work. See [build a source adapter](integration.md) before
using untrusted source layouts.

The producer derives the current slot window, proposes a sample if consensus is
absent, otherwise corroborates it, and attempts to finalize the previous window.
The program rejects unregistered or duplicate votes. Finalization publishes only
when the quorum, trigger, and brake conditions allow it. Restart recovery and
automatic duplicate avoidance remain MVP limitations.

## Configure a consumer

The allocation consumer maps published APY/CRR feeds to venue indices, computes
integer weights, and submits to an **already opened** allocation round. Register
the consumer signer as an operator too.

| Variable | Meaning / default |
|---|---|
| `FEEDS` | Required JSON array of feed-to-venue mappings |
| `ROUND` | Allocation round ID; default `0` |
| `STALENESS_SLOTS` | Maximum accepted age; default `150000` slots |
| `POLL_MS` | Poll interval; default `5000` milliseconds |

With the shared configuration loaded:

```bash
export FEEDS='[{"pool_id":1,"data_id":0,"venue":0,"role":"apy"},{"pool_id":1,"data_id":1,"venue":0,"role":"crr","cap_bps":10000}]'
export ROUND=0
export STALENESS_SLOTS=150000 POLL_MS=5000
cargo run --manifest-path workers/Cargo.toml --release --locked --bin quorum-consumer
```

This one-venue mapping demonstrates configuration, not a financial methodology.
Each mapping uses `pool_id` and `data_id` as u8 values, `venue` in `0..15`, and
`role` of `apy` or `crr`. Optional `cap_bps` is measured out of 10,000.

Before starting, the administrator must initialize `AllocationState` and open
the selected round using `ix::init_allocation_state` and
`ix::open_allocation_round`. After the closing slot, a separate crank/client
calls `ix::finalize_allocation`. The shipped consumer does **not** discover new
rounds, advance `ROUND`, or finalize allocations itself. Publication goes into
`AllocationState`; no worker moves capital.

Missing-risk handling, coherent snapshots, and cap preservation remain release
blockers. Review [allocation consumers](consumers.md) and
[release blockers](blockers.md) before configuring real financial inputs.

## Integrate your own Rust process

Use path dependencies from an external crate (adjust the paths to your checkout):

```toml
[dependencies]
quorum-worker-core = { path = "../quorum/workers/worker-core" }
quorum-rubric = { path = "../quorum/workers/rubric" }
```

`quorum_worker_core` exposes `config`, `rpc`, `pda`, `ix`, `tx`, `feed_view`,
`anchor_codec`, and `window`. `quorum_rubric` exposes the integer allocation
calculation. Protocol-specific producers implement the `Driver` trait in
`workers/producer/src/driver.rs` and add a selector in `build_driver`; the driver
trait currently lives in the producer binary rather than a public plugin crate.

Keep signing in the worker process. Browser integrations should use the
[read-only inspector](devnet.md) or a read-only client, and TypeScript must use
`bigint` for u64 values and decimal strings for JSON.

## Verify and operate

```bash
cargo test --manifest-path workers/Cargo.toml --locked
npm --prefix testing/devnet ci
npm --prefix testing/devnet test
```

Use the [TypeScript lab](quickstart.md) to exercise the contract with multiple
test operators on localnet or devnet. Its fictional HTTP price providers are
test fixtures, not a substitute for Rust protocol drivers. The lab does not
launch the production Rust daemons or certify their operational lifecycle.

The [GitHub and Docker guide](deployment.md) provides runnable image builds and
producer/consumer Compose profiles, configuration templates, and per-operator
key-file mounts. Configure the source account/offset and register signers before
starting workers. Use independent operator identities and sources for independent votes. Watch for submission
errors, stale feeds, and missed finalizations; a running process alone does not
prove that a value was published.

See [verification and troubleshooting](verification.md) for recorded test
evidence and [rename and compatibility](migration.md) when upgrading an existing
checkout.

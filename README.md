# reflect — decentralised capital allocation

Repurposes Palindrome's single-operator Python allocation pipeline into an
**NCN-shaped** on-chain system: independent **producers** publish per-metric
samples into on-chain ring buffers via consensus, and a **consumer** reads them,
runs the risk rubric, and publishes an allocation weight vector by consensus. No
proprietary endpoints in the production path; the only secret is `SOLANA_RPC_URL`.

- Full brief / data model: [`specs/SPECIFICATION.md`](specs/SPECIFICATION.md)
- Implementation plan & framework rationale: `~/.claude/plans/explore-solana-blockchain-development-fuzzy-rabin.md`
- Framework: **Anchor 1.0.2 + zero-copy** (program); **Rust** (off-chain workers)

## Status at a glance

| Component | State | Verified here |
|---|---|---|
| On-chain program (`programs/reflect-allocation`) | Implemented | ✅ `cargo check` + **12 tests** (aggregation, renormalisation, account layout) |
| Deterministic rubric (`workers/rubric`) | Implemented | ✅ **9 tests** (screen, risk-adj yield, normalise, caps, e2e golden vector) |
| Worker core (`workers/worker-core`) | Implemented | ✅ compiles + **3 tests** (window, codec) |
| Producer + consumer daemons | Implemented | ✅ compile; generic `OffsetU64Driver` decode tested |
| Devnet e2e (`workers/e2e` + `programs/mock-oracle`) | Implemented | ✅ compile; offline helpers + golden vector exercised here, live run needs a cluster |
| Provider SDK (Codama) | Scaffolded | ⚠️ needs `anchor build` IDL (platform tools) |
| Docker fleet + simulations | Scaffolded | ⚠️ needs Docker / BPF build (platform tools) |

**25 tests pass** across both workspaces today. The items marked ⚠️ are written
and documented but need the Solana platform tools / Docker (see *Toolchain*).

## Repo layout

```
programs/reflect-allocation/   Anchor program (one program, 4 account types)
  src/state/                   OperatorRegistry, DataFeed(+Consensus), AllocationConsensus, AllocationState
  src/instructions/            registry, data_feed, sample (propose/corroborate/finalize), allocation
  src/aggregation.rs           integer-only median / trimmed-mean / renormalise (+ unit tests)
programs/mock-oracle/          tiny writable-u64 program: controlled inputs for the devnet e2e
workers/                       separate Rust workspace (off-chain daemons)
  rubric/                      deterministic fixed-point allocation rubric (+ tests)
  worker-core/                 RPC failover, slot-pinned reads, signing, tx retry, ix builders, PDA, feed view
  producer/                    write-only sensor daemon + Driver trait + drivers
  consumer/                    reads all feeds at a shared slot, runs rubric, submits weights
  e2e/                         devnet end-to-end harness: setup, drive, crank, fetch-verify
sdk/                           Codama config -> generated TS/Rust provider clients
docker/                        one image (role/driver by env) + compose for ~10 producers + consumer
scripts/devnet/                deploy + run scripts for the devnet e2e
sims/                          integration-test matrix + LiteSVM template
specs/SPECIFICATION.md         the data model and contract
```

## On-chain program

One program, four account types, one instruction set for every series (adding a
metric = a new `DataFeed` PDA, no upgrade):

- **`OperatorRegistry`** — admin + allowed signer set (later swapped for Jito NCN).
- **`DataFeed`** (zero-copy) — trigger config + `[Sample; 256]` ring (~8 KB).
- **`DataFeedConsensus`** (zero-copy) — per-`(feed, window)` round, `[SampleSubmission; 100]`.
- **`AllocationConsensus`** (zero-copy) — per-round weight vectors, `[WeightSubmission; 100]`;
  finalising publishes **`AllocationState`** (the vector reflect-core reads).

Instructions: `init_registry`, `add/remove_operator`, `init_data_feed`,
`update_thresholds`, `propose_sample`, `corroborate_sample`, `finalize_sample`,
`init_allocation_state`, `open_allocation_round`, `submit_weights`,
`finalize_allocation`.

Key invariants (tested): every account fits the 10 KB single-account budget; weight
vectors renormalise to exactly `10_000` bps (deficit→smallest, excess→largest, ties
→ lowest venue id); `min_number ≤ 100` enforced; signer must be in the registry
*at submission time*. Brakes (`min_interval_slots`), forced refresh
(`max_interval_slots`) and divergence (`threshold_bps`) gate ring advances at
finalize.

## Build & test

```bash
# On-chain program (compiles + unit/layout tests on the host — no validator needed)
cargo test                       # from repo root

# Off-chain workers
cd workers && cargo test         # rubric + worker-core + producer tests
```

Full artifacts that need the Solana platform tools / Docker:

```bash
anchor build                     # BPF .so + IDL  (needs Agave/anchor toolchain)
cd sdk && npm install && npm run generate   # IDL -> TS/Rust clients
docker compose -f docker/docker-compose.yaml up --build   # the fleet
```

## Toolchain

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# Build deps (Debian): build-essential pkg-config libssl-dev libudev-dev protobuf-compiler
# Solana + Anchor (for anchor build / deploy / BPF sims)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install latest && avm use latest
```

> The plain `rustup` install used in this repo is enough to compile + unit-test
> everything. `anchor build`, the LiteSVM sims, and Docker need the extra tools
> above.

## Deploy & run (outline)

1. `anchor build && anchor deploy` (replace the `declare_id!` placeholder).
2. `init_registry`, `add_operator` for each operator, `init_allocation_state`.
3. `init_data_feed` per `(pool_id, data_id)` with cadence from
   `specs/SPECIFICATION.md` §5.3.
4. Run the producer fleet + consumer (`docker/docker-compose.yaml`), filling in the
   real venue `TARGET_ACCOUNT`s and driver offsets.

## Devnet end-to-end test

Drives the whole pipeline on devnet against a controlled data source (the
`mock-oracle` program), then **fetches the on-chain accounts and asserts they are
logically correct**: each `DataFeed` ring head equals the value injected, and
`AllocationState.weights` equals `rubric::compute_weights` for those inputs
(summing to exactly 10 000 bps). Producers still read on-chain accounts via the
real slot-pinned `OffsetU64Driver` path — only the *source* is a mock we can set.

```bash
# 1. build + deploy both programs, generate keypairs, write .env.devnet
bash scripts/devnet/00_deploy.sh
set -a; source .env.devnet; set +a

# 2a. deterministic, self-timing run (recommended)
cd workers
cargo run -p e2e -- run-happy          # sample -> aggregate -> consume -> allocate -> verify
cargo run -p e2e -- run-invariants     # quorum-miss, brake, no-trigger, forced-refresh, unauthorized

# 2b. or exercise the real daemons
bash scripts/devnet/run_e2e.sh
```

Dataset (5 venues, APY+CRR feeds; v3 screened out by the CRR rubric) and the
expected vector `[3007, 2707, 2707, 0, 1579, …]` are pinned by the
`e2e_dataset_golden_vector` test in `workers/rubric`. Full design + verification
matrix: `~/.claude/plans/radiant-giggling-gem.md`.

## Remaining work to production

- **Protocol drivers** — specialise `Driver::decode` per venue account layout
  (Marginfi, Kamino, Save, Jupiter Lend, Loopscale) from each protocol's schema;
  the generic `OffsetU64Driver` is the pattern.
- **Rubric reconciliation** — match `workers/rubric` bit-for-bit to
  `analysis/risk_scoring.py` / `ALLOCATION_METHODOLOGY.md` (screen direction + cap
  policy are config today).
- **Run the sims** in `sims/` (LiteSVM / `anchor test`).
- **Jito NCN** — swap `OperatorRegistry` for the restaking operator view; the
  instruction surface is designed to be unchanged.

## Design notes

- **Anchor + zero-copy**: mature, IDL→client codegen for the provider SDK, and
  `AccountLoader` handles the ~8 KB ring buffers within one account. CU overhead is
  irrelevant for a slot-windowed oracle. (Pinocchio would mean hand-rolled IDL +
  validation; Quasar is too young/unaudited for capital-allocation logic.)
- **Determinism**: zero floating point on-chain *or* off-chain; `u64`/`u128`
  fixed-point, multiply-before-divide, largest-remainder apportionment.
- **Workers pin Solana 2.1** for the off-chain client (the 4.x split crates churn
  the `Transaction`/`commitment` API); the program targets Anchor 1.0.2.

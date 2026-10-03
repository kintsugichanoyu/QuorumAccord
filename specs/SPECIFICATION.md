# Specification — Decentralisation of Capital Allocation

> Status: MVP specification for the NCN-shaped capital-allocation system. Jito NCN
> integration is the eventual target but is **explicitly deferred** (see §10).

## 1. Summary

Palindrome currently allocates stablecoin capital across lending venues with a
**monolithic Python pipeline**: one script fetches data from public REST APIs,
proprietary services (Blockworks, Dune), and Solana RPC, scores venues, and
computes allocation weights. This is a **single operator, single trust point**
with no on-chain history.

This task repurposes the existing logic into a set of **independent agents** that
fetch on-chain financial state and use **consensus** to agree on the state written
to chain. The system is shaped so that a consensus mechanism (Jito NCN) can later
arrive at aggregate values, but the NCN itself is out of scope. **No proprietary
endpoints exist in the production path.**

The deliverable is everything "NCN shaped and primed": one Solana program with its
account layout, the producer and consumer worker archetypes, an SDK for registering
data providers, simulations, and docker packaging.

### 1.1 Before vs. After

| | Before (single trust point) | After (on-chain, many operators) |
|---|---|---|
| Inputs | Off-chain APIs (Blockworks, Dune) + Solana RPC | Solana RPC, **venue accounts only**, no proprietary APIs |
| Compute | Python pipeline: fetch, score, solve LP, in-memory, single process | Producers (one driver per metric, many operators) → consensus per series → Consumer → consensus on weight vector |
| State | Weight vector as JSON file + Supabase row; vault reads off-chain | `AllocationState` PDA on-chain, signed by quorum; vault reads from chain |
| History | None on chain | On-chain ring buffer per metric |

## 2. Allocation Formula (domain model)

The on-chain layout exists to serve this scoring flow. Full details live in
`ALLOCATION_METHODOLOGY.md` (referenced by the brief; not in this repo).

```
yield × risk-discount  →  screen  →  normalise  →  cap
```

1. **Yield.** Each lending venue offers an APY.
2. **Risk discount.** Each venue carries a risk discount in `[0, 1]` (higher risk =
   bigger discount). It is a rubric score over smart-contract risk, oracle risk,
   protocol risk, counterparty risk, and — for pooled venues like Jupiter — a
   forced-liquidation factor derived from live collateral composition. Most venues
   use a static rubric value; Jupiter's is recomputed from its live collateral mix.
3. **Risk-adjusted yield.** `risk_adj_yield = APY × (1 − discount)` per venue.
   (`discount` is also written `CRR` in the cadence tables.)
4. **Screen.** Venues whose discount crosses a hard threshold are dropped entirely
   (MVP screen: `CRR ≥ 0.60`).
5. **Normalise.** Surviving risk-adjusted yields are normalised into a weight vector
   summing to 100 % (= `10_000` bps).
6. **Cap.** Trimmed to per-venue and per-category capital caps.

### 2.1 Point-in-time only for MVP

The current formula uses **point-in-time scalars only**. The on-chain ring buffer is
sized for **future** temporal filtering (EMA / volatility / liquidity) so those can
be wired in later without re-architecting the layout. **This MVP reproduces the
live-scalar formula exactly** — the consumer reads only the ring head (`.scalar()`).

## 3. Distributed Model — two worker archetypes

| Category | Role | Reads | Writes |
|---|---|---|---|
| **Producer** | Reads ONE specific DeFi data point from chain, processes it, writes one sample into ONE on-chain ring buffer | Any on-chain / off-chain data | Sample row into a `DataFeed` PDA |
| **Consumer** | Reads ALL needed `DataFeed` PDAs, computes the allocation weight vector | `DataFeed` data + other on-chain data | Weight vector into `AllocationState` |

- Producers are **1:1** with on-chain ring buffers.
- Consumers read many ring buffers to implement the allocation formula and set one
  weight vector.
- Consensus wraps every on-chain submission implicitly.

## 4. On-Chain Program — one program, three account types

1. **`OperatorRegistry`** — list of allowed signer pubkeys + admin authority.
2. **`DataFeed`** — per-`(pool_id, data_id)` measured series: identity, trigger
   config, ring buffer, plus its in-flight consensus component (`DataFeedConsensus`)
   for the next sample.
3. **`AllocationConsensus`** — per weight round: aggregates venue-ratio vectors from
   consumers into the final weight allocation.

A single instruction set covers **every** series — `propose_sample`,
`corroborate_sample`, `finalize_sample`, `update_thresholds` — with **no per-venue
program logic**. Adding a new metric = registering a new `DataFeed` PDA; no program
upgrade. A bad series only contaminates its own ring buffer.

### 4.1 `OperatorRegistry`

Single account holding the admin authority and allowed signer set. Mutated only by
`admin`. When Jito NCN is integrated later, this account is swapped for the NCN's
restaking-stake-weighted operator view; **the producer / consumer instruction surface
does not change.**

```rust
struct OperatorRegistry {
    admin     : Pubkey,        // governance-equivalent authority
    operators : Vec<Pubkey>,   // signers allowed to submit into the consensus accounts
}
```

### 4.2 `DataFeed`

One PDA per distinct data point `(pool_id, data_id)`. Holds identity, trigger config,
and ring-buffer state. Each `DataFeed` has an in-flight `DataFeedConsensus` sub-PDA
that aggregates operator-submitted sample values for the current tick.

- `pool_id` indexes the existing `PoolRegistry` (already in production reflect-core —
  `PoolEntry { protocol_type, liquidity_mint, accounts[10], ... }`). It is an
  identity tag, **not** an off-chain account resolver.
- `data_id` tags which metric this series represents (supply APY, util, TVL, reserve
  cap, etc.).

```rust
struct DataFeed {
    pool_id             : u8,           // which venue/pool this series describes
    data_id             : u8,           // metric tag inside the rubric equation
    measurand           : DataType,     // decode type for `value`
    window_slots        : u32,          // width n of a tick's Solana slot range (consensus window)
    threshold_bps       : u16,          // ratio divergence in bps that allows an early tick close
    min_interval_slots  : u32,          // brake — refuse a new tick sooner than this
    max_interval_slots  : u32,          // floor — force a new tick after this idle interval
    head                : u16,          // ring write index
    tick                : u64,          // tick counter — each sample covers a slot WINDOW
    last_finalized_slot : u64,          // closing slot of the most recent tick window
    last_value          : u64,          // scalar value at head
    ring                : [Sample; 256],
}

enum DataType { U64, U32, U16, /* ... */ }

impl DataFeed {
    fn scalar(&self) -> u64;        // MVP — returns ring[head].value
    fn get_median_50(&self);        // future
    fn get_median_100(&self);       // future
    fn get_median_250(&self);       // future
    fn get_mean_50(&self);          // future
    fn get_mean_100(&self);         // future
    fn get_mean_250(&self);         // future
}

struct Sample {
    slot  : u64,   // closing slot of the tick window this sample covers
    ts    : i64,
    tick  : u64,   // tick index
    value : u64,   // scalar measured value
}
```

The on-chain layout is **identical across selection modes** — only the consumer's
accessor changes. The ring holds 256 entries even though the MVP reads only the head;
window sizes for the future `get_*` accessors come from `RubricConfig` per series, not
baked into the PDA.

#### `DataFeedConsensus`

Opens at tick start, closes at `closes_at_slot`, then aggregation runs and the result
lands in `DataFeed.ring[head]`.

```rust
struct DataFeedConsensus {
    status         : State,                    // Open | Closed | Finalized
    data_feed      : Pubkey,                   // parent DataFeed this consensus writes back into
    tick           : u64,                      // tick index this round is producing
    closes_at_slot : u64,                      // = (tick + 1) * window_slots
    min_number     : u8,                       // quorum required at close; fewer = no finalize. Must be 1..64
    rule           : AggregationRule,
    count          : u8,                        // populated entries in `submissions`
    submissions    : [SampleSubmission; 100],
    output         : u64,                       // aggregated result — set when status == Finalized
}

struct SampleSubmission {
    submitter : Pubkey,
    value     : u64,
}
```

### 4.3 `AllocationConsensus`

One PDA per weight round. Aggregates ratio vectors submitted by consumers into the
final venue-weight allocation. **Independent of any specific `DataFeed` tick** — runs
on its own round cadence.

```rust
struct AllocationConsensus {
    status         : State,                       // Open | Closed | Finalized
    round          : u64,                         // weight round index (independent of DataFeed ticks)
    closes_at_slot : u64,
    min_number     : u8,                          // quorum required at close. Must be 1..64
    rule           : AggregationRule,
    count          : u8,                          // populated entries in `submissions`
    submissions    : [WeightSubmission; 100],
    output         : [VenueWeight; N_VENUES],     // sums to 10_000 bps after renormalisation
}

struct WeightSubmission {
    submitter : Pubkey,
    weights   : [VenueWeight; N_VENUES],
}

struct VenueWeight {
    venue_id : u8,    // index into PoolRegistry / venue list
    weight   : u16,   // basis points (10_000 = 100 %)
}

enum State          { Open, Closed, Finalized }
enum AggregationRule { Mean, Median, TrimmedMean(u8) }  // u8 = % to trim from each tail
```

### 4.4 PDA derivation

- `DataFeedConsensus`: seeds `[b"tick_consensus", data_feed_pda.as_ref(), tick.to_le_bytes()]`
  — one PDA per `(data_feed, tick)` pair.
- `AllocationConsensus`: seeds `[b"consensus", round.to_le_bytes()]` — one per weight round.
- `closes_at_slot` is set at init by the program. For `DataFeedConsensus`:
  `(tick + 1) * window_slots` derived from the parent `DataFeed`. For
  `AllocationConsensus`: set by admin or derived from a weight-round cadence config.

### 4.5 Authority & validation

- **Authority.** `update_thresholds` and `OperatorRegistry` mutation use the same
  admin authority as the deployer multisig / governance.
  Registry bootstrap is restricted to the deployed program's upgrade authority.
- **Config sanity.** The program enforces `1 ≤ min_number ≤ 64` when creating or
  updating feeds and opening allocation rounds, matching registry capacity.
  This is a capacity bound, not a guarantee the current membership meets quorum.
- **Submission validation.** Both producer and consumer instructions check
  `OperatorRegistry.operators.contains(signer)` **before** pushing into
  `submissions[]`. Non-registered signers are rejected at submission time, not at
  finalise — otherwise an unauthorised signer could flood the 100-slot array.

### 4.6 Status transitions (both consensus accounts)

```
Open  ──(slot ≥ closes_at_slot)──▶  Closed  ──(count ≥ min_number, aggregation runs)──▶  Finalized
```

- Submissions arriving at `slot < closes_at_slot` are accepted; at
  `slot ≥ closes_at_slot` they are rejected.
- If quorum is **not** met at close, the round ends **without finalizing** — the ring
  buffer (`DataFeedConsensus`) or weight vector (`AllocationConsensus`) does not advance.

### 4.7 Aggregation for `AllocationConsensus`

Per-venue, apply the `AggregationRule` (Mean / Median / TrimmedMean) across `weight`
values for matching `venue_id` across all `count` submissions. Sum the averaged
weights, accumulating in `u32` to stay clear of `u16` overflow (see the downstream
`valid_ratios` helper). The vector must sum to exactly `MAX_BPS = 10_000`:

- If `sum < 10_000`: add the deficit `(10_000 − sum)` to the **smallest**
  positive `VenueWeight.weight` in `output`, preserving excluded zeros.
- If `sum > 10_000`: subtract the excess `(sum − 10_000)` from the **largest**
  `VenueWeight.weight` in `output`.
- Ties on smallest / largest are broken by lowest `venue_id`.

An all-zero aggregate is rejected. Output must satisfy the downstream contract
`valid_ratios(output) == true`. Aggregate venue/category cap preservation still
needs a policy; renormalization does not enforce the off-chain rubric's caps.

Allocation rounds are NOT yet an input-snapshot determinism boundary. Consumers
may read different feed entries: RPC `minContextSlot` is only a lower bound.
A common anchor and input commitment remain design work (see OPEN_QUESTIONS.md).
Older sample closing slots and allocation rounds cannot overwrite newer published
results. Sample brakes and refresh intervals use window closing slots, so delayed
cranking does not turn an ineligible sample into an eligible one.

## 5. Ticks, Windows, Triggers, Brakes

Each `DataFeed` maintains its **own** submission schedule. A **tick** is a window of
Solana slots; the feed produces at most one `Sample` per tick. Tick width is tuned per
feed — tight for fast metrics, loose for slow. The window is derived deterministically
from the feed's parameters and the Solana clock.

**Why a window (not a single slot).** Operators sampling at slightly different slots
due to RPC drift, replay lag, or scheduling jitter would never agree on a single-slot
read. A window of `window_slots` is wide enough to absorb that variance and narrow
enough to be meaningful. Two operators sampling at `X+3` and `X+9` both contribute to
tick N; the aggregator collapses them into one value. An operator who misses the window
participates in the next tick.

**Many feeds, many tick rates.** Tick boundaries across feeds do not align and are not
expected to. The on-chain program treats every feed's tick clock as independent.
Consumers do **not** try to align ticks: when a consumer runs at a Solana slot, it
reads each feed's latest finalised sample — fast feeds return a sample minutes old, slow
feeds hours old. Both are derived from the Solana sysclock, so every consumer operator
sees the same input set.

### 5.1 Triggers

1. **Solana slot.** Operators sample at any slot inside the active window. Each
   submission carries its own slot; consensus aggregates within the window.
2. **Ratio divergence.** `abs(current − last_value) * 10_000 / max(last_value, 1) ≥ threshold_bps`
   lets a new tick open earlier than `max_interval_slots` would otherwise force.

### 5.2 Brakes (act at tick boundaries, not per-submission)

- **`min_interval_slots`** — hard refusal at finalize if
  `current_slot − last_finalized_slot < min_interval_slots`. Prevents flapping inputs
  (or adversarial producers) from spinning the NCN through rapid window openings.
- **`max_interval_slots`** — forces a new tick even when the value doesn't move, so
  downstream staleness checks see life signs.
- **`window_slots`** — sets the consensus tolerance per tick (operator-slot variance
  within `window_slots` is absorbed by aggregation).

All three are tunable per series.

### 5.3 Cadence calibration (illustrative)

| Series | Rubric role | Expected change | `max_interval_slots` | `threshold_bps` | `min_interval_slots` |
|---|---|---|---|---|---|
| `*.<asset>.apy` (marginfi, save, kamino main/jlp) | Supply APY → numerator of `risk_adj_yield = APY × (1 − CRR)` | Per block during activity | ~4 500 (~30 min) | 30 (≈0.30 pp APY) | ~750 (~5 min) |
| `*.<asset>.tvl` | Liquidity-risk input + venue capacity + IL exposure | Per deposit/withdraw | ~9 000 (~1 hr) | 500 (≈5 % TVL) | ~750 |
| `*.<asset>.util` | IRM curve driver + >85 % withdrawal-risk threshold | Per borrow/repay | ~4 500 | 50 (or 85 % boundary cross) | ~750 |
| `kamino.reserve_caps` (scalar = total cap USD) | Hard capacity ceiling on allocation | Governance-set, days–months | ~216 000 (~24 hr) | 100 (≈1 % cap change) | ~9 000 (~1 hr) |
| `jupiter.lend.*.apy` | Pooled APY, sensitive to rehypothecation | Block-level | ~2 250 (~15 min) | 30 | ~300 (~2 min) |
| `jupiter.lend.*.tvl` | Pooled liquidity depth | Per deposit/withdraw | ~4 500 | 500 | ~750 |
| `jupiter.lend.*.util` | Pooled utilization | Per borrow/repay | ~2 250 | 50 (or 85 % cross) | ~300 |
| `jupiter.lend.collateral_mix` | Per-mint share vector for pooled `Gap_CRR` (METHODOLOGY §2.3) — structured, layout TBD | JLP rebalances — hours–days | ~108 000 (~12 hr) | 200 bps shift in any mint share | ~9 000 |
| `jupiter.perps.stats` (Phase 6, packed struct) | OI + funding feeding JG primitive | Per perp trade | ~750 (~5 min) | 100 funding swing OR 10 % OI | ~150 (~1 min) |
| `loopscale.<vault>.apy` | Vault-specific lend APY | Hours–days | ~54 000 (~6 hr) | 50 | ~4 500 (~30 min) |
| `loopscale.<vault>.tvl` | Vault deposit depth | Hours–days | ~108 000 (~12 hr) | 500 | ~4 500 |

**Cadence tiers (broad):** Fast (5–30 min) — all `*.apy`, all `*.util`, perps stats;
Medium (30 min–2 hr) — all `*.tvl`; Slow (12–24 hr) — `reserve_caps`,
`collateral_mix`, Loopscale vault state.

## 6. Producer Worker

One instance per `DataFeed` PDA, per operator. Runs as a **daemon**. It is a
**write-only sensor**: fetches its assigned data point from on-chain accounts or
off-chain endpoints, decodes deterministically in fixed-point bps, signs
`(value, solana_slot_at_read)`, and submits to consensus. The on-chain program is
authoritative — brakes, windows, and divergence thresholds are enforced at finalize,
not by the producer.

**Inputs:** `series_pda` (env / CLI — identity only); `target_accounts` or
`api_endpoint` (image config / env); `SOLANA_RPC_URL`.

**Per-tick flow:**

```
Window from Solana clock:  internal_block N = floor(current_slot / window_slots)
                           submissions valid only if slot ∈ [X, X + window_slots]
        │
        ▼
Operators sample independently inside the window (one driver per Producer, many operators)
   op A @ X+3   op B @ X+9   op C @ X+22   …
        │
        ▼  three steps per operator
   1. Read   — fetch venue accounts via RPC at chosen slot
   2. Decode — parse bytes to u64 fixed-point bps, deterministic
   3. Sign   — sign (value, slot, N) and submit to the program
        │
        ▼
Window closes — aggregator runs: collect valid votes (sig ok, slot in window),
                aggregate (median / trimmed mean), brake check (reject if min_interval_slots)
        │
        ▼
One Sample lands in the ring buffer: tick bumps, last_finalized_slot & last_value update
```

**Distinctness.** One driver per instance — a binary that decodes Kamino main USDC APY
does not know how to decode anything else. Drivers ship independently: a schema change
in Loopscale only requires shipping the Loopscale driver(s).

**Independence.** Producers do not call each other; they only read the chain. A crash
of one producer affects only that series' liveness — other series progress. Quorum is
per-series; an under-staffed series simply stops updating until enough operators are
online for it.

**Termination.** Daemon. Per-loop outcomes: `proposed`, `corroborated`,
`idle (brake)`, `idle (no trigger)`. State lives on chain; nothing is persisted locally.

## 7. Consumer Worker

Reads each `DataFeed` via its `.scalar()` accessor at a **shared Solana slot**, runs
the live-scalar rubric (formulas from `analysis/risk_scoring.py` and
`ALLOCATION_METHODOLOGY.md`, in fixed-point bps), applies the CRR screen, normalises to
weights summing to `10_000` bps, and proposes the vector to consensus. EMA / volatility
/ liquidity accessors exist for future rubric work but are **not exercised in the MVP**.

**Inputs:** all `DataFeed` PDAs in the active registry; `RubricConfig` (Tier A weights,
primitive coefficients, CRR screen, per-driver staleness tolerance).

**Per-trigger flow:**

```
Trigger — time elapsed OR any series tick advanced (decides WHEN to recompute, not what inputs)
        │
        ▼
Pick anchor slot T_sol — shared across all operators, deterministic from chain state
        │
        ▼
For each series, look up the right ring entry at T_sol (latest-before anchor).
   Stale series (last_finalized_slot too old) are excluded.
   snapshot = { series → (tick, value) },  input_hash = hash(snapshot)
        │
        ▼
Run rubric on the snapshot — pure fixed-point math, deterministic across operators:
   (EMA/vol future) → CRR per venue → CRR screen ≥ 0.60 → risk_adj_yield = APY × (1 − CRR)
   → LP + caps → normalise to 10_000 bps
        │
        ▼
Submit { weights, input_seqs, input_hash, signature } into the active AllocationConsensus.
   Consensus rejects any submission computed off a different snapshot.
   The accepted vector lands in AllocationState.
```

1. Read all `DataFeed` at confirmed commitment, capturing each tick and
   `last_finalized_slot`.
2. Per-driver staleness check: if a series' `last_finalized_slot` is older than its
   staleness tolerance, treat its venue/leg as **excluded**.
3. Compute derived stats per series from its ring buffer (EMA, vol, etc. — future).
   Aggregate per venue.
4. Apply rubric → CRR per venue → CRR screen → risk-adjusted yield → weights.
5. Submit `{ weights[N], signature }` into the active `AllocationConsensus` account.

**Distinctness.** Single binary, independent from any Producer. **Cannot write to
`DataFeed`.** Pure aggregation + rubric math — any divergence between operators beyond
rounding tolerance is a bug.

**Independence.** Reads chain only; does not depend on producer process state. If a
producer fails, the relevant `DataFeed.last_finalized_slot` ages out; the consumer marks
that input stale and proceeds with what's available, or stops if too much is stale. Many
operators run the consumer in parallel; consensus takes the median of submitted vectors
at matching input snapshots.

**Termination.** Inherently ephemeral, like the producer archetype.

## 8. How a Tick Lands on Chain

**No global coordinator. No "proposer picks the target slot."** Tick windows are
deterministic:

1. **Window opens** at `X = floor(current_slot / window_slots) * window_slots` (or a
   similar deterministic rule the program defines). The window covers
   `[X, X + window_slots]`.
2. **Operators sample independently.** Each producer fetches venue data at some slot in
   `[X, X + window_slots]` and submits `{ series_pda, value, solana_slot, signature }`.
3. **Window closes** at `X + window_slots`. The aggregator collects valid submissions
   (signature OK, slot inside window, signer in `OperatorRegistry`), applies the
   aggregation rule (median / trimmed mean), and finalizes ONE `Sample` for tick N.
4. **Brake check at finalize.** Rejects if `last_finalized_slot` was less than
   `min_interval_slots` ago. Skips opening a new window if neither `max_interval_slots`
   was hit nor a `threshold_bps` divergence triggered.
5. **On finalise.** Ring buffer gets one new entry, `tick` increments,
   `last_finalized_slot` updates to the window's closing slot, `last_value` updates.

**Why "one operator at a later slot" is a non-issue.** Operator-slot variance up to
`window_slots` is absorbed by aggregation. An operator so late it misses
`X + window_slots` is dropped for THIS tick and participates in the next. The brake
(`min_interval_slots`) prevents back-to-back tick opens.

## 9. API Key Management & Trust

- **No proprietary keys anywhere in the production path.** Drop Blockworks, Dune,
  `stats.jup.ag`, `api.solend.fi`, and the Loopscale TARS bearer token.
- The **only secret is `SOLANA_RPC_URL`** (plus the operator's signing keypair).
- Operators may configure multiple RPC endpoints for failover — slot pinning makes the
  result identical across honest RPCs.
- **No shared keyring.** Each docker container ships with its own env.

## 10. NCN Scope (deferred)

This task delivers everything NCN-shaped and primed **except the NCN itself**. Jito NCN
consensus is the eventual integration target but is explicitly deferred. An NCN cannot
be instantiated alone — it is the consensus of opted-in operators, and there are no
operators until someone runs the binary and registers (weeks of outbound recruitment).
For the MVP, the `OperatorRegistry` signer set stands in for the NCN; the producer /
consumer instruction surface is designed so the later swap to Jito's
restaking-stake-weighted operator view requires no change to it.

## 11. Out of Scope

- **Rebalancer.** Task ends at "weights published on-chain via consensus";
  reflect-core consumes `AllocationState` separately.
- **Watchtower / monitoring daemons.** Deferred.
- **Dashboard.**
- **Backtest framework.**
- **Rust rewrite** of the existing Python financial code.
- **Jito NCN integration.**

## 12. Sizing Constraint

The PDA layout must fit a single Solana account (~10 KB default before zero-copy
gymnastics). The ring layout may be compressed to fit; future production
implementations will handle account sizing. Indicative sizes for the layout above:

- `DataFeed.ring` = `256 × Sample(32 B)` ≈ 8 KB + header → fits.
- `DataFeedConsensus.submissions` = `100 × SampleSubmission(40 B)` ≈ 4 KB → fits.
- `AllocationConsensus.submissions` = `100 × WeightSubmission(32 B + N_VENUES × ~4 B)` —
  tight for larger `N_VENUES`; compress `VenueWeight` packing if needed.

## 13. Glossary

- **CRR / risk discount** — risk discount in `[0, 1]`; `risk_adj_yield = APY × (1 − CRR)`.
- **Tick** — one window of Solana slots producing at most one `Sample` per `DataFeed`.
- **bps** — basis points; `10_000 bps = 100 %`.
- **PDA** — Program Derived Address.
- **NCN** — Node Consensus Network (Jito); deferred consensus layer.

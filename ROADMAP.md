# Quorum protocol roadmap

Updated: **2026-10-06**. Status: proposed implementation sequence; milestones
below are not implemented unless explicitly marked as the current baseline.
Progress is measured by acceptance criteria, not calendar dates. Estimates and
release versions should follow the first adapter's correctness and compute
measurements.

The [Kamino integration plan](integrations/kamino/README.md) pins the public
contract/SDK revisions, verifies a selected mainnet reserve and its linked
accounts, and defines implementation gates from captured state. The read-only
verification spike is complete; the on-chain adapter and migration remain planned.

## Direction

For metrics completely determined by Solana accounts, Quorum should read the
validated source accounts, calculate the metric, and publish its history **inside
the on-chain Rust program**. Off-chain Rust keepers should assemble and submit
transactions, handle scheduling and retries, and pay transaction fees. They
should not supply an authoritative measurement or calculation result.

```text
Keeper: submit refresh transaction with configured account addresses
                              ↓
Solana runtime: supply the actual account state
                              ↓
Quorum: validate source → calculate metric → apply publication rules
                              ↓
Versioned feed history → deterministic allocation → published target weights
```

Validator execution establishes the result for the state read by that
transaction. Multiple keepers provide availability; an operator quorum is not
required to attest to this deterministic measurement. Keep a distinct
attestation path only for inputs that cannot be obtained and calculated on chain.
Governance still controls approved sources, adapter versions, and allocation
policy. Protocol/oracle errors and adapter bugs remain possible.

This roadmap changes the original MVP's assumption that every sample and weight
vector is computed off chain and voted into state. The existing program and
deployment continue to use that model until a versioned migration is implemented.
Publishing this document does not upgrade them.

## Current baseline

- Rust program: registered operators submit values, scalar consensus publishes
  feed history, and allocation consensus publishes weight vectors.
- Rust producer: a generic `offset_u64` account decoder; source identity and real
  lending-protocol schemas are not validated by the on-chain sample instructions.
- Rust consumer/rubric: off-chain integer allocation calculation, with unresolved
  risk coverage, snapshot, caps, insufficient-capacity, and recovery requirements.
- TypeScript lab and public devnet evidence: tests of the existing model, using
  invented sources. These results do not verify the proposed adapters.
- Generated Rust/TypeScript clients: current MVP verified on devnet on
  2026-10-06; M4 still requires clients for the future source-refresh interface.
- Rust website server, TypeScript frontend, mdBook, Docker configurations and
  GitHub workflows: present; a public website release is independent of this
  protocol migration.

## Milestones and dependencies

| Milestone | Result | Depends on |
|---|---|---|
| M1 | Source contract and versioned feed design | Current baseline |
| M2 | One Kamino reserve measured on chain | M1 |
| M3 | Defined and verified Kamino yield calculation | M2 |
| M4 | Resilient keepers, SDKs and reader integration | M2; M3 for yield feeds |
| M5 | Additional protocol adapters | M3 and M4; each adapter passes its own gates |
| M6 | On-chain allocation from complete, versioned inputs | M4, sufficient M5 coverage, approved methodology |
| M7 | Audited migration and staged production release | M1–M6 for the enabled scope |

The first useful release is a **Kamino measurement feed**, after M2 and the
relevant keeper work in M4. Yield and allocation can ship later. A feed-only
release must not be advertised as a completed allocation engine.

## M1 — Define sources, metric semantics, and versioned state

**Deliverables**

- Select one concrete Kamino USDC reserve and cluster. Pin the program ID,
  market, reserve, liquidity mint, account schema, and source-code revision;
  assess compatibility with the actual deployed program. Do not infer deployed
  bytecode equivalence from an executable account or a repository URL.
- Define each metric's units, rounding, valid range, dependencies, source
  freshness, and publication cadence. Start with utilization and available
  liquidity; define yield separately in M3. Token amounts must retain their
  decimals rather than being presented as basis points.
- Specify a versioned source/configuration account that binds a feed to its
  exact accounts, source mode, approved adapter, metric, and policy version.
  A keeper must not select a different reserve, formula, or source mode.
- Specify new feed/sample metadata: execution slot/time, source update context
  where available, source/configuration version, and monotonically increasing
  sample sequence. Keep execution time distinct from source freshness and the
  legacy consensus window's closing slot.
- Choose new account discriminators/PDA namespaces and explicit migration
  instructions. Existing zero-copy account layouts and old client decoders
  must not silently acquire a different interpretation.

Proposed instructions include `register_source`, `refresh_metric`, and
`update_source_config`; these names describe a design, not an existing API.
`refresh_metric` takes identifiers/version expectations and required accounts,
not a keeper-supplied metric value or observation timestamp.

**Exit gate:** an architecture decision record and account/instruction contract
cover source substitution, version changes, pause authority, freshness,
publication rules, reader compatibility, and migration. Every required input has
a defined provenance and unit. No production account mapping is guessed.

## M2 — Implement the smallest on-chain Kamino adapter

**Deliverables**

- Add Rust account decoding and checked calculations for utilization and
  available liquidity for the selected reserve. Validate the exact source
  address, owner, discriminator/schema version, market and mint relationships,
  lengths, denominators, and bounds before calculating or publishing.
- Derive publication context from the chain's clock and source state. Enforce
  freshness, minimum publication intervals, change thresholds, and monotonic
  history on chain. A maximum refresh interval is a condition evaluated when
  invoked; it cannot cause a program to execute automatically.
- Make direct feeds writable only through their validated calculation path.
  Legacy `propose_sample`, `corroborate_sample`, and `finalize_sample` must not
  write or overwrite these feeds. Start with separately versioned accounts.
- Define safe repeated-call behavior: repeated calls for the same publication
  key/window cannot create duplicate samples; distinct eligible observations
  follow the documented cadence. Do not average repeated keeper transactions
  and call them independent measurements.

Pure reads need no Kamino CPI. When a metric requires refreshed reserve state,
the keeper can put Kamino's refresh instruction before Quorum's read in the same
transaction, or an adapter can use a reviewed CPI path. Quorum must still check
the resulting state and freshness; a keeper's claim that it refreshed is
insufficient. Kamino's current refresh handler references reserve/market state
and, when required, configured oracle accounts. Pin that behavior rather than
assuming a single-account refresh.
[Kamino refresh source](https://github.com/Kamino-Finance/klend/blob/master/programs/klend/src/handlers/handler_refresh_reserve.rs).

**Exit gate:** native decoding/math tests and actual-validator tests reject
wrong-but-valid Kamino reserves, wrong market/mint/owner, unsupported versions,
truncation, stale state, duplicate publication, and overflow. Record compute
units, loaded-account/transaction requirements, and fees for success and failure
paths. Use captured or cloned accounts with recorded provenance if Kamino is
absent from the test cluster; label those runs as fixtures. No keeper argument
can choose the output value.

## M3 — Calculate and verify yield on chain

**Deliverables**

- Define whether each feed reports borrow-interest supply APR, compounded APY,
  rewards yield, or a specified combination. Do not substitute APR for APY or
  label an incentive-inclusive rate as base interest.
- Implement the chosen interest model, utilization, fees, accrual projection or
  refresh requirement, and APR/APY conversion with documented checked
  fixed-point math. Specify rounding and an approved error tolerance for any
  approximation. Floating-point SDK output is a comparison reference, not the
  on-chain implementation.
- Separate rewards or incentives that require additional accounts, prices, or
  assumptions. Publish them only after those dependencies have their own
  validation/freshness rules; leave unsupported components explicitly unavailable.
- Pin reference calculations and account fixtures to protocol revisions. The
  current Kamino SDK distinguishes supply-interest APR and rewards-distribution
  APR; its formulas must be reviewed for the selected deployed reserve/version.
  [Kamino SDK calculations](https://github.com/Kamino-Finance/klend-sdk/blob/master/src/classes/reserve.ts).

**Exit gate:** golden vectors and property tests cover empty/full utilization,
accrual intervals, fee/configuration changes, rounding, invalid inputs and extreme
values. On-chain results match the independently checked reference within the
approved tolerance. Benchmarks fit the selected transaction format and leave
documented operating headroom. Failure leaves the prior sample intact and stale
according to its expiry; it never writes a fabricated zero or fresh timestamp.

## M4 — Evolve providers into keepers and update integrations

**Deliverables**

- Introduce a Rust keeper that reads approved source configuration, assembles
  required account lists and refresh instructions, simulates and submits
  transactions, confirms outcomes, and retries safely with RPC failover.
  Local reads help scheduling and transaction construction; published values
  remain calculated on chain.
- Make refresh permissionless by default once on-chain validation and cadence
  controls are proven. Administrative source changes remain authorized. A
  keeper signing key pays fees rather than certifying a measurement; multiple
  keepers do not require multiple value votes.
- Specify timing policy: keeper delay cannot change a formula or account binding,
  but it can affect the observation time. Monitor maximum age, allow another
  keeper or a consuming transaction to refresh, and fail closed when required
  inputs have expired. Decide whether rewards are necessary only after baseline
  operation; any reward must resist duplicate/spam publication.
- Add Docker keeper configuration, restart/confirmation recovery, bounded fee
  settings, funding alerts and publication-age monitoring. Generate, compile and
  validate Rust/TypeScript clients; update the handbook and inspector to show
  source mode, versions, execution time and source freshness accurately.

**Exit gate:** two independent keepers can race, restart, lose an RPC endpoint,
and miss a scheduled refresh without corrupting history or duplicating
publication. Reader tests reject stale, unsupported or incorrectly bound feeds.
Record measured publication cadence, failure/recovery behavior and operating
costs. SDK instruction/account serialization matches actual runtime execution.

## M5 — Expand verified source coverage

Add one explicitly selected market at a time. Candidates from the existing scope
include Jupiter Lend Earn, Marginfi/Project 0 native banks, Save and Loopscale.
Selection depends on current schemas, available source accounts and the intended
allocation mandate; research interest alone is not implementation evidence.

Each adapter repeats M1–M3's identity, math, freshness, provenance, test and compute
gates. Give adapter/schema upgrades a reviewed version transition. Track wrappers
and shared underlying venues so allocation does not mistake two representations
of the same exposure for independent sources. Build batch refreshes only after
account and compute measurements demonstrate that they fit.

**Exit gate:** publish an adapter coverage matrix with exact versions, markets,
mints, supported metrics and excluded components. Validate each integration
against deployed state where available, clearly separating mainnet read-only
comparison, cloned/local execution, and actual protocol execution. Existing
mock-based devnet evidence is not reused as proof of real adapter support.

## M6 — Move deterministic allocation on chain

**Deliverables**

- Refactor the integer Rust rubric into a library usable by the program and
  reference tools. Resolve the missing financial methodology, mandatory risk
  coverage, threshold equality, venue/category caps and insufficient-capacity
  policy before making its output authoritative.
- Store strategy-specific, versioned allocation policy on chain: required feed
  identities, freshness limits, risk assumptions, caps and asset mandate. Static
  risk coefficients are governance policy, not facts proven by Kamino reserves.
  Any external attestations must have explicit authority, provenance and expiry;
  incomplete risk inputs cannot default to zero risk.
- Prefer calculating from all required validated inputs in one transaction.
  Previously captured feed entries may have different source observation times;
  atomic reading does not make them contemporaneous. Enforce a documented age
  and observation-skew policy and record the selected sample sequences/versions.
- If the calculation cannot fit one transaction, use an immutable, complete
  snapshot commitment with a deadline and explicit input selection rules.
  Staging across transactions is not an exact historical read of every protocol
  at one slot. Reject incomplete, mixed-policy or expired snapshots.
- Calculate and publish weights on chain without a keeper-supplied authoritative
  vector. Preserve excluded zeros, caps and deterministic rounding. Choose an
  explicit reserve/cash component or halted state when safe capacity cannot
  support 10,000 bps; never inflate unsafe positions to satisfy the sum.

**Exit gate:** invariant and actual-validator tests cover missing/stale inputs,
policy changes, source-mode substitution, snapshot expiry, caps, rounding and
all-excluded/insufficient-capacity cases. The accepted snapshot determines one
result independently of caller identity. Publish input/policy commitments and
allocation expiry with measured compute/account costs. Retire allocation voting
only for strategies that have passed these gates.

## M7 — Migrate and release in stages

1. Run legacy and new feeds side by side for comparison. Differences can arise
   from observation time, rounding, freshness and the old aggregation rule;
   compare defined semantics rather than requiring unexplained equality.
2. Publish an explicit account/IDL migration and consumer cutover. Keep historical
   accounts readable, label their source modes, and prevent legacy finalization
   from overwriting new state. A new deployment or account namespace is an
   explicit choice; the previous Quorum rename's ABI compatibility is not a
   guarantee for this redesign.
3. Complete independent review of adapters, arithmetic, source configuration,
   upgrade/pause authority, snapshot policy, keeper timing and allocation safety.
   Establish governance, monitoring, incident response, account retention and
   rollback to a reviewed version. Rollback must not bypass freshness or silently
   turn a direct feed back into operator-supplied data.
4. Release measurement feeds first, then yield, then the approved allocation
   scope. Advance from fixtures to a test deployment and finally a limited
   production rollout after recording all gates. Mainnet signing, deployment,
   funding and any capital exposure require their own release decision.

**Exit gate:** documented migration/rollback rehearsals, published validation
evidence, operational ownership and alerts, reviewed deployment authorities,
generated clients, passing CI and reproducible artifacts for the enabled scope.
Current release blockers remain active until their replacement behavior is
implemented and tested.

## Scope and decisions to settle first

The first implementation task is **M1 plus an M2 proof of concept for one
Kamino reserve**. Settle the metric/units, deployed schema, account/version
strategy, freshness policy and publication cadence before adding more protocols.

Capital transfers and rebalancing remain the external vault/execution system's
responsibility. Jito NCN/restaking is not a prerequisite for direct account reads.
Heavy historical analytics, cross-chain data and proof-based outsourced
computation are later design work, not reasons to retain unnecessary value voting
for the initial account-derived feeds.

Solana instructions declare the accounts a program can read or write; the keeper
supplies those references and the runtime supplies state.
[Solana instruction model](https://solana.com/docs/core/instructions).
Measure resource requirements against the chosen transaction format and active
network limits rather than hard-coding a roadmap-wide account/compute assumption.
[Solana compute-budget documentation](https://solana.com/docs/core/fees/compute-budget).

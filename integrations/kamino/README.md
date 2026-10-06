# Kamino integration plan

Reviewed **2026-10-06**. The public contract and SDK sources have been pulled and
pinned, a Rust research probe has verified a real mainnet reserve and its linked
accounts, and public snapshots can be replayed offline. **The Quorum on-chain
Kamino adapter is not implemented yet.** This plan turns the first roadmap
milestones into specific implementation and verification work.

## Verified source and account selection

| Item | Pinned selection |
|---|---|
| Contract release | `release/v1.25.0` |
| Contract/interface revision | `a08760976f51a3a58c4a0c6ea27b4a0e565bca79` |
| Rust interface | `klend-interface` 0.8.0, unchanged Git dependency |
| TypeScript SDK source | `38845294447623f6de3afc9dec29875f959f6f48`, package declaration 11.0.1 |
| Mainnet lending program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |
| Main market | `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` |
| USDC reserve | `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59` |
| Liquidity mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals |
| Approved deployment candidate | ProgramData deployment slot `440486775` |

The program address comes from [Kamino's deployment documentation](https://kamino.com/docs/build/resources/program-addresses).
The market/reserve/mint tuple comes from the
[pinned official SDK constants](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/examples/utils/constants.ts).
`integrations/kamino/source-lock.json` records source-file hashes and the official
release binary URL/hash. `integrations/kamino/source.example.json` records the
actual account bindings; it is research configuration, not an initialized
Quorum source account.

The contract and interface have different Business Source License grants. The
[interface license](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/libs/klend-interface/LICENSE)
contains a grant for unmodified application dependencies and a restriction on
operating a separate lending protocol. The SDK package declares MIT. Preserve
upstream notices and check the intended reuse against the exact pinned license;
the program's license cannot be inferred from the SDK's declaration.

## What the live verification established

The [mainnet report](../evidence/kamino-mainnet-2026-10-06.json) records one
confirmed-bank snapshot at **slot 453902424**, with ten public accounts. The
probe verified network genesis, executable program/loader linkage, reserve and
market owners/discriminators/versions/lengths, mint decimals, market authority,
linked token-account mints/authorities, vault balance coverage, and clock/source
slot ordering. Full account bytes and SHA-256 hashes are retained in
`integrations/kamino/fixtures/mainnet-2026-10-06.json` for offline replay.

The reserve is **8624 bytes including its discriminator**; its body is 8616.
The market is **4664 bytes including its discriminator**; its body is 4656.
Use full account lengths in RPC filters and validators. A filter copied from an
example that omits the discriminator would miss this reserve.

The downloaded official release ELF has SHA-256
`ac5a94790923b0a8cccb981e6f20b5bbb4a67ae35490b685db3009b144771009`.
Its 2,431,968 bytes match the deployed bytecode prefix, with zero padding through
the remaining allocated program space. This verifies equality with the official
release artifact. A reproducible source build has **not** been established.
ProgramData allocates about 10 MiB; including it in each future refresh requires
measuring loaded-account costs as well as compute units.

The captured stored-state diagnostics are:

| Field | Captured result |
|---|---|
| Reserve version / status | 1 / active (0) |
| Interest rate basis | 1; time-based mode must be handled in yield calculations |
| Total available liquidity | `10591501905817` base units, or 10,591,501.905817 USDC |
| Utilization, rounded down | 9147 bps |
| Source last update | Slot `453902416`; stale flag 0; price flags 63 |
| Source age at snapshot | 8 slots; fails the same-slot freshness gate |
| Withdrawal queue collateral | 0 at this observation |

These values are dated observations, not current quotes or published Quorum
feeds. No mainnet transaction was signed or submitted.

Three findings affect implementation:

1. **Bind actual linked accounts.** All four vault/mint addresses in this reserve
   differ from today's init-reserve PDA derivations. Their addresses come from
   the canonical program-owned reserve; their token owners, mints and market
   authority were checked. Pin those bindings instead of substituting newly
   derived addresses. The snapshot does not establish the historical reason for
   the differing namespace.
2. **Use protocol accounting denominators.** The mint reports collateral supply
   `100884325940456`, while the reserve records `100884338700991`. The cause of
   the difference was not established. The upstream exchange-rate calculation
   uses the reserve's recorded collateral supply. Investigate the difference
   before introducing queue-adjusted liquidity or collateral/exchange-rate feeds.
3. **Refresh before calculating.** A confirmed RPC response does not establish
   freshness of accrued reserve state. Kamino treats a reserve as stale after
   one elapsed slot, or when its stale flag/required price checks fail.
   [Pinned freshness implementation](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/programs/klend/src/state/last_update.rs).

The [devnet check](../evidence/kamino-devnet-2026-10-06.json) found the lending
program executable, but this reserve absent. The mainnet market and mint
addresses on devnet were system-owned accounts, not usable market/mint state.
This establishes that **this tuple cannot be reused on devnet**; it does not
establish that all Kamino devnet reserves are unavailable.

## Implementation sequence and exit gates

### 1. Complete the source contract and validation spike

Define a versioned `SourceConfig` that binds the program, approved deployment,
market, reserve, liquidity mint, required linked accounts, adapter/schema version,
metric units, freshness and publication policy. Governance controls registration,
updates and pauses. Source changes advance a configuration version.

Use separate `source_v1` and `direct_feed_v1` PDA namespaces and discriminators.
Legacy consensus instructions must not write direct feeds. Initial metrics are
**total available liquidity in token base units** and **utilization in bps**.
Total available liquidity is not guaranteed immediately withdrawable liquidity;
queue-adjusted liquidity and capacity need separate definitions.

Extend the Rust validation spike to account substitution, market/mint mismatch,
unknown status/version, token authority, emergency flags and the observed legacy
bindings. Build a second independent decoder/reference comparison from the
pinned official SDK. Measure whether the unmodified Rust interface works within
the production Anchor/Solana dependency versions and SBF limits. Borrow validated
account data or use a small projection; copying an 8616-byte reserve onto an SBF
stack is not an acceptable implementation assumption.

**Exit gate:** reviewed account/instruction contract, agreed units/rounding,
source-change and upgrade behavior, SDK parity on captured bytes, and a compiled
SBF validation spike. Confirm the deployment artifact/source-build provenance
required by the production approval policy.

### 2. Implement on-chain refresh and publication

Add a source-bound `refresh_metric` instruction. Its arguments select a configured
metric/version; they do not contain a caller-supplied value or observation time.
The program reads the validated reserve state and derives context from `Clock`.
Refresh callers are permissionless; source approval remains administrative.

The initial transaction should execute:

```text
Kamino refresh_reserve(reserve, market, configured oracle accounts)
    → Quorum refresh_metric(approved source, direct feed, source accounts)
    → validated on-chain calculation and history publication
```

The selected reserve currently configures Scope prices at
`3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH`. Build optional oracle arguments
from validated configuration and verify their program owners/relationships.
The [refresh handler](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/programs/klend/src/handlers/handler_refresh_reserve.rs)
conditionally refreshes prices and accrues reserve state. A CPI is unnecessary
for a pure read; the preceding refresh instruction supplies the required update.
Quorum must still enforce `last_update.slot == Clock.slot`, stale flag 0, and
any price-status checks its metric requires. Transaction order or a keeper's
claim alone is insufficient.

The reference net-supply equation in scaled units is:

```text
scale = 2^60
net_supply_sf = total_available_amount * scale + borrowed_amount_sf
                - accumulated_protocol_fees_sf
                - accumulated_referrer_fees_sf
                - pending_referrer_fees_sf
utilization_bps = floor(borrowed_amount_sf * 10_000 / net_supply_sf)
```

This follows the
[pinned reserve accounting](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/programs/klend/src/state/reserve.rs).
Use checked fixed-point/wide arithmetic and document the difference between exact
rational bps rounding and the protocol's intermediate fixed-point rounding.
The research probe handles zero/zero as zero and rejects nonzero debt with zero
supply, overflow/underflow and utilization above 100%. The upstream utilization
function does not impose that last bound; agree a production policy rather than
silently clamping or treating every such source state as corrupt.

Apply cadence, change thresholds and monotonic sequencing on-chain. Duplicate
keeper calls must not append duplicate samples. Store calculation slot/time,
source update slot/time, metric/configuration versions, and sequence. Rejected
refreshes retain the previous sample and its expiry. The consumer must not treat
failure as a fresh zero. Define an enforceable upgrade guard; measuring a
ProgramData account guard and a governance pause/monitoring alternative is part
of this phase.

**Exit gate:** real validator execution publishes the expected values and rejects
wrong-but-valid reserves, wrong owners/mints/markets, wrong order, stale source
state, unsupported configurations, overflow, emergency policy violations and
repeated publication. Record compute units, transaction size, loaded-account
bytes, fees and scheduling headroom.

### 3. Verify with cloned accounts, then a real devnet reserve

Clone the pinned mainnet reserve, market, mint, linked vaults and configured
oracles into an isolated local validator with the matching official Kamino
binary. Deploy a test Quorum direct-feed build there. A cloned oracle may need
its own refresh path as the local clock advances; resolve source freshness and
program dependencies without replacing production checks with fixture bypasses.
Retain negative cases and mark these runs **cloned local execution**.

Discover a devnet-native reserve using the official schema and filters, including
`dataSize=8624` and the reserve discriminator. Verify its complete market/mint/
oracle tuple and program revision. If no suitable reserve exists, prepare a
separate devnet test market with a test token and documented oracle setup.
Creating that market is an additional implementation/deployment step, not a
result of this read-only check. Keep per-cluster configurations separate.

Run direct-feed execution against those actual devnet accounts with two
independent keepers. Verify races, restarts, missed cadence, RPC failure,
configuration changes, account decoding and exact u64 handling in both generated
Quorum SDKs. The existing mock-based devnet SDK result covers the old interface
and cannot serve as evidence for these new instructions.

**Exit gate:** retained local and devnet transaction evidence distinguishes
clones, test-token state and actual protocol deployments; no address tuple is
accepted solely because it shares a name across clusters.

### 4. Ship keeper and reader integration

Add a Rust keeper that reads approved sources, builds the refresh transaction,
simulates, signs for fees, confirms and retries with bounded costs and RPC
failover. It does not calculate an authoritative submitted metric. Supply Docker
configuration with per-cluster source addresses and mounted fee-payer keys.

Regenerate the Quorum IDL and Rust/TypeScript clients for the new instructions
and accounts. Update the handbook/inspector to expose direct source identity,
configuration version, observation context, publication age and unavailable
state. Validate readers against truncated, substituted and expired accounts.

**Exit gate:** two keepers recover safely from races/restarts and a failed RPC,
and both SDKs pass actual execution/decoding checks on the new interface. A
read-only mainnet comparison can precede a narrowly enabled mainnet feed after
source approval and review.

### 5. Add yield, allocation and further protocols

Implement supply-interest APR and a separately defined APY conversion only after
the first two metrics pass. Handle the selected reserve's **time-based interest
mode**, its borrow curve, fee treatment and accrual context. Separate reserve
rewards from base interest and pin the reference's rounding/tolerance.
Do not derive a complete credit-risk coefficient from one reserve account.

Enable allocation only after the financial methodology, mandatory risk coverage,
coherent inputs, category/venue caps, insufficient-capacity policy and execution
freshness are resolved. Portfolio capital execution remains a separate component.
Each further source repeats the public-source pinning, account verification,
metric definition, cloned execution and cluster-specific SDK gates. Wrapper
exposures must retain their underlying venue identity.

**Exit gate:** independent math/decoder validation, measured SBF execution,
security review, operational monitoring and a staged release for the exact
supported metric scope.

## Reproduce the research checks

Use Git, Node 24.16.0, Rust 1.96.0 and the native libraries documented for the SDK
build. From the repository root:

```bash
node --experimental-strip-types integrations/kamino/scripts/pull-sources.ts
CARGO_TARGET_DIR=workers/target cargo test --locked \
  --manifest-path integrations/kamino/probe/Cargo.toml
CARGO_TARGET_DIR=workers/target cargo build --locked \
  --manifest-path integrations/kamino/probe/Cargo.toml

# Use new output names; the probe refuses to overwrite an existing report.
workers/target/debug/quorum-kamino-probe --network mainnet \
  --release-binary testing/devnet/.state/integrations/kamino/kamino_lending-v1.25.0.so \
  --output testing/devnet/.state/integrations/kamino/mainnet-new.json \
  --fixtures testing/devnet/.state/integrations/kamino/fixtures-new.json
workers/target/debug/quorum-kamino-probe --network devnet \
  --output testing/devnet/.state/integrations/kamino/devnet-new.json
```

The pull script checks the pinned Git revisions, selected source hashes and
release binary checksum. Source checkouts and the ELF stay under ignored
`.state/`; the native Cargo dependency is pinned to the same revision.
`QUORUM_KAMINO_RPC_URL` can select a compatible endpoint; genesis is checked.
Reports do not record a credential-bearing endpoint. The probe has no signing,
transaction submission, wallet or balance-transfer path.

Four offline Rust tests cover identity/layout rejection, fee-adjusted supply,
integer limits/rounding, and replay of the captured mainnet reserve. CI runs
these tests with the committed lockfile and fixture; it does not make mainnet
RPC calls. Publication and keeper tests remain exit gates above.

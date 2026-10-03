# Open questions and verification ledger

This file distinguishes implementation gaps, design choices and checks that have
actually run. A successful mock test does not establish production readiness.

## Correctness and security

1. **Registry bootstrap authority — implemented.** Initialization now requires
   the deployed program's upgrade authority. The fresh-ledger price suite checks
   exact outsider rejection before the admin initializes. Governance handoff,
   immutable deployment and loader-v4 compatibility still need a policy.
2. **Chronological finalization — implemented.** Sample windows and allocation
   rounds cannot overwrite newer results; brakes use window closing time rather
   than crank execution time. The suite exercises reversed sample/allocation
   finalization. Additional delayed-crank and configuration-race cases remain.
3. **Quorum bounds — implemented; membership policy open.** Zero and quorums above
   64 are rejected. Decide whether membership is frozen per round and whether removed operators'
   earlier votes remain valid. Define the tolerated dishonest-operator fraction.
4. **Allocation snapshot agreement.** `minContextSlot` is a lower bound, not an
   exact historical read. Define a common round anchor, latest-before ring reads,
   input sequence/hash commitment and mismatch rejection. This is not implemented.
5. **Excluded zeros — fixed; cap policy open.** Renormalization preserves zero
   weights; rounding/cap redistribution includes eligible tiny-yield venues.
   Native and runtime tests cover these fixes. Decide how aggregated weights must
   preserve venue/category caps when medians or rounding change the sum.
6. **Fake data.** Membership and median agreement do not prove a reported price
   matches a protocol account. A malicious majority can agree on false values.
   Define validation, source ownership/layout checks, bounds, accountability and
   whether independent source backends are required.
7. **Feed configuration changes.** Define whether changes are forbidden during
   open rounds or versioned, especially changes to window width and aggregation.
8. **Round retention.** Consensus accounts accumulate rent. Define retention and
   authorized account closure without allowing replay or loss of audit history.

## Production implementation

9. **Financial methodology.** Supply `ALLOCATION_METHODOLOGY.md` and
   `analysis/risk_scoring.py`; reconcile CRR threshold equality, full CRR
   derivation, Jupiter collateral composition, venue and category caps.
10. **Insufficient capacity / all inputs stale.** Rubric output can total less
    than 10,000; the program requires exactly 10,000. Choose cash/reserve weights,
    explicit halted state or another documented policy. Never silently inflate
    unsafe positions to satisfy the sum.
11. **Missing risk inputs.** Production consumers must validate required APY/CRR
    coverage rather than treating absent CRR as zero risk. Per-feed staleness
    tolerances and invalid/duplicate mapping validation remain to be implemented.
12. **Production daemon lifecycle.** Discover and advance allocation rounds,
    finalize them, avoid duplicate fees and recover all missed sample windows.
    Submission errors must propagate; RPC failover must include transactions.
13. **Real protocol drivers.** Implement and fixture-test Marginfi, Kamino, Save,
    Jupiter and Loopscale decoders, units, owner/discriminator checks and overflow
    handling. HTTP mock price providers are test-only and not these drivers.
14. **Provider SDK.** Generate the IDL and TS/Rust clients, compile them and test
    their instruction/account serialization against the program.
15. **Deployment/toolchains — partially verified.** SBF v3 builds and actual local
    deployments run with Agave 4.3.0/platform-tools v1.57, host Rust 1.96 and
    Anchor 1.0.2. Keys and ledgers stay ignored; explicit buffer keys, base64 reads
    and rent funding are tested. Public devnet execution is funding-blocked;
    clean container builds and a reproducible installer/CI image remain open.
16. **CI and expanded runtime tests.** Native byte-view tests cover wrapped-ring
    reading, discriminator/head rejection, truncation and staleness boundaries;
    not 256 on-chain appends. Cover boundary slots, missing accounts,
    restarts, RPC drift/outages, stale backend inputs under a live validator,
    normalization/cap invariants and repeatable multi-operator tests.

## Explicitly deferred scope

Jito NCN/restaking integration, rebalancing actual capital, monitoring services,
dashboards, backtesting and temporal statistics are outside this test setup.

## Test result ledger

- Baseline: 26 native tests passed; no live validator tests had been run.
- Current run: [testing/devnet/RESULTS.md](testing/devnet/RESULTS.md) separates
  local-validator execution, offline checks and public devnet funding evidence.
  A mock pass is not a financial-methodology validation or security audit.

# Open questions and verification ledger

This file distinguishes implementation gaps, design choices and checks that have
actually run. A successful mock test does not establish production readiness.

## Correctness and security

1. **Registry bootstrap authority.** Restrict initialization to the deployed
   program's upgrade authority; test an outsider attempting to initialize first.
2. **Chronological finalization.** Older sample windows and allocation rounds must
   never overwrite newer results. Brakes should use sample window time, not the
   crank's execution time. Test delayed and reversed finalization.
3. **Quorum bounds and changes.** Reject zero and quorums above 64 operators.
   Decide whether membership is frozen per round and whether removed operators'
   earlier votes remain valid. Define the tolerated dishonest-operator fraction.
4. **Allocation snapshot agreement.** `minContextSlot` is a lower bound, not an
   exact historical read. Define a common round anchor, latest-before ring reads,
   input sequence/hash commitment and mismatch rejection. This is not implemented.
5. **Excluded venues and normalization.** Preserve universally excluded zero
   weights. Define what happens when coordinate-wise median or rounding changes
   the sum, and how aggregate weights must preserve venue/category caps.
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
15. **Deployment/toolchains.** Pin supported Rust/Solana/Anchor versions, verify
    clean SBF builds and container builds, and keep every signing key ignored.
16. **CI and expanded runtime tests.** Cover ring wraparound, boundary slots,
    missing accounts, malformed data, restarts, RPC drift/outages, stale inputs,
    normalization/cap invariants and repeatable multi-operator tests.

## Explicitly deferred scope

Jito NCN/restaking integration, rebalancing actual capital, monitoring services,
dashboards, backtesting and temporal statistics are outside this test setup.

## Test result ledger

- Baseline: 26 native tests passed; no live validator tests had been run.
- Current run: see `testing/devnet/RESULTS.md` once the setup and scenarios finish.
  Keep local-validator evidence separate from actual devnet evidence.

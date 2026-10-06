# Quorum open questions and verification ledger

This file distinguishes implementation gaps, design choices and checks that have
actually run. A successful mock test does not establish production readiness.

The [protocol roadmap](ROADMAP.md) proposes replacing value voting for
account-derived metrics with on-chain adapters and off-chain keepers, followed
by deterministic on-chain allocation. These changes are planned, not implemented.
The items below describe current behavior; close or replace them only after the
roadmap's corresponding acceptance gates pass.

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
    Kamino now has [pinned-source, read-only mainnet verification](integrations/kamino/README.md)
    and captured account fixtures. The deployed binary matches the official
    v1.25.0 artifact; direct on-chain calculation/publication remains an
    implementation gate. The selected mainnet reserve is absent on devnet.
14. **Provider SDK — current MVP verified on devnet.** Compiler-built IDL and
    pinned Codama renderers generate Rust/TypeScript clients; both compile,
    including the Rust RPC fetch feature. The 2026-10-06 run passed 22 checks
    and 20 confirmed transactions (nine program transactions per SDK plus two
    funding transfers), covering all five account decoders and parity for all
    12 instructions. Ten instruction types executed; fresh registry/allocation
    bootstrap was not repeated against existing singleton accounts. See
    [SDK integration](sdk/README.md) and [public evidence](testing/devnet/evidence/sdk-devnet-2026-10-06.json).
    Package publication, production-daemon adoption, and SDK/runtime verification
    for the roadmap's new source-bound refresh instructions remain open.
15. **Deployment/toolchains — locally and on devnet verified.** SBF v3 builds and
    actual local/devnet deployments run with Agave 4.3.0/platform-tools v1.57, host Rust 1.96 and
    Anchor 1.0.2. Keys and ledgers stay ignored; explicit buffer keys, base64 reads
    and rent funding are tested. The user funded the test wallet; both programs
    are deployed and all 16 public-devnet scenarios passed. TPU upload and a
    shared paced RPC gateway resolved observed public endpoint throttling;
    wider windows and batched fixture votes resolved premature window closure.
    The final devnet run reused an initialized registry; fresh bootstrap authority
    rejection was covered on the historical fresh local validator, not repeated
    on this final public-devnet run. A new full rerun needs additional test SOL.
    Node 24.16.0/TypeScript 5.9.3, clean `npm ci`, strict compilation and the
    pinned dependency audit passed. Clean frontend and worker container builds,
    the frontend health check, five container browser tests and offline worker
    startup checks passed on 2026-10-05. GitHub CI and GHCR publication workflows
    are checked in and syntax-validated; execution on GitHub remains unverified.
    Reproducible installation of the SBF deployment toolchain remains open.
16. **CI and expanded runtime tests.** TypeScript byte-view tests cover wrapped-ring
    reading, discriminator/head rejection, truncation and staleness boundaries;
    not 256 on-chain appends. The TypeScript local-validator suite now covers
    16 scenarios on both a local validator and public devnet, with separate
    provider/consumer processes. Cover boundary slots,
    missing accounts,
    restarts, RPC drift/outages, stale backend inputs under a live validator,
    normalization/cap invariants and repeatable multi-operator tests.
17. **mdBook integration frontend — implemented, adapters remain open.** Searchable
    documentation and a read-only devnet inspector pass nine TypeScript model
    tests, five desktop/mobile browser checks and actual public-devnet browser
    reads during and after the suite. The reader validates network, owners/layouts and price freshness; it has
    no wallet/signing or backend price access. Named protocol pages describe
    integration requirements, not implemented adapters. Production account
    mappings, generated SDK integration, allocation freshness and deployment
    configuration/versioning remain open. See [docs/book/README.md](docs/book/README.md).

## Explicitly deferred scope

Jito NCN/restaking integration, rebalancing actual capital, continuous monitoring,
production dashboards, backtesting and temporal statistics are outside this test
setup. The new read-only inspector is a test-deployment view, not a capital UI.

## Test result ledger

- Baseline: 26 native tests passed; no live validator tests had been run.
- Historical TypeScript local workflow: 30 unit/HTTP tests and all 16 actual
  local-validator scenarios passed (17 Node tests including the parent), with
  219 distinct confirmed suite transactions. The verified ledger is
  `testing/devnet/.state/localnet/ledger-typescript-2026-10-03`.
- Current TypeScript public-devnet workflow: **36 unit/HTTP/pacing tests and all
  16 public-devnet scenarios passed**, with 170 distinct confirmed suite
  transactions; 17 Node tests including the parent, no failures or skips.
  Both program deployment signatures, literal output and public snapshots are
  saved in [the full results](testing/devnet/RESULTS.md).
- mdBook frontend: **9 model/navigation + 5 browser tests passed**; its live
  browser case passed in two actual devnet runs (fresh during the suite, stale
  afterward). Entirely TypeScript testing; static book build verified.
- Generated Rust/TypeScript SDKs: **22 checks and 20 confirmed devnet transactions
  passed on 2026-10-06**. Both SDKs publish and decode exact u64 values above
  2^53; temporary membership is removed and existing allocation weights retained.
- [testing/devnet/RESULTS.md](testing/devnet/RESULTS.md) separates current
  TypeScript execution, historical checks and public devnet execution evidence.
  Python and Rust off-chain test harnesses were removed; on-chain programs and
  supplementary native production tests remain Rust.
  A mock pass is not a financial-methodology validation or security audit.

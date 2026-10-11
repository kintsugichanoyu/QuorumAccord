# Contract logic review — 2026-10-10

**Remediation update — 2026-10-11:** all six findings below have been addressed in
the policy-bound v2 contract and deployed on devnet. This report preserves the
original reproductions. See [the current implementation inventory](../../deployment/devnet/BUILT-AND-MISSING.md)
and [compiled-program lifecycle evidence](../../deployment/devnet/evidence/v2/local-lifecycle.json).
The older standalone Rust consumer and legacy harnesses still need v2 migration.

Reviewed `../task.pdf` (10 pages) against all 13 Rust source files in
`programs/quorum-allocation`. The requested `programs/quorum-allocator` directory
does not exist. This review includes the working-tree rent-reclamation additions.
It is a contract review; it does not certify the off-chain financial methodology
or the PDF's full worker/deployment success criteria.

The contract is not fully correct against the brief. The basic authorization,
unique-voter, slot-window, ring-index and chronological-publication checks are
present, but the following cases require changes or explicit policy decisions.

## Findings

### 1. P1 — Consensus can publish allocations above every submitted venue cap

Location: `programs/quorum-allocation/src/aggregation.rs:77` and
`programs/quorum-allocation/src/state/allocation.rs:55`.

Three valid submissions, each respecting a 50% cap, can be:

```text
[5000, 5000,    0,    0, ...]
[5000,    0, 5000,    0, ...]
[5000,    0,    0, 5000, ...]
```

Coordinate-wise median yields `[5000, 0, 0, 0, ...]`. Renormalization gives the
entire 5000-bps deficit to the only positive venue. The program successfully
publishes `[10000, 0, 0, 0, ...]`. This was reproduced by executing the compiled
program on an isolated local validator, not only by a mathematical model.

The PDF's page 1 requires venue and category caps. Applying them separately in
each consumer does not preserve them through this aggregation. The repository's
revised `specs/SPECIFICATION.md` and `OPEN_QUESTIONS.md` acknowledge this as an open
policy; it remains a correctness gap relative to the supplied task.

Recommendation: define the admissible allocation constraints at the consensus
boundary and enforce them after aggregation, with deterministic redistribution
within remaining capacity. Handle insufficient capacity explicitly. A policy
that selects an admissible complete vector is another possible design.

### 2. P2 — Divergence arithmetic underestimates large changes

Location: `programs/quorum-allocation/src/aggregation.rs:13`.

`diff.saturating_mul(10000) / last` saturates before division. For
`last = 10^18` and `current = 2 * 10^18`, the program returns **18 bps**, while
the PDF's formula returns **10000 bps**. At a 30-bps threshold this suppresses
the divergence trigger, leaving a materially changed feed unchanged until the
maximum interval forces publication. The generic U64 feed permits these values;
the issue is not limited to APY-sized numbers.

Recommendation: multiply and divide in `u128`; clamp only the final quotient if
the public return type must remain `u64`. A source-importing native probe
reproduces the exact result.

### 3. P2 — Stale completed windows cannot reach a reclaimable terminal state

Locations: `programs/quorum-allocation/src/instructions/sample.rs:219`,
`programs/quorum-allocation/src/instructions/allocation.rs:182`, and the
`close_*_consensus` handlers' non-Open checks.

Open two rounds, let both expire, and finalize the newer one first. Finalizing
the older one now returns `StaleRound` (6018), leaving its status `Open`.
Reclamation returns `RoundNotOpen` (6008) because it requires a non-Open status.
Further submissions are forbidden by the elapsed deadline. No instruction can
finish or close that account. This was reproduced for both sample and allocation
consensus, locking their creation rent. On allocation rounds, the stale check
also precedes the below-quorum branch, so even an empty obsolete round can be
stranded.

Recommendation: make an expired, superseded round terminal without publishing
its output, or permit an authorized close that independently proves it cannot
advance state. Preserve the existing protection against overwriting newer data.

### 4. P2 — Valid votes can produce an unfinalizable, unreclaimable median round

Locations: `programs/quorum-allocation/src/aggregation.rs:70` and
`programs/quorum-allocation/src/instructions/allocation.rs:194`.

Three valid vectors `[10000,0,0,...]`, `[0,10000,0,...]` and `[0,0,10000,...]`
have an all-zero coordinate-wise median. Renormalization returns unchanged;
finalization then rejects with `InvalidRatios` (6016), keeping the round `Open`.
Its deadline prevents new votes and the close handler rejects its status. The
local-validator probe confirmed both rejections. Repeating such distributions
also prevents new allocation publication despite satisfying numerical quorum.

Rejecting an invented allocation is a defensible policy, and the revised local
spec explicitly does so. Leaving the account permanently Open is not a complete
lifecycle. The PDF's page 5 promise of a valid 10000-bps output after aggregation
also needs to be reconciled with this case.

Recommendation: specify a deterministic disagreement outcome or admissible
fallback. An aborted round should become terminal while retaining the last good
AllocationState; it should remain reclaimable.

### 5. P2 — Updating window width can collide with old consensus addresses

Location: `programs/quorum-allocation/src/instructions/data_feed.rs:105`, in
combination with the `window_index`-only consensus seed in `sample.rs:49`.

`window_index = floor(slot / window_slots)` is both schedule-dependent and part
of the PDA address. The admin can change `window_slots` without a schedule
version or migration. In the local reproduction, an 80-slot feed finalized
index 11. Updating the width to 87 made the new current window index 11 too.
Proposing failed with account-already-in-use; corroborating the retained account
failed with `WindowClosed` (6009). A feed can lose otherwise eligible windows
after an ordinary configuration update. This case does not require updating a
still-open round.

Recommendation: version the schedule/PDA namespace, use a stable window identity
such as a properly versioned closing slot, or make window width immutable for an
existing feed. Merely retaining the original width for corroboration does not
solve address reuse. Decide how threshold/brake changes affect pending rounds
as part of the same configuration policy.

### 6. P2 — Configuration accepts contradictory minimum and maximum intervals

Location: `programs/quorum-allocation/src/instructions/data_feed.rs:39`.

Validation accepts `min_interval_slots=1000` and `max_interval_slots=1` (confirmed
on the local validator). Finalization applies the minimum brake before the
maximum refresh trigger, so the configured maximum cannot force refresh for
the first 999 elapsed slots, even with full quorum. This contradicts the
maximum-interval meaning on PDF page 6 and can make downstream freshness
expectations impossible to satisfy.

Recommendation: validate the allowed relationship between minimum, maximum and
window width. At minimum, reject `min_interval_slots > max_interval_slots`;
document boundary quantization when intervals do not divide the window width.

## Requirements that need reconciliation

- **Common consumer inputs are not enforced.** PDF pages 5 and 10 describe the
  allocation round as a shared input time slice. `submit_weights` receives only
  `round` and `weights`; the round has no feed ticks, historical anchor, policy
  version or input commitment. A common deadline alone cannot make independently
  read feed heads identical. The revised repository spec correctly acknowledges
  this gap. Define a shared input anchor/commitment if matching snapshots are a
  requirement; otherwise state the permitted disagreement explicitly.
- **Normalization intentionally differs from page 5.** The PDF adds a deficit
  to the smallest weight, including zero. The implementation adds it to the
  smallest positive weight. For three mean-aggregated vectors that round to
  `[3333,3333,3333,0,...]`, the implementation produces
  `[3334,3333,3333,0,...]`; the literal PDF rule produces
  `[3333,3333,3333,1,...]`. Preserving excluded zeros is sensible; reconcile the
  specification rather than blindly restoring allocation to excluded venues.
- **The PDF alone cannot specify the full financial formula.** It refers to
  `ALLOCATION_METHODOLOGY.md` and `analysis/risk_scoring.py`, which are absent in
  this repository. Contract consensus correctness is not verification of the
  consumer's complete CRR derivation, screening and category-cap methodology.

## Verification and evidence

- `cargo test --locked -p quorum-allocation`: **13 passed**. Existing tests do not
  establish the invariants identified above.
- `arithmetic-probe.rs` imports the actual Rust aggregation source and verifies
  divergence underestimation, the cap violation, all-zero median and the PDF
  normalization difference. Compile with `rustc -Awarnings` and run.
- `local-validator-probe.mjs` executed the existing SBF binary against a dedicated
  validator at `127.0.0.1:18899`, with an isolated upgrade-authority wallet and
  local airdrops. Six recorded cases passed their assertions about the problematic
  behavior; see `local-validator-results.json`. Negative cases use simulation;
  positive cases execute and confirm actual local transactions.
- Probes retain absolute workspace paths and the test-wallet location
  `/tmp/quorum-logic-review/admin.json`; they are reproduction records, not a new
  production test runner. No private key is copied into this report directory.
- `reviewed-sha256.json` records the reviewed Rust sources, compiled SBF and PDF.
- Graph mapping covered 134 nodes and 290 edges, with no missing or dangling
  endpoints. Findings were checked against source and execution, rather than
  inferred solely from the graph.
- The isolated validator was stopped after testing. All four requested devnet
  Docker services were checked and remained running and healthy.

No contract fixes or new deployment were performed as part of this review.

## 1. Allocation with proof.

A USDC decision engine you can inspect, from source rates to signed consensus.

- Real mainnet supply APY.
- Two stages of devnet consensus.
- Every published allocation has committed inputs.

Speaker notes: Open the live dashboard before the pitch. This is a functioning decision prototype; it publishes allocation weights and does not move capital.

## 2. A yield number is only the beginning.

An allocation also depends on freshness, risk assumptions, concentration limits, and agreement.

- Markets update on independent clocks. A consumer must reason about the actual age of each input.
- Independent operators can disagree. Publishing a number does not explain who signed it or why.
- An apparently valid vote can aggregate into an invalid portfolio. Constraints must survive consensus.

Speaker notes: These are design requirements demonstrated by the implementation and review. No market-size or customer-traction claim is made.

## 3. Make the whole decision visible.

One workspace connects live feed data, allocation policy, and the on-chain proof.

- Observe: read finalized USDC supply rates, feed ticks, source accounts and freshness.
- Explore: simulate risk discounts and venue caps using the exact consumed input snapshot.
- Verify: inspect individual consumer vectors, the input hash, decoded instructions and program logs.

Speaker notes: Switch to the dashboard and demonstrate Overview, Policy lab and On-chain proof. The simulator performs no signing.

## 4. Consensus, twice.

Agreement on observations, then agreement on allocation weights.

- 9 producers → 3 median feeds
- Freeze inputs + policy on chain
- 3 consumers → 1 AllocationState

Speaker notes: Nine processes have separate producer wallets. Three consumer processes have separate wallets. A coordinator opens rounds and a separate service paces RPC traffic. All run locally under one administrator.

## 5. One feed per producer. Three voices per feed.

Marginfi, Save and Kamino share mainnet USDC, making the comparison concrete.

- Marginfi: 3 separately signing producers; 120-slot cadence; 240-slot freshness limit.
- Save: 3 separately signing producers; 180-slot cadence; 360-slot freshness limit.
- Kamino: 3 separately signing producers; 240-slot cadence; 480-slot freshness limit.

Speaker notes: Each producer fetches only its assigned protocol using pinned SDK decoding. The source account owner, mint and parent market/group are checked. APY is base supply interest, excluding incentives.

## 6. Different clocks. The same consumed inputs.

A RoundContext account fixes the values, ticks, sample slots, eligibility, policy and authorized consumer set.

- Published round 509857083
- Snapshot anchor slot 509857093
- SHA-256 ca09e6fc4332314130baec5d18f78ed82c2d99d060095d3a77ac6070f9c86486

Speaker notes: The open instruction reads all configured feed accounts atomically. Consumers need not wait for matching finalized slots. Every vote includes the exact input hash. The browser re-hashes the serialized snapshot bytes.

## 7. Constraints are part of publication.

The program checks each vote and the final aggregated vector against the frozen policy.

- 50% per-venue cap. Save + Kamino share a 75% illustrative category budget.
- 5% / 10% / 15% illustrative risk discounts. Inputs at or above a 60% discount are screened.
- Stale or screened positions stay at zero. Infeasible and zero-median results close without overwriting published state.

Speaker notes: These are demo policy settings, not externally verified financial risk scores. Full risk methodology and category definitions need a separate integration. Caps apply on chain; the median cannot normalize itself into a prohibited allocation.

## 8. A complete local devnet fleet.

Separate services make each role and its evidence reviewable.

- 9 | Single-feed producer containers
- 3 | Consumer containers with separate wallets
- 3 | Coordinator, RPC gateway and read-only web services

Speaker notes: All fifteen containers use Docker health checks and restart policies. Producer and consumer keys are mounted as separate secrets. The web service exposes no signing keys or Docker socket. The Fleet tab reports an actual timestamped Docker check and worker heartbeats.

## 9. Six confirmed logic issues addressed.

The contract review became reproducible regression checks.

- Cap-breaking median renormalization → policy-constrained publication or safe abort.
- Divergence overflow → u128 arithmetic before division.
- Superseded rounds → terminal, reclaimable accounts.
- Zero median → terminal no-publication outcome.
- Window-width changes → immutable feed cadence / new feed required.
- Contradictory min/max intervals → configuration rejected.

Speaker notes: Legacy allocation entrypoints are disabled to prevent bypassing the v2 policy. Existing feed PDAs retain their layout. SDK IDL and worker codecs include the new policy-bound instructions.

## 10. A real published decision.

USDC allocation read from devnet at 2026-10-11T09:29:57.938Z.

- Marginfi | 50.00%
- Save | 15.98%
- Kamino | 34.02%

Speaker notes: This slide is a captured observation, not the live dashboard. The underlying weights sum to 10,000 basis points. Three registered consumer signatures are required. Use the linked accounts and transactions to inspect the result.

## 11. Demonstrate disagreement and loss.

Five devnet experiments, with recorded transaction signatures.

- Verified: One extreme producer cannot move the median
- Verified: Losing one consumer prevents publication
- Verified: Restart recovers from on-chain round state
- Verified: Stale inputs do not force an invalid allocation
- Verified: The full pipeline resumes after feed recovery

Speaker notes: Separate recorded experiments from current live state. An injected devnet producer outlier is explicitly labeled in its journal; two honest observations preserve the median. Quorum loss and infeasible stale-input rounds retain the previous AllocationState. One extreme producer cannot move the median: Injected 999,999 bps into one Marginfi producer. Three signed reports finalized to 700 bps, the median of the reports. Losing one consumer prevents publication: With consumer-3 stopped, a round collected two votes and closed with no quorum. AllocationState retained an earlier published round. Restart recovers from on-chain round state: The restarted consumer resumed with its existing wallet, read the active snapshot, and restored a three-signature publication with no duplicate operator votes. Stale inputs do not force an invalid allocation: After all Marginfi producers stopped, its feed exceeded the configured freshness limit. Save and Kamino share a 75% category cap, so every consumer abstained. The round closed and the previous allocation was retained. The full pipeline resumes after feed recovery: All producers resumed from persistent state, refreshed the independent feeds, and three consumers published a valid allocation with all inputs eligible.

## 12. Proof beyond a screenshot.

Unit checks, compiled-program lifecycle checks, devnet transactions, and a browser proof viewer.

- 21 | Native contract tests
- 12 | Local-validator lifecycle checks against the SBF binary
- 45 | RPC/client + allocation JavaScript unit tests

Speaker notes: The JavaScript total is 38 testing/devnet unit tests plus 7 fleet/rubric tests. Lifecycle checks cover policy authorization, input hashes, independent cadences, caps, zero medians, quorum, stale inputs, expiry and rent cleanup. Devnet observations and scenario counts are recorded in the evidence folder.

## 13. A decision pipeline with an audit trail.

The end-to-end path is live, bounded and reproducible.

- Rates from three real mainnet USDC accounts flow through separately signing producer processes.
- Three consumers agree on frozen asynchronous inputs and publish policy-valid allocation weights on devnet.
- The presentation can show source provenance, account bytes, transaction decoding, container health and recovery.

Speaker notes: It does not prove organizational decentralization or truth of a reported source rate through an on-chain mainnet verification mechanism. The demo has one host, one administrator and shared public RPC access.

## 14. The path from prototype to production.

Each milestone adds a capability or reduces an explicitly known dependency.

- Expand toward approximately ten distinct feeds across four or five protocols.
- Integrate the full specified risk methodology and externally grounded category policy.
- Run independent operators on separate hosts with independent RPC providers.
- Migrate legacy standalone Rust consumers and harnesses to the policy-bound v2 interface.
- Evaluate Jito delivery, production monitoring, budget replenishment, and a security audit.
- Design capital execution, portfolio accounting, and mainnet rollout as separate stages.

Speaker notes: The original task references methodology detail that was not fully supplied. Current risk settings are illustrative. Jito and capital movement are not implemented. Public devnet RPC and devnet SOL budgets remain operational dependencies.

## 15. Inspect a decision. Watch a recovery.

Use the dashboard as the product demonstration, and the proof as the review artifact.

- 1. Open Overview and the consumed-input proof.
- 2. Move a risk or cap slider in the Policy lab.
- 3. Show Fleet status, then the recorded resilience experiments.

Speaker notes: Recommended presentation flow: pitch first, then the live dashboard. Keep a terminal showing scripts/devnet/show-fleet.sh beside the browser. Use transaction Explorer links when an audience wants independent confirmation.
# Reflect — consensus data feeds and capital allocation

Reflect is a Solana allocation-oracle MVP. Registered operators publish metric
samples by consensus into on-chain ring buffers. Allocation consumers read those
feeds, apply an integer-only risk rubric and submit weight vectors by consensus.
It publishes data and weights; it does not move capital or implement Jito NCN
restaking yet. Production drivers currently support generic on-chain u64 fields,
not complete integrations with named lending protocols.

- Contract and design: [specs/SPECIFICATION.md](specs/SPECIFICATION.md)
- Isolated mock protocol lab: [testing/devnet/README.md](testing/devnet/README.md)
- Verification evidence: [testing/devnet/RESULTS.md](testing/devnet/RESULTS.md)
- Missing work and design decisions: [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)

## Layout

```text
programs/reflect-allocation/   Anchor 1.0.2 program: registry, feeds, allocation
workers/                      Separate Rust workspace for production workers
  worker-core/                RPC, signing, codecs, PDA and instruction builders
  producer/                   Generic on-chain metric producer
  consumer/                   APY/CRR allocation consumer (MVP lifecycle)
  rubric/                     Fixed-point risk scoring, screening and caps
testing/devnet/               Test-only code, never a production data dependency
  backend/                    Atlas/Boreal/Cygnus deterministic HTTP protocol APIs
  price-lab/                  Three signed providers, chain-only price consumer
  programs/mock-oracle/       Writable fixture account program for allocation tests
  allocation-e2e/             Original allocation/brake/trigger integration harness
  run.py                      Build, fund, deploy and verify localnet/devnet
  .state/                     Ignored keys, ledger, logs and machine-readable results
sdk/                          Codama client generation scaffold
docker/                       Production worker fleet scaffold
sims/                         Proposed simulation matrix, not an executed test suite
```

## Build and verify

```bash
cargo test --locked
cargo test --manifest-path workers/Cargo.toml --locked
python3 -m unittest discover -s testing/devnet/backend -v

# Actual SBF deployment and signed multi-provider execution on a local validator
python3 testing/devnet/run.py --network localnet --legacy-allocation

# Public devnet: verifies genesis, requests test SOL, deploys and runs price tests
python3 testing/devnet/run.py --network devnet
```

The lab needs Rust >=1.88, Solana CLI/platform tools and Python 3; tested toolchain
versions and setup are in its README. It does not need Anchor CLI, Node or Docker.
Fresh test keys synchronize the program IDs before building. Keys are ignored and
the runner does not change your global Solana configuration or reset ledgers.

For the separate SDK/container workflow, install the compatible Anchor CLI, build
the IDL, then run the Codama generator or Docker Compose. These paths are not
claimed verified by the price lab.

## Implemented guarantees and limits

Registry initialization is restricted to the program's upgrade authority.
Quorums must be 1..64, matching the registry capacity. Duplicate and unregistered
votes are rejected. Sample and allocation finalization cannot overwrite a newer
published result. Sample brakes use window closing slots, not crank delay.
Allocation renormalization preserves excluded zero-weight venues and publishes
exactly 10,000 bps when the aggregated input has eligible positive weights.

The program has five account types: `OperatorRegistry`, `DataFeed`,
`DataFeedConsensus`, `AllocationConsensus` and `AllocationState`. Membership is
checked when a vote is submitted, not frozen at round creation. Consensus proves
operator agreement, not the truth of a source value.

The test-only price consumer validates account owner, discriminator, ring bounds
and freshness and reports the actual RPC context for each read. Production
allocation inputs are **not** yet a coherent historical snapshot: `minContextSlot`
only sets a lower bound. Missing-risk handling, round lifecycle recovery, cap
preservation after aggregation, real protocol decoders and source validation
remain release blockers. See the open-question ledger for the complete scope.

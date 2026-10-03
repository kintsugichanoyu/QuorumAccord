# Reflect — consensus data feeds and capital allocation

Reflect is a Solana allocation-oracle MVP. Registered operators publish metric
samples by consensus into on-chain ring buffers. Allocation consumers read those
feeds, apply an integer-only risk rubric and submit weight vectors by consensus.
It publishes data and weights; it does not move capital or implement Jito NCN
restaking yet. Production drivers currently support generic on-chain u64 fields,
not complete integrations with named lending protocols.

- Contract/design: [specs/SPECIFICATION.md](specs/SPECIFICATION.md)
- TypeScript test setup: [testing/devnet/README.md](testing/devnet/README.md)
- Verification evidence: [testing/devnet/RESULTS.md](testing/devnet/RESULTS.md)
- Missing work and decisions: [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)

## Layout

```text
programs/reflect-allocation/   Production Anchor 1.0.2 program
workers/                      Production Rust worker workspace
  worker-core/                RPC, signing, codecs, PDAs and instructions
  producer/                   Generic on-chain metric producer
  consumer/                   APY/CRR allocation consumer MVP
  rubric/                     Fixed-point risk scoring, screening and caps
testing/devnet/               Isolated TypeScript test package
  src/                        Mock HTTP backend, providers, price consumer, runner
  tests/unit/                 TypeScript codecs, HTTP, quote and deployment tests
  tests/integration.test.ts   TypeScript on-chain multi-provider assertions
  programs/mock-oracle/       Rust on-chain fixture (not a Rust test harness)
  evidence/                   Public-only verification snapshots
  .state/                     Ignored keys, ledgers, logs and generated reports
sdk/                          Codama client-generation scaffold
docker/                       Production worker fleet scaffold
sims/                         Proposed simulation matrix
```

## Build and verify

```bash
npm --prefix testing/devnet ci
npm --prefix testing/devnet test
npm --prefix testing/devnet run localnet
npm --prefix testing/devnet run devnet

# Compilation checks for production Rust, separate from TypeScript testing:
cargo check --locked
cargo check --manifest-path workers/Cargo.toml --locked
```

The test workflow requires Node >=22.12, npm and Solana CLI/platform tools.
Python, Anchor CLI and compiled Rust test clients are not needed. The runner
builds real SBF programs and executes all off-chain test logic in TypeScript.
Fresh keys synchronize the deployment IDs; generated keys and ledgers are ignored.
Existing ledgers are never reset and global Solana CLI configuration is unchanged.

SDK generation and Docker remain separate, unverified workflows. Native Rust
unit tests remain alongside production implementations; they are not invoked by
the TypeScript test runner.

## Guarantees and limits

Registry initialization requires the program's upgrade authority. Quorums are
1..64. Duplicate and unregistered votes are rejected. Older sample windows and
allocation rounds cannot overwrite newer published results. Brakes use window
closing slots, not crank delay. Allocation renormalization preserves excluded
zero-weight venues.

The test price consumer verifies account owner, discriminator, identity, bounds
and freshness and requires no signing files. It uses bigint values and
decimal-string JSON. It does not contact the fixture backend.

Consensus proves operator agreement, not source truth. Membership is checked at
submission, not frozen per round. Production allocation reads are not a coherent
historical snapshot. Missing-risk handling, cap preservation after aggregation,
real protocol decoders, lifecycle recovery and financial-methodology validation
remain release blockers. See the open-question ledger before production use.

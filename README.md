# Quorum — consensus data feeds and allocation signals

Quorum is a Solana allocation-oracle MVP. Registered operators publish metric
samples by consensus into on-chain ring buffers. Allocation consumers read those
feeds, apply an integer-only risk rubric and submit weight vectors by consensus.
It publishes data and weights; it does not move capital or implement Jito NCN
restaking yet. Production drivers currently support generic on-chain u64 fields,
not complete integrations with named lending protocols.

The [protocol roadmap](ROADMAP.md) moves account-derived metrics toward on-chain
Rust validation and calculation, with off-chain keepers triggering transactions.
It starts with Kamino and later moves deterministic allocation on chain. These
milestones are planned; the current deployment still uses operator submissions.

- Contract/design: [specs/SPECIFICATION.md](specs/SPECIFICATION.md)
- Protocol evolution roadmap: [ROADMAP.md](ROADMAP.md)
- Project frontend: [frontend/README.md](frontend/README.md)
- GitHub and Docker deployment: [docs/book/src/deployment.md](docs/book/src/deployment.md)
- Public-release review and launch steps: [docs/book/src/public-release.md](docs/book/src/public-release.md)
- Rust worker integration: [docs/book/src/workers.md](docs/book/src/workers.md)
- Generated Rust/TypeScript SDKs: [sdk/README.md](sdk/README.md)
- mdBook handbook: [docs/book/README.md](docs/book/README.md)
- TypeScript test setup: [testing/devnet/README.md](testing/devnet/README.md)
- Verification evidence: [testing/devnet/RESULTS.md](testing/devnet/RESULTS.md)
- Missing work and decisions: [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)
- Rename and compatibility: [docs/book/src/migration.md](docs/book/src/migration.md)
- Public protocol research: [docs/research/solana-protocol-opportunities-2026-10-05.md](docs/research/solana-protocol-opportunities-2026-10-05.md)

The production program, workers, and allocation rubric are **Rust**. The web
server is Rust too; **TypeScript** handles browser interactions, documentation
assets, SDK generation, and the isolated testing package.

## Layout

```text
programs/quorum-allocation/    Production Anchor 1.0.2 program
frontend/                     Project landing page, TypeScript UI, Rust web server
workers/                      Production Rust worker workspace
  worker-core/                RPC, signing, codecs, PDAs and instructions
  producer/                   quorum-producer: generic on-chain metric producer
  consumer/                   quorum-consumer: APY/CRR allocation consumer MVP
  rubric/                     quorum-rubric: fixed-point scoring, screening and caps
testing/devnet/               Isolated TypeScript test package
  src/                        Mock HTTP backend, providers, price consumer, runner
  tests/unit/                 TypeScript codecs, HTTP, quote and deployment tests
  tests/integration.test.ts   TypeScript on-chain multi-provider assertions
  programs/mock-oracle/       Rust on-chain fixture (not a Rust test harness)
  evidence/                   Public-only verification snapshots
  .state/                     Ignored keys, ledgers, logs and generated reports
sdk/                          Generated Rust/TypeScript clients and devnet verification
docs/book/                    mdBook integration guides and read-only devnet UI
docker/                       Runnable web/worker images and worker Compose profiles
.github/workflows/            CI checks and version-tag image publication to GHCR
sims/                         Proposed simulation matrix
```

## Build and verify

From a GitHub checkout, run the frontend and bundled handbook using Docker:

```bash
docker compose up --build --detach --wait web  # http://127.0.0.1:3000
```

This builds the Rust server, TypeScript assets, and pinned mdBook inside Docker.
See [GitHub and Docker deployment](docs/book/src/deployment.md) for configuration,
GHCR publication, and Rust worker services with mounted operator key files.

To run the project frontend with its linked mdBook handbook, install Node
>=22.12 and pinned **mdBook 0.5.4** (see the
[handbook setup](docs/book/README.md)), then:

```bash
npm --prefix docs/book ci
npm --prefix frontend ci
npm --prefix frontend run serve  # Rust server at http://127.0.0.1:3000
```

The build produces `frontend/dist/`, including the book at `/book/`. To serve an
existing build, run `cargo run --locked -p quorum-web`. See
[worker integration](docs/book/src/workers.md) for the independent Rust daemons.

```bash
npm --prefix testing/devnet ci
npm --prefix testing/devnet test
npm --prefix testing/devnet run localnet
npm --prefix testing/devnet run devnet

# Standalone handbook (requires pinned mdBook 0.5.4):
npm --prefix docs/book ci
npm --prefix docs/book run serve

# Compilation checks for production Rust, separate from TypeScript testing:
cargo check --locked
cargo check --manifest-path workers/Cargo.toml --locked
npm --prefix frontend test
```

The test workflow requires Node >=22.12, npm and Solana CLI/platform tools.
Python, Anchor CLI and compiled Rust test clients are not needed. The runner
builds real SBF programs and executes all off-chain test logic in TypeScript.
Fresh keys synchronize the deployment IDs; generated keys and ledgers are ignored.
Existing ledgers are never reset and global Solana CLI configuration is unchanged.

Both generated SDKs compiled and passed [actual devnet verification](testing/devnet/evidence/sdk-devnet-2026-10-06.json)
on 2026-10-06: 22 checks and 20 confirmed transactions. See
[SDK setup and coverage](sdk/README.md) for reproduction and bootstrap limits.
Container builds and startup checks are configured in GitHub Actions. Native Rust
unit tests remain alongside production implementations; they are not invoked by
the TypeScript test runner.

The rename retains the configured program IDs and on-chain layouts. Rebuild
artifacts and regenerate clients using the Quorum names; historical verification
evidence retains its original names and refers to the earlier revision.

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

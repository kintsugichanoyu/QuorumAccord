# TypeScript verification results — 2026-10-03

## Outcome

**30 TypeScript unit/HTTP tests and all 16 local-validator integration scenarios
passed.** Node reports 17 passing integration tests because it also counts the
parent test. There were no failures, cancellations or skipped tests.

The TypeScript runner deployed the real production SBF program and the test-only
mock account program onto a fresh local Solana validator. Three separate
TypeScript provider processes fetched backend prices and submitted signed
transactions. A standalone TypeScript consumer read the resulting chain state.

**Public devnet transactions did not run.** The TypeScript runner reached devnet
and verified its genesis hash, but the faucet rejected the 2 SOL request and the
dedicated admin wallet remained at 0 SOL. The full suite needs approximately
8 devnet SOL. A local-validator pass is not a public devnet pass.

## What changed

All off-chain testing now lives in `testing/devnet/` and is TypeScript: HTTP
backend, three mock providers, read-only consumer, instruction/account codecs,
deployment/funding runner, allocation fixture model, unit tests and integration
assertions. The superseded Python backend/runner and Rust off-chain test clients
were removed; they remain recoverable from Git history. The production program,
production workers and small on-chain mock fixture remain Rust.

The runner verifies network identity, keeps test keys and buffer keys ignored,
requests test SOL, funds provider rent, deploys SBF and captures confirmed
transaction evidence. It never changes global CLI configuration, resets an
existing ledger or stops services it did not start. Prices and other u64 values
use `bigint` internally and decimal strings in JSON.

## Checks that passed

- Clean `npm ci`, strict TypeScript compilation and all 30 unit/HTTP tests.
- Dependency audit: zero reported vulnerabilities in the pinned dependency tree.
- Full integration: all 16 scenarios, approximately 9 minutes 25 seconds.
- Actual local airdrop of 10 SOL, followed by fresh deployment of both programs.
- 219 distinct confirmed suite transaction signatures, including provider
  submissions, fixture writes and operator rent top-ups. Deployment and airdrop
  signatures are recorded separately.
- Supplementary compilation checks for the production Rust program and workers.
  Anchor macro/config and older Solana SDK deprecation warnings remain.

The integration run used Node 24.16.0, TypeScript 5.9.3, Agave 4.3.0 and
60-slot price windows. It reused previously built SBPF v3 artifacts with
`--skip-build`; their hashes are included in the public evidence. No Rust worker
or Rust off-chain test executable was used by this integration run.

| Scenario | Confirmed result |
|---|---|
| Fresh registry/bootstrap | Outsider rejected before initialization; zero/65 quorum rejected |
| Baseline, three HTTP providers | SOL $198.25; BTC $64,000; ETH $3,200; all ticks 1 |
| Two providers, quorum 3 | All prices and ticks unchanged |
| Cygnus reports 10× prices | Median stays at baseline; all ticks 2 |
| All prices rise 10% | SOL $218.075; BTC $70,400; ETH $3,520; all ticks 3 |
| Cygnus backend returns 503 | It submits nothing; two votes cannot advance any feed |
| Read-only price consumer | Works with nonexistent signing files; no backend price calls |
| Older sample window 6, newer 7 | Newer publishes; all three older finalizations reject with 6018 |
| Mean allocation and ordering | `[5000, 5000, 0, …]`; round 487 publishes, round 486 rejects |
| Ten APY/CRR fixture feeds | Two matching submissions publish `[3007, 2707, 2707, 0, 1579, 0, …]` |
| Allocation fixture quorum miss | Two votes cannot satisfy quorum 3 |
| Minimum interval brake | Tick remains unchanged |
| No-trigger window | Price and tick remain unchanged |
| Forced refresh | Tick advances from 1 to 2 |
| Unauthorized opener | Exact error 6001; no consensus account created |
| Stale published price | Consumer rejects it; backend request counters remain unchanged |

Duplicate/unauthorized votes and early finalization were also checked against
exact program errors within the scenarios. Backend counters showed three asset
calls per participating provider, zero for an absent provider and one rejected
call for the unavailable provider. Consumer output matched confirmed feed values.

The allocation golden vector totals 10,000 bps and was published in round 732.
Its TypeScript allocation model and APY/CRR accounts are invented test fixtures,
not execution of the production financial rubric or real lending integrations.

## Evidence and rerun

Public-only snapshots:
[TypeScript localnet evidence](evidence/typescript-localnet-2026-10-03.json) and
[TypeScript devnet funding evidence](evidence/typescript-devnet-2026-10-03.json).
They include timestamps, public addresses, signatures, observed values, artifact
hashes and the devnet blockage. Private keys, ledgers and build outputs are not
committed.

Raw logs and reports remain in ignored `.state/localnet/` and `.state/devnet/`.
The verified run used `.state/localnet/ledger-typescript-2026-10-03`; earlier
ledgers were preserved. The earlier non-TypeScript verification is historical
only: [prior local evidence](evidence/localnet-2026-10-03.json) and
[prior devnet evidence](evidence/devnet-2026-10-03.json).

From the repository root:

```bash
npm --prefix testing/devnet ci
npm --prefix testing/devnet test
npm --prefix testing/devnet run localnet

# After funding the dedicated test wallet:
npm --prefix testing/devnet run devnet

# Reuse built artifacts only when they match the current program keys/source:
npm --prefix testing/devnet run devnet -- --skip-build
```

Devnet admin: `2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc`.
Full-suite funding target: 8 devnet SOL; `--prices-only`: 5 devnet SOL.
Use the [Solana faucet](https://faucet.solana.com/) if the RPC faucet refuses.
Configured program IDs do not imply deployment to devnet.

## What to investigate next

[OPEN_QUESTIONS.md](../../OPEN_QUESTIONS.md) tracks unresolved work: public devnet
funding/execution, coherent allocation input snapshots, missing risk inputs,
caps after aggregation, production lifecycle/recovery, real protocol decoders,
financial methodology, SDK generation and reproducible CI/container builds.

One centralized mock backend serves all three independent signing processes.
Median outlier handling does not establish source authenticity or resistance to
a malicious majority. This is functional verification, not a security audit or
evidence that production capital allocation is safe.

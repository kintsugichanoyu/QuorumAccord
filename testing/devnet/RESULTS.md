# Verification results — 2026-10-03

## Outcome

The production SBF program and test-only mock account program deployed on an
actual local Solana validator. The multi-process HTTP price suite passed. The
five-venue allocation golden-vector and full brake/trigger invariant runs passed.

**Public devnet did not run the transactions.** Its RPC was reachable and its
genesis hash verified, but the faucet rejected airdrop requests and the dedicated
admin wallet remained at 0 SOL. A local-validator pass is not a devnet pass.

## Implemented

- All mock protocol/backend/provider code moved under `testing/devnet/`; the
  production program, drivers and allocation workers remain outside that tree.
- Three separate provider processes and independent signing keys call the Atlas,
  Boreal and Cygnus mock HTTP protocol APIs for SOL/BTC/ETH prices.
- Prices are integer millionths of USD; providers reject wrong identities,
  units, zero values and stale/future quotes, then call the production sample
  instructions. The chain-only `consume`/`watch` CLI reads consensus prices.
- The runner builds SBF, checks network identity, generates ignored test keys,
  funds operators, deploys with explicit buffer keys, starts its own fixture
  services, gathers evidence and stops only the children it started.
- Correctness fixes: upgrade-authority-only registry bootstrap, quorum 1..64,
  monotonic sample/allocation publication, window-time brakes, excluded-zero
  preservation, exact CRR screening boundary and eligible cap redistribution.
- Runtime fixes: base64 large-account reads, resumed-buffer deployment capacity,
  SBPF v3 compatibility, rooted-validator readiness and provider rent top-ups.

## Checks that passed

Offline: **41 tests** — 14 program tests, 20 worker tests, four real-HTTP backend
tests and three deployment-runner regression tests. Native and SBF builds passed;
Python compilation, shell syntax, Rust formatting and Git whitespace checks passed.
Anchor macro/config and older Solana SDK deprecation warnings remain.

The fresh-ledger price suite used 60-slot windows, real signed transactions and
confirmed account reads. Its evidence reports 93 distinct confirmed transaction
signatures, excluding routine top-ups and the separate allocation harness.

| Scenario | Confirmed result |
|---|---|
| Baseline, three providers | SOL $198.25; BTC $64,000; ETH $3,200; all ticks 1 |
| Two providers, quorum 3 | All prices and ticks unchanged |
| Cygnus reports 10× prices | Median stays at baseline; all ticks 2 |
| All prices rise 10% | SOL $218.075; BTC $70,400; ETH $3,520; all ticks 3 |
| Cygnus backend returns 503 | It submits nothing; two votes cannot advance any feed |
| Older sample window 6, newer 7 | Newer publishes; all three older finalizations reject with 6018 |
| Mean allocation and rounding | `[5000, 5000, 0, …]`; all excluded venues remain zero |
| Older allocation 488, newer 489 | Newer publishes; older rejects with 6018 |
| Registry/bootstrap and vote checks | Exact outsider, zero/65 quorum, duplicate and early-finalization errors |

Backend counters showed three asset calls per participating provider, zero calls
for the absent provider and one rejected call for the unavailable provider.
Separate consumer processes decoded chain state and matched published values.
Registry bootstrap rejection was exercised before initialization on this ledger.
After those prices aged beyond the configured tolerance, a standalone consumer
call rejected them with `stale/future price for SOL`. Backend counters were
unchanged across that call, confirming it made no mock HTTP price requests.

The original account-fixture allocation harness verified ten APY/CRR feeds and
two identical consumer submissions, publishing the golden vector
`[3007, 2707, 2707, 0, 1579, 0, …]` with a 10,000-bps total (round 621).
These are invented fixtures, not integrations with actual lending protocols.
The invariant harness verified quorum misses, minimum-interval brakes, no-trigger
windows, forced refresh and unauthorized submissions (`INVARIANTS PASS`).

## Evidence and rerun

Raw logs, signatures and reports remain in ignored `.state/localnet/` and
`.state/devnet/`. The verified local run used the separate ledger
`.state/localnet/verified-ledger-v2`; earlier diagnostic ledgers were preserved.
No signing keys, ledgers or build outputs are committed. Public-only snapshots:
[localnet evidence](evidence/localnet-2026-10-03.json) (deployment signatures,
artifact hashes, operator addresses, prices and invariant results) and
[devnet evidence](evidence/devnet-2026-10-03.json) (funding blockage, no execution).

```bash
python3 testing/devnet/run.py --network localnet --legacy-allocation

# After funding the dedicated wallet, reuse the matching built SBF artifacts:
python3 testing/devnet/run.py --network devnet --skip-build
```

Devnet admin: `2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc`.
The price-only runner targets about 5 devnet SOL for deployment/rent/fees;
use the [Solana faucet](https://faucet.solana.com/) if the RPC faucet refuses.
Configured program IDs do not imply those programs have been deployed to devnet.

## What to investigate next

The complete list is in [OPEN_QUESTIONS.md](../../OPEN_QUESTIONS.md). Priorities:
unblock public devnet funding/execution; define a coherent allocation input
snapshot; fail closed on missing risk inputs; preserve caps after aggregation;
finish production round lifecycle/recovery; implement real protocol decoders;
validate the financial methodology; and add CI, SDK and container verification.

One centralized mock backend is shared by the three independent signing processes.
Median outlier handling does not prove source authenticity or resistance to a
malicious majority. This run is functional verification, not a security audit or
a claim that production capital allocation is safe.

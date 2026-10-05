# Quorum TypeScript verification results — 2026-10-03

These historical results describe the source revision tested on 2026-10-03,
before the Quorum rename. Original evidence paths and logs are preserved; see
[rename and compatibility](../../docs/book/src/migration.md).

## Outcome

**The full public-devnet suite passed: 16 scenarios, 17 Node tests including the
parent, zero failures, cancellations or skips.** The run lasted 18 minutes
57 seconds, from 19:32:40 to 19:51:37 UTC, and recorded **170 distinct confirmed
suite transaction signatures**. All **36 TypeScript unit/HTTP/pacing tests** also
passed after the final runner changes.

The real production SBF program and a separate on-chain mock fixture were
deployed to Solana devnet. Three independent TypeScript provider processes
fetched invented prices from the test backend and submitted signed transactions.
A standalone read-only TypeScript consumer verified published chain state.
**These are mock protocol inputs, not real lending-protocol integrations.**

The user funded the dedicated wallet with 10 devnet SOL. No further airdrop was
needed. The final run reused the verified deployments, starting with
4.706787360 SOL and ending with 3.411153880 SOL. The balance difference includes
rent/funding, not only transaction fees. Earlier attempts and their retained
accounts consumed additional test funds; their evidence is preserved.

## What works

| Scenario | Confirmed public-devnet result |
|---|---|
| Registry and quorum bounds | Existing registry reused; zero/65 quorum rejected |
| Three HTTP providers | SOL $198.25; BTC $64,000; ETH $3,200; all ticks 5 |
| Two providers, quorum 3 | Prices and ticks remain unchanged |
| Cygnus reports 10× prices | Median remains at baseline; all ticks 6 |
| All prices rise 10% | SOL $218.075; BTC $70,400; ETH $3,520; all ticks 7 |
| Cygnus backend returns 503 | No affected-provider submission; no feed advancement |
| Read-only price consumer | Works without signing files or backend price requests |
| Reverse sample finalization | Newer window 2112941 publishes; older 2112940 rejects with 6018 |
| Mean allocation and ordering | Round 507106164 publishes [5000, 5000, 0, …]; older round rejects |
| Ten APY/CRR fixture feeds | Two consumers agree on [3007, 2707, 2707, 0, 1579, 0, …] |
| Allocation fixture quorum miss | Two votes cannot satisfy quorum 3; state unchanged |
| Minimum interval brake | Tick remains 1 |
| No-trigger window | Price and tick remain unchanged |
| Forced refresh | Tick advances from 1 to 2 |
| Unauthorized opener | Exact error 6001; no consensus account created |
| Stale-price consumer | Rejects stale data; backend request counts unchanged |

The golden vector totals 10,000 bps and was published in round 507107515 at slot
507108122. Its allocation model and APY/CRR account values are **invented test
fixtures**, not the production financial rubric.

Duplicate/unauthorized votes and early finalization were also checked against
exact program errors. Backend counters showed three asset calls per participating
provider, zero for an absent provider and one rejected call for the unavailable
provider. Consumer values matched confirmed feed accounts.

The registry already existed after earlier deployment attempts. The console
test called “bootstrap authorization and quorum bounds” therefore **did not repeat
outsider rejection before fresh registry initialization** in this final run.
That branch passed on the historical fresh local-validator run.

## Deployment and transport

- Production program: `DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz`.
- Mock program: `3fqre3GKxrkcMvszvtc3vsemgjoKE7mDWz9UQtHtv78N`.
- Actual devnet genesis verified before execution.
- Both deployments confirmed using TPU, before the final full rerun.
- Fresh SBF v3 artifacts built earlier in this session were reused by the final
  `--skip-build --skip-deploy` run. Both program accounts were checked executable
  and owned by the upgradeable loader.
- A loopback TypeScript gateway serialized real public-RPC requests and preserved
  signed bytes. It made 3,024 upstream attempts for 3,007 requests, recovering from
  17 rate-limit retries. It never supplied fake chain results.
- Price windows: 240 slots; ten-feed golden fixture: 600; single-feed invariants:
  120. Twenty golden-fixture votes were batched into four transactions.
- The runner stopped its owned backend/gateway and restored the saved direct
  HTTPS RPC configuration. Private keys and ledgers remain ignored.

Initial bulk RPC deployment hit retry limits; shorter windows also closed before
paced submissions finished. TPU deployment, shared request pacing, wider fixture
windows and bounded vote batching resolved those observed failures. Earlier
[upload](evidence/typescript-devnet-rpc-upload-failed-2026-10-03.json),
[rate-limit](evidence/typescript-devnet-rate-limit-failed-2026-10-03.json),
[price-window](evidence/typescript-devnet-window-failed-2026-10-03.json) and
[fixture-window](evidence/typescript-devnet-fixture-window-failed-2026-10-03.json)
reports remain available; none is mislabeled as a passing full run.

Tooling: Node 24.16.0, TypeScript 5.9.3, Agave 4.3.0, host Rust 1.96,
Anchor 1.0.2 and platform-tools v1.57. Production programs/workers and the small
on-chain fixture remain Rust; all off-chain tests/providers/consumers are
TypeScript. There is no Python or Rust off-chain test executable.

## mdBook frontend

The [mdBook frontend](../../docs/book/README.md) provides searchable integration
documentation and a read-only devnet inspector, with responsive desktop/mobile
views, exact bigint price formatting, network/account validation and explicit
stale/error states. No wallet, signing, backend price access or automatic polling.

- Clean dependency installation, strict TypeScript compilation and static build.
- Nine TypeScript model/navigation tests passed.
- Five TypeScript desktop/mobile browser checks passed.
- One actual Chromium-to-public-devnet check passed without mocked RPC routes.
  At context slot 507106192 it displayed SOL $198.25, BTC $64,000 and ETH $3,200
  as fresh, using exactly three read-only RPC calls.
- [Public live-browser evidence](evidence/typescript-frontend-live-2026-10-03.json).
- A second actual browser check after the suite passed at context slot 507110467,
  correctly displaying all three prices as **STALE**; see
  [post-suite browser evidence](evidence/typescript-frontend-live-post-suite-2026-10-03.json).
- The completed protocol run deliberately leaves published prices stale; later
  frontend reads should label them stale rather than claim they are fresh.
- Marginfi, Kamino, Save, Jupiter and Loopscale pages describe integration
  contracts and missing work, explicitly marking their real adapters unimplemented.

The book bundles only committed public evidence. It is locally previewed, not
published to external hosting.

## Output and evidence

[Complete console output](evidence/typescript-devnet-full-2026-10-03.txt) and
[public machine-readable devnet report](evidence/typescript-devnet-full-2026-10-03.json)
include all scenario results, confirmed transaction signatures, deployment
signatures, timestamps, prices, weights and artifact SHA-256 hashes.

The final console totals are:

```text
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1137040.222607
```

The earlier [TypeScript localnet pass](evidence/typescript-localnet-2026-10-03.json)
had 30 unit/HTTP tests and all 16 scenarios, with 219 confirmed suite signatures
on a fresh registry. Its ledger remains at
`testing/devnet/.state/localnet/ledger-typescript-2026-10-03`.
The [initial unfunded devnet report](evidence/typescript-devnet-2026-10-03.json)
is historical and does not describe the now-funded, verified deployment.
Raw current logs/reports remain in ignored `.state/devnet/`.

## Rerun

From the repository root:

```bash
npm --prefix testing/devnet ci
npm --prefix testing/devnet test
npm --prefix testing/devnet run devnet

# Reuse matching built artifacts and executable deployments; still the full suite.
npm --prefix testing/devnet run devnet -- --skip-build --skip-deploy

npm --prefix docs/book ci
npm --prefix docs/book test
npm --prefix docs/book run test:browser
npm --prefix docs/book run serve
```

Devnet deployments now default to TPU; localnet uses RPC. Fresh full deployments
target 8 devnet SOL, price-only deployments 5. Reusing deployments targets 4/2
respectively; the final wallet balance is below the full rerun funding target.
The [lab README](README.md) describes funding, tools and optional fresh builds.

## What remains

[OPEN_QUESTIONS.md](../../OPEN_QUESTIONS.md) tracks coherent allocation snapshots,
risk-input completeness, caps after aggregation, daemon lifecycle/recovery,
real protocol decoders, financial methodology, generated SDKs and reproducible CI.

One centralized fixture backend serves all three signing processes. Median
outlier handling does not establish source authenticity, independent sources or
resistance to a malicious majority. This is functional verification, **not a
security audit or evidence that production capital allocation is safe**.

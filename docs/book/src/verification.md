# Verification and troubleshooting

The [devnet inspector](devnet.md) links the latest **committed public** machine
report. A recorded snapshot is distinct from a live RPC read. Failed attempts
remain in `testing/devnet/evidence/` alongside successful reports.

## Recorded public-devnet pass — 2026-10-03

All **16 fully featured scenarios passed**, with 170 distinct confirmed suite
transactions, zero failures or skips, in approximately 19 minutes. Node counts
17 tests including the parent. All 36 TypeScript unit/HTTP/pacing tests also passed.
Both the production program and test fixture are actually deployed to devnet;
the final run reused these deployments and their already-initialized registry.
Fresh registry bootstrap-authority rejection was not repeated in this final run.

The three HTTP providers published baseline prices, rejected a 10× outlier,
advanced a 10% update, preserved state without quorum and produced the allocation
golden vector `[3007, 2707, 2707, 0, 1579, 0, …]`. Lifecycle, ordering and consumer
freshness checks passed. See the [recorded full report](evidence/latest-devnet.json).
The final stale-consumer scenario intentionally leaves prices stale for later reads.

The mdBook frontend passed nine TypeScript model/navigation tests, five browser
checks and actual read-only public-devnet browser checks, both during the suite
(fresh prices) and afterward (correctly labeled stale prices). Real named protocol
adapters are still unimplemented; a green mock run does not validate their inputs.

## Fully featured TypeScript scenarios

- Registry/bootstrap and quorum bounds (fresh bootstrap only on a fresh registry).
- Baseline consensus, missing quorum, 10× outlier and 10% price update.
- Backend 503: no affected-provider vote; no quorum advancement.
- Read-only consumer with nonexistent signing files and no backend requests.
- Reverse sample and allocation finalization; excluded-zero-preserving rounding.
- Ten mock APY/CRR feeds and two matching allocation submissions.
- Quorum miss, minimum-interval brake, no-trigger window and forced refresh.
- Unauthorized opener rejection and stale-price consumer rejection.

The program must return the **exact expected custom errors**, not merely any
error. A transport outage does not count as a successful authorization test.

## Public RPC pitfalls

The public RPC can rate-limit request count, connections or method-specific
traffic. The TypeScript runner uses one shared, paced HTTP gateway and bounded
HTTP 429/503 retrying; it does not fake results. A devnet run uses wider windows
than the small local-validator test to accommodate transport latency.

Devnet defaults to TPU for bulk deployment (`--deploy-transport tpu` explicitly).
Explicit persisted buffer keys
let uploads resume without recovery phrases being printed. Inspect the recorded
error before retrying; do not reset the wallet, close consensus accounts or treat
partial execution as a full pass.

[Solana's public endpoint guidance](https://solana.com/docs/references/clusters)
documents rate limits and cautions that they can change.

## No guarantees from a green mock run

Functional tests do not establish financial safety, source authenticity,
independent source operators, resistance to a malicious majority or a security
audit. The named lending protocols are not exercised by the mock backend.

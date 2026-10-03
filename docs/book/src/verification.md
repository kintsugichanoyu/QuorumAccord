# Verification and troubleshooting

The [devnet inspector](devnet.md) links the latest **committed public** machine
report. A recorded snapshot is distinct from a live RPC read. Failed attempts
remain in `testing/devnet/evidence/` alongside successful reports.

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

Use `--deploy-transport tpu` for bulk deployment. Explicit persisted buffer keys
let uploads resume without recovery phrases being printed. Inspect the recorded
error before retrying; do not reset the wallet, close consensus accounts or treat
partial execution as a full pass.

[Solana's public endpoint guidance](https://solana.com/docs/references/clusters)
documents rate limits and cautions that they can change.

## No guarantees from a green mock run

Functional tests do not establish financial safety, source authenticity,
independent source operators, resistance to a malicious majority or a security
audit. The named lending protocols are not exercised by the mock backend.

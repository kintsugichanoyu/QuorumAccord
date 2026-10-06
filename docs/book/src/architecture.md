# Architecture and trust

This page describes the current implementation. The [protocol roadmap](roadmap.md)
plans on-chain source validation and metric calculation, with Rust keepers
triggering transactions and a later move to deterministic on-chain allocation.
The new paths are not implemented yet.

```text
Production path
protocol account → Rust producer driver → DataFeedConsensus → DataFeed ring
                                                               ↓
                                 allocation consumers → AllocationConsensus
                                                               ↓
                                                      AllocationState

Test path (isolated in testing/devnet/)
invented HTTP quotes → 3 TypeScript provider processes → same production program
                                                            ↓
                                                TypeScript price consumer
```

The small Rust mock-oracle program supplies invented on-chain APY/CRR accounts.
It is a fixture, not a protocol integration. The HTTP price backend is also a
fixture; production drivers are intended to read venue accounts, not this API.

## Four boundaries

1. **Source provenance.** A valid signature does not make a price true. Validate
   protocol owner, schema/discriminator, units and observation context.
2. **Operator agreement.** Registry membership, quorum and aggregation establish
   agreement. A malicious majority can agree on invented data.
3. **Window chronology.** Finalization must not overwrite newer samples or rounds.
   Windows use Solana slots, not the browser clock.
4. **Allocation safety.** A 10,000-bps vector is not proof of coherent inputs,
   correct risk assumptions, preserved caps or safe capital placement.

`minContextSlot` is a freshness lower bound, **not** an exact historical snapshot.
No frontend should present it as agreement on a shared point-in-time portfolio.

## Code map

| Responsibility | Repository path |
|---|---|
| Authoritative instructions/accounts | `programs/quorum-allocation/src/lib.rs` |
| Production driver interface | `workers/producer/src/driver.rs` |
| Generic producer decoder | `workers/producer/src/drivers.rs` |
| Production financial rubric | `workers/rubric/` |
| TypeScript runtime assertions | `testing/devnet/src/suite.ts` |
| Public verification reports | `testing/devnet/evidence/` |
| Documentation frontend | `docs/book/` |
| Project landing page and Rust web server | `frontend/` |

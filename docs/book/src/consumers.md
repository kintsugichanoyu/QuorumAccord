# Allocation consumers

Two different consumers exist:

| Consumer | Reads | Computes / writes |
|---|---|---|
| TypeScript price CLI / this browser | Confirmed price feeds | Read-only display; no signing files |
| Production Rust allocation worker | Mapped APY/CRR feeds | Integer rubric and weight submission |
| TypeScript allocation fixture | Ten invented on-chain APY/CRR feeds | Test-only golden-vector submissions |

The fixture vector is `[3007, 2707, 2707, 0, 1579, 0, …]`. It screens the fourth
invented venue and totals 10,000 bps. This does not test the full production
financial methodology, real protocol risk or cap preservation after aggregation.

## Production flow

```text
validated, coherent APY/CRR snapshot
    → yield × risk discount → screen → normalize → cap
    → independent consumers submit vectors
    → allocation quorum / aggregation
    → newer AllocationState publication
```

The first line is a required design target, **not an implemented guarantee**.
Current `minContextSlot` reads do not select identical historical values. The
worker also needs fail-closed missing-risk handling, round discovery/finalization,
duplicate prevention and error propagation.

## Mapping

The production worker's `FEEDS` JSON maps a `(pool_id, data_id)` to a venue index
and role. IDs alone do not identify a real lending protocol:

```json
[
  {"pool_id": 1, "data_id": 0, "venue": 0, "role": "apy"},
  {"pool_id": 1, "data_id": 2, "venue": 0, "role": "crr", "cap_bps": 4000}
]
```

This is an **illustrative mapping**, not authorization to run a particular venue
adapter. Establish validated coverage, units, staleness and methodology before
submitting production weights. The system publishes weights; it does not execute
portfolio rebalances or move funds.

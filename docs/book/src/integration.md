# Integrate a protocol

First follow [Integrate Quorum workers](workers.md) to build the Rust binaries,
register operators, initialize feeds, and configure producer/consumer processes.

Real protocol adapters are **not implemented**. The shipped Rust producer accepts
only `DRIVER=offset_u64`. The named protocol pages are integration plans/checklists,
not claims that these protocols have been connected.

## Integration contract

Every producer is assigned one `(pool_id, data_id)` feed. The current trait is:

```rust,ignore
pub trait Driver: Send + Sync {
    fn pool_id(&self) -> u8;
    fn data_id(&self) -> u8;
    fn target_account(&self) -> Pubkey;
    fn decode(&self, account_data: &[u8]) -> anyhow::Result<u64>;
}
```

The trait passes bytes only. Add owner and schema validation in the read boundary
or extend the driver contract **before** calling a protocol adapter production-ready.
The generic offset decoder does not establish provenance; its denominator fallback
and narrowing conversion also need hardening for untrusted layouts/scales.

## Required work per adapter

1. Pin the protocol's official account schema/crate and exact deployed program ID.
   Record cluster and account derivation; never guess offsets from another protocol.
2. Define the metric and units: APY basis points, CRR basis points or another
   documented measurand. Price micro-USD fixtures are **not** APY values.
3. Validate owner, discriminator/version, account length, mint/market identity,
   required related accounts and integer overflow before decoding.
4. Return a deterministic integer value. Reject unsupported schema versions and
   missing risk data; do not silently substitute zero risk.
5. Register the selector in `workers/producer/src/main.rs::build_driver`; register
   the feed and operator through authorized admin instructions.
6. Write **TypeScript** fixture tests for valid/truncated/wrong-owner/wrong-version
   data, scaling boundaries, zero/overflow and stale inputs. Preserve provenance
   for any captured public account fixture.
7. Execute multiple independent providers against the real account on devnet
   where available. If the protocol is absent on devnet, disclose a cloned/local
   fixture rather than claiming a live protocol integration.
8. Define the consumer feed-to-venue mapping and risk methodology separately.
   Do not make the frontend responsible for inventing financial rules.

## Test-only HTTP adapter

The existing TypeScript example deliberately demonstrates a different source:

```typescript
// In testing/devnet/src/provider.ts, using the configured test client:
const response = await fetch(`${client.config.backend_url}/v1/protocols/${protocol}/prices/${asset.symbol}`);
if (!response.ok) throw new Error(`backend HTTP ${response.status}`);
const quote = await response.json();
const price = validateQuote(quote, protocol, asset.symbol); // bigint micro-USD
// Derive the chain window; propose or corroborate, then finalize after close.
```

Use the complete runnable lab rather than pasting this excerpt as a production
driver. Its Atlas/Boreal/Cygnus names and prices are fictional. Independent signing
processes using one backend are not independent sources of truth.

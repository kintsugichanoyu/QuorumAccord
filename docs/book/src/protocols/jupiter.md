# Jupiter Lend

<div class="reflect-warning">Status: real protocol adapter not implemented. This page is an integration checklist, not a live connection or a verified financial model.</div>

## Intended measurement

A selected lending metric and required collateral inputs. The specification requires a collateral-composition-derived risk factor. The methodology and full CRR derivation are missing. Do not publish an invented zero-risk CRR or infer collateral composition from a price feed.

No target account address, field offset, conversion formula or risk score is
invented here. Obtain the authoritative schema and document the selected version
before implementing the driver.

## Adapter work

- Implement the [Driver contract](../integration.md) for one metric and register
  its selector in `workers/producer/src/main.rs::build_driver`.
- Validate owner, schema/discriminator, market and mint identity before decoding.
- Reject truncated data, unsupported versions, missing related accounts, invalid
  denominator/scaling and u64 overflow.
- Register the feed/operator with the proper admin authority; choose documented
  window, quorum, divergence threshold and timing brakes.
- Add TypeScript fixture and actual-validator tests. Record whether the protocol
  itself exists on devnet; cloned or invented accounts are not live integration.
- Establish the [allocation consumer mapping](../consumers.md), risk methodology,
  staleness policy and coherent snapshot agreement before production submission.

## What the current lab proves

The lab tests the shared consensus instruction path with fictional HTTP price
providers and separate APY/CRR account fixtures. It does **not** test Jupiter Lend's
real account layout, financial behavior or source authenticity.

See [release blockers](../blockers.md) for decisions that must precede safe
production allocation.

# Quorum integration handbook

<div class="quorum-hero">
<p class="eyebrow">Solana · Consensus data · Allocation</p>
<h2>One feed.<br>Many operators.</h2>
<p>Integrate a measured protocol value, agree on its on-chain history, and consume an allocation vector. Build Rust workers and verify the flow with the TypeScript lab.</p>
<a class="quorum-cta" href="workers.html">Integrate Quorum workers →</a>
</div>

<div class="quorum-grid">
<section class="quorum-card"><h3>01 · Measure</h3><p>One driver reads one metric. Identity, units, account provenance and freshness matter.</p><a href="integration.html">Build a protocol adapter →</a></section>
<section class="quorum-card"><h3>02 · Agree</h3><p>Registered signers submit inside slot windows. The program publishes one quorum-approved value.</p><a href="contract.html">Understand the contract →</a></section>
<section class="quorum-card"><h3>03 · Consume</h3><p>Read confirmed feeds and weight vectors without exposing signing keys in a browser.</p><a href="devnet.html">Inspect public devnet →</a></section>
</div>

This **mdBook integration handbook** accompanies the Quorum project frontend.
It contains Rust worker setup, adapter contracts, and a read-only TypeScript
devnet inspector. A searchable sidebar, themes, and copyable examples are supplied
by mdBook. Start with [worker integration](workers.md), then
[source adapters](integration.md) and the [TypeScript lab](quickstart.md).

The [protocol roadmap](roadmap.md) describes the planned shift to on-chain
account reads and calculations, with off-chain keepers responsible for triggers.
Current integration instructions and devnet evidence still describe the
operator-submission model.

## Integration status

| Component | What exists | What does not |
|---|---|---|
| Consensus program | Registry, feeds, sample and allocation consensus | Jito NCN/restaking |
| TypeScript lab | Three HTTP mock providers, consumer, actual SBF tests | Independent real market sources |
| Production producer | Generic `offset_u64` decoder | Named-protocol schema/owner validation |
| Allocation worker | Integer rubric and submission scaffold | Coherent snapshots and lifecycle recovery |
| Generated SDKs | Rust/TypeScript clients compiled and verified on devnet | Published packages and future source-refresh interface |
| This frontend | Integration guides and read-only chain inspection | Wallet signing or movement of capital |

See the [architecture](architecture.md), [protocol integration checklist](integration.md)
and [release blockers](blockers.md) before using any production inputs.

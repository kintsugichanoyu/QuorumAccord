# Reflect integration handbook

<div class="reflect-hero">
<p class="eyebrow">Solana · Consensus data · Allocation</p>
<h2>One feed.<br>Many operators.</h2>
<p>Integrate a measured protocol value, agree on its on-chain history, and consume an allocation vector. Start with the TypeScript lab; keep test fixtures separate from production sources.</p>
<a class="reflect-cta" href="quickstart.html">Run the integration lab →</a>
</div>

<div class="reflect-grid">
<section class="reflect-card"><h3>01 · Measure</h3><p>One driver reads one metric. Identity, units, account provenance and freshness matter.</p><a href="integration.html">Build a protocol adapter →</a></section>
<section class="reflect-card"><h3>02 · Agree</h3><p>Registered signers submit inside slot windows. The program publishes one quorum-approved value.</p><a href="contract.html">Understand the contract →</a></section>
<section class="reflect-card"><h3>03 · Consume</h3><p>Read confirmed feeds and weight vectors without exposing signing keys in a browser.</p><a href="devnet.html">Inspect public devnet →</a></section>
</div>

This is an **mdBook documentation frontend**, with a read-only TypeScript devnet
inspector. It does not rebalance capital, sign transactions or provide investment
advice. A searchable sidebar, themes and copyable examples are supplied by mdBook.

The original MVP deferred dashboards. This handbook adds a developer-facing
frontend without claiming production monitoring or protocol adapters are complete.

## Integration status

| Component | What exists | What does not |
|---|---|---|
| Consensus program | Registry, feeds, sample and allocation consensus | Jito NCN/restaking |
| TypeScript lab | Three HTTP mock providers, consumer, actual SBF tests | Independent real market sources |
| Production producer | Generic `offset_u64` decoder | Named-protocol schema/owner validation |
| Allocation worker | Integer rubric and submission scaffold | Coherent snapshots and lifecycle recovery |
| This frontend | Integration guides and read-only chain inspection | Wallet signing or movement of capital |

See the [architecture](architecture.md), [protocol integration checklist](integration.md)
and [release blockers](blockers.md) before using any production inputs.

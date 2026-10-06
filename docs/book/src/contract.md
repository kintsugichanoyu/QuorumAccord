# Instruction and account contract

The production program is the authority for membership, windows, quorum and
publication. The TypeScript lab supplies tested hand-written codecs. The
[generated Rust and TypeScript SDKs](sdk.md) compile and have been verified
against actual program execution on devnet.

| Operation | Authority / condition |
|---|---|
| `init_registry` | Deployed program upgrade authority; fresh registry |
| `add_operator` | Registry admin |
| `init_data_feed`, `update_thresholds` | Registry admin |
| `propose_sample`, `corroborate_sample` | Registered operator, valid slot window, no duplicate vote |
| `finalize_sample` | Closed window; publication requires quorum and trigger/brake conditions |
| `open_allocation_round` | Registry admin; quorum 1..64 |
| `submit_weights` | Registered operator; 16 u16 weights totaling 10,000 bps |
| `finalize_allocation` | Closed round, sufficient votes, newer publication |

## PDA seeds

| Account | Seeds |
|---|---|
| Registry | `registry` |
| Feed | `data_feed`, one-byte pool ID, one-byte data ID |
| Sample consensus | `tick_consensus`, feed public key, little-endian u64 window |
| Allocation consensus | `consensus`, little-endian u64 round |
| Allocation state | `allocation_state` |

The account discriminator is the first eight SHA-256 bytes of `account:<Type>`;
instruction discriminators use `global:<snake_case_name>`. Zero-copy account reads
must honor the actual layout, not assume ordinary Borsh serialization.

## Serialization rules

- u64 values: `bigint` in TypeScript, canonical decimal strings in JSON.
- APY/CRR/weights: explicitly documented basis points; 10,000 bps is 100%.
- Mock price values: six-decimal integer USD, never floating-point dollars on wire.
- Validate account owner, discriminator, full length and count/ring bounds.

The generated SDK run covers parity for all 12 instructions, execution of 10
instruction types, and decoding all five live account types in both languages.
Fresh singleton initialization was not repeated. See [SDK coverage](sdk.md) and
the remaining [release blockers](blockers.md).

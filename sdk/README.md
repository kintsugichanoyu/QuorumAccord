# Quorum provider SDK

Generated TypeScript + Rust clients for the `quorum-allocation` program, so a
third party can register as an operator and submit samples / weight vectors.

## Generate

```bash
anchor build                       # produces target/idl/quorum_allocation.json
cd sdk && npm install && npm run generate
```

This runs [Codama](https://github.com/codama-idl/codama) over the Anchor IDL and
emits:

- `ts/generated/` — TypeScript client (instruction builders, account decoders, PDA helpers)
- `rust/generated/` — Rust client

## What a provider does

1. Get added to the `OperatorRegistry` by the admin (`add_operator`).
2. Use the generated client to build and send:
   - producers → `propose_sample` / `corroborate_sample` (and crank `finalize_sample`)
   - consumers → `submit_weights` (and crank `finalize_allocation`)

The off-chain Rust daemons in `workers/` already implement these flows by hand in
`quorum_worker_core::ix`; the generated clients are for external integrators who prefer a
typed SDK over hand-rolled instructions.

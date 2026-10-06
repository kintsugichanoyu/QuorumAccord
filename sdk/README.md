# Quorum Rust and TypeScript SDKs

Both clients are generated from the compiled Anchor program IDL and verified
against the existing Quorum program on **Solana devnet**. The 2026-10-06 run
passed **22 checks and 20 confirmed transactions**: nine signed program
transactions from each language and two test-wallet funding transactions.
The clients are available from this repository; npm and crates.io packages have
not been published.

## Generate and compile

Use Node **24.16.0**, Rust **1.96.0**, and the committed npm/Cargo lockfiles.
On Debian/Ubuntu, native verification builds also need `pkg-config`,
`libssl-dev`, `libudev-dev`, and `protobuf-compiler`.

From the repository root:

```bash
rustup toolchain install 1.96.0 --profile minimal
npm --prefix sdk ci
npm --prefix sdk run idl
npm --prefix sdk run build
npm --prefix sdk run check:rust
npm --prefix sdk run verify:offline
```

`idl` uses Anchor's Rust IDL builder to compile `programs/quorum-allocation`
without requiring the Anchor CLI or deploying a program. It updates the public
snapshot `sdk/idl/quorum_allocation.json`. Account resolution is disabled because
the program's current seed expressions do not compile with Anchor's automatic
IDL resolver; callers supply addresses explicitly. This preserves the wire
contract. TypeScript PDA helpers cover all five PDA types.

Pinned Codama renderers generate `sdk/ts/generated/` and
`sdk/rust/src/generated/`. These generated directories and compiled output are
ignored; the IDL, generator, manifests, lockfiles, and verification source are
committed. Generation must precede compilation of the Rust crate.

Use TypeScript exports from `sdk/dist/ts/index.js`. Add the Rust crate as a path
dependency, for example from an adjacent repository:

```toml
[dependencies]
quorum-client = { path = "../quorum/sdk/rust", features = ["fetch"] }
```

Rust exports `instructions`, `accounts`, `types`, and `QUORUM_ALLOCATION_ID`.
The optional `fetch` feature provides generated RPC account fetchers and is
compiled in CI. Choose a signing/RPC transport appropriate to your application;
the SDK builds instruction bytes and account metadata. Integrators must validate
account ownership, discriminator, identity, bounds, and freshness when reading
untrusted addresses.

## Provider integration

The registry admin must register a producer with `add_operator`. SDK access
does not grant permission to submit. Producers build `propose_sample` and
`corroborate_sample`; allocation consumers build `submit_weights`. Finalizers
call `finalize_sample` or `finalize_allocation` after the window closes.

For example, after building the TypeScript SDK, construct a sample instruction
from the repository root (with `@solana/kit` installed in your application):

```typescript
import { type TransactionSigner } from '@solana/kit';
import {
  getRegistryAddress, getDataFeedAddress, getSampleConsensusAddress,
  getProposeSampleInstruction,
} from './sdk/dist/ts/index.js';

async function buildSample(operator: TransactionSigner, slot: bigint) {
  const pool = 0, metric = 0;
  const window = slot / 256n; // Use this feed's configured window_slots.
  return getProposeSampleInstruction({
    registry: await getRegistryAddress(),
    dataFeed: await getDataFeedAddress(pool, metric),
    consensus: await getSampleConsensusAddress(pool, metric, window),
    operator, windowIndex: window, value: 42n, slotAtRead: slot,
  });
}
```

Use `bigint` for TypeScript u64 values and decimal strings in JSON. The devnet
test publishes `9007199254740993` and `9007199254740995` without precision loss.
The generated Rust builders are exercised by `sdk/verify-rust/src/main.rs`,
including signing, RPC submission, confirmation, and live account decoding.
Production daemons currently retain their existing worker-core builders.

## Repeat the devnet verification

Use the deployed program `DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz`,
an already initialized registry/allocation state, the registry admin's test key,
at least **0.6 devnet SOL**, and two available operator slots. Keep key files
outside tracked source. No deployment or mainnet path is part of this command.

```bash
npm --prefix testing/devnet ci
# Defaults to the existing test admin in testing/devnet/.state/keys/admin.json.
# Set SDK_ADMIN_KEYPAIR to another devnet registry-admin key file if needed.
npm --prefix sdk run verify:devnet
```

The runner checks devnet's genesis hash, creates two temporary signers and fresh
fixture feeds, publishes samples with both SDKs, and finalizes an allocation
round using the existing weight vector. It removes its temporary registrations
and checks that original membership is restored. Feed/consensus accounts retain
rent, test signers retain unused funding, and the allocation round/timestamp
advance. Keys and raw snapshots stay under ignored `testing/devnet/.state/`.
Public reports under `testing/devnet/evidence/sdk-devnet-*.json` contain account
IDs, signatures, values, checks, and the IDL hash.

The recorded run verifies all 12 instructions' byte/account-privilege parity,
executes 10 instruction types, decodes all five live account types in both
languages, and checks rejection of unregistered signers, duplicate votes, and
early finalization. Fresh `init_registry` and `init_allocation_state` execution
was not repeated because those singleton accounts already existed; their
encodings are included in parity checks. This verifies the current
operator-submission MVP with invented fixtures. SDKs for the planned on-chain
Kamino refresh interface will require new IDL and runtime verification.

GitHub CI rebuilds the IDL, generates and compiles both SDKs, and runs the 12
offline parity checks. Signed devnet runs are explicit local operations and
require the test admin key; CI has no signing keys.

# Rename and compatibility

The project is now **Quorum**. Existing source integrations should update these
names together:

| Previous name | Quorum name |
|---|---|
| `programs/reflect-allocation/` | `programs/quorum-allocation/` |
| Cargo package `reflect-allocation` | `quorum-allocation` |
| Rust/Anchor module `reflect_allocation` | `quorum_allocation` |
| Rust error enum `ReflectError` | `QuorumError` |
| Anchor type `ReflectAllocation` | `QuorumAllocation` |
| SBF artifact `reflect_allocation.so` | `quorum_allocation.so` |
| IDL `reflect_allocation.json` | `quorum_allocation.json` |
| Worker binaries `producer`, `consumer` | `quorum-producer`, `quorum-consumer` |
| Worker crates `worker-core`, `rubric` | `quorum-worker-core`, `quorum-rubric` |
| npm scope `@reflect/` | `@quorum/` |

Rebuild SBF binaries and regenerate the SDK before deployment. Do not use an old
binary with the newly named artifact paths. Docker entrypoints and the TypeScript
deployment runner now use the Quorum names. `--skip-build` assumes you have
already built matching **Quorum** artifacts.

This source rename retains the configured public program IDs, PDA seeds,
instruction names, account names/layouts/discriminators, and error numbering.
It does not migrate on-chain accounts or deploy a program. Anchor metadata and
generated Rust type names change; regenerate clients from the renamed IDL.

Historical files in `testing/devnet/evidence/` preserve their original build
paths, hashes, and logs. They record the earlier source revision and do not
verify this renamed revision. The build scripts still recognize tool binaries
installed under the previous `reflect-toolchains` local directory so existing
development environments continue to work. New task-owned tool installations
can use `quorum-toolchains`; an explicit `MDBOOK_BIN` takes precedence.

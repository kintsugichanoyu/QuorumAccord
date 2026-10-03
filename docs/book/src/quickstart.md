# Run the TypeScript lab

Run from the repository root. Requirements: Node >=22.12, npm, Solana CLI,
`cargo-build-sbf` and Rust for the **on-chain programs**. All off-chain tests are
TypeScript; no Python or Rust off-chain test executable is needed.

```bash
npm --prefix testing/devnet ci
npm --prefix testing/devnet test
npm --prefix testing/devnet run localnet

# Public devnet: real signed transactions, invented test values.
npm --prefix testing/devnet run devnet -- --deploy-transport tpu
```

The full fresh deployment targets 8 **devnet** SOL. Price-only testing targets 5.
The runner generates ignored test keys, synchronizes public program IDs, verifies
the devnet genesis hash and funds provider rent. It does not change global CLI
configuration or reset existing ledgers.

## Reuse deployments

```bash
# Existing matching SBF artifacts and deployed programs; still the full suite.
npm --prefix testing/devnet run devnet -- --skip-build --skip-deploy

# Price-only subset (not the fully featured verification).
npm --prefix testing/devnet run devnet -- --prices-only --deploy-transport tpu
```

`--skip-deploy` requires executable upgradeable programs and targets 4 devnet SOL
for the full tests, or 2 for prices only. It does not disable allocation scenarios.
The suite can reuse initialized test feeds; it updates their window width when
needed. Fresh registry-authority rejection is only exercised on a fresh registry.

Devnet defaults to 240-slot price windows and paced shared HTTP RPC calls. The
ten-feed golden fixture uses 600-slot windows and batched votes; single-feed
invariants use 120-slot windows. These are test-network timing choices,
not recommendations for production APY cadence. HTTP 429/503 retrying is bounded;
persistent failures remain failures. TPU deployment avoids bulk RPC upload traffic.

## Read published prices

After a run the runner restores the direct RPC URL in its configuration:

```bash
export LAB_CONFIG="$PWD/testing/devnet/.state/devnet/config.json"
npm --prefix testing/devnet run consume
```

The final stale-price test deliberately leaves prices old. A later `consume` may
therefore correctly reject them. Do not bypass freshness checks to obtain output.

The public wallet address may be shared for devnet funding. Never commit or put
the private `.state/keys/*.json` files into the book, a browser bundle or screenshots.

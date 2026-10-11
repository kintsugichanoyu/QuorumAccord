# Quorum USDC product demonstration

The live product is at **http://localhost:18880**. The pitch is at
**http://localhost:18880/pitch.html**, with PDF and editable PowerPoint downloads.
The **Fleet** tab shows actual Docker state, health checks, worker heartbeat age,
and latest observed slots. Its check time is explicit. A hosted static copy shows
its captured check time; only the local page has a continuously updated host monitor.

```bash
./scripts/devnet/show-fleet.sh
# Or, a single status check:
sudo -n docker compose -f deployment/devnet/compose.yaml ps
# Follow signed activity:
sudo -n docker compose -f deployment/devnet/compose.yaml logs --follow
```

## Reproduce deployment

From the repository root:

```bash
cp deployment/devnet/.env.example deployment/devnet/.env
./scripts/devnet/deploy-system.sh
```

Prerequisites are Node 24+, npm, Cargo, Solana CLI/cargo-build-sbf, Docker Compose,
mainnet/devnet RPC access, and an existing funded devnet wallet holding program
upgrade authority. The existing workspace wallet is
`testing/devnet/.state/keys/admin.json`. The program key must match `declare_id!`.
The script never changes global Solana CLI configuration. Generated keys, worker
`.env` files, control files, and journals live in ignored `.state/`; evidence contains
public keys and account data only. Each producer and consumer receives its own
signing key, funded from the existing wallet. The coordinator receives the admin key.
The read-only web service receives neither signing keys nor a Docker socket.

The script builds and deploys/verifies the compiled program, registers producers and
consumers, initializes three feeds and the allocation policy, generates worker
configuration, and starts **15 containers** with restart policies:

| Role | Containers | Responsibility |
|---|---:|---|
| Producers | 9 | One protocol feed per process; three independently signed observations per feed |
| Consumers | 3 | Compute weights from the same frozen on-chain snapshot and submit independent votes |
| Coordinator | 1 | Open/finalize rounds, archive outcomes and reclaim old consensus rent |
| RPC gateway | 1 | Pace genuine RPC request starts, coalesce short identical reads, and retry throttling |
| Demo web | 1 | Serve the live read-only dashboard, simulation, evidence and pitch |

The host monitor polls Docker every 15 seconds and writes only public service status.
Docker health means recent loop completion; **functional success is verified
separately** through feed quorums and allocation publications.

## Inputs and policy

Sources are real read-only **mainnet** USDC supply rates. Operators publish reports
and consensus on **devnet**; the protocols themselves are not simulated or deployed
on devnet. Each process fetches only its assigned protocol and checks network, account
owner, USDC mint and parent market/group before SDK decoding.

| Venue | Mainnet USDC account | Pinned SDK | Feed cadence |
|---|---|---|---:|
| Marginfi | `2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB` | `@0dotxyz/p0-ts-sdk@2.10.0` | 120 slots |
| Save | `BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw` | `@solendprotocol/solend-sdk@0.14.27` | 180 slots |
| Kamino | `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59` | `@kamino-finance/klend-sdk@13.0.2` | 240 slots |

APY is base supply interest, excluding token incentives, rounded to basis points.
Kamino uses the pinned SDK's nominal 500ms legacy slot convention. Mainnet source
slots are journal evidence; instruction-window validation uses devnet slots.

Feeds use three-operator median consensus and independent clocks. Allocation v2
atomically captures all configured feed heads into `RoundContext`. It freezes values,
ticks, sample slots, eligibility, authorized consumers, and the full policy. Three
consumers submit weights with the exact SHA-256 input commitment. The browser
recomputes this commitment from serialized account bytes.

The illustrative policy uses 5% / 10% / 15% risk discounts, a 60% screening threshold,
50% venue caps, and a shared 75% Save/Kamino demo category budget. Staleness limits
are two feed windows. Positions excluded by freshness or risk remain zero. The
program enforces venue/category caps both on submissions and the final aggregate;
infeasible or zero-median results close without publishing. The latest published
snapshot is retained by the v2 cleanup path, and older completed accounts are
archived before rent reclamation. The registry administrator remains trusted.

Legacy allocation open/submit instructions are disabled: consumers must migrate to
`open_allocation_round_v2`, `submit_weights_v2`, and `finalize_allocation_v2`.
The regenerated TypeScript/Rust SDK includes policy and snapshot instructions/codecs.
Old feed widths cannot change; a different cadence requires a new feed ID/PDA.
`AllocationState` and existing feed layouts remain compatible.

## Evidence and presentation

Current evidence is in [evidence/v2](evidence/v2/). Earlier `evidence/latest` is the
historical four-container demonstration; its claims describe that older run.

```bash
# Observe steady-state accounts, verify hashes/votes/caps, and decode transactions:
OBSERVE_SECONDS=240 node deployment/devnet/observe-v2.mjs
# Verify rent refunds against transaction balances and decode funding transfers:
node deployment/devnet/audit-v2.mjs
# Refresh the deployment walkthrough with decoded transactions and accounts:
node deployment/devnet/walkthrough.mjs
# Run explicitly labeled devnet fault experiments; restores stopped services:
node deployment/devnet/scenarios.mjs
# Refresh the evidence-backed pitch:
node deployment/devnet/pitch.mjs
# Optional editable PowerPoint export (python-pptx required):
python deployment/devnet/render_pitch.py
```

The dashboard exposes current feed heads separately from the exact consumed snapshot,
individual consumer votes, JSON export, Explorer links, and decoded transaction logs.
The policy sliders run browser-only simulations; they do not sign or publish.

The current [deployment walkthrough](evidence/v2/presentation.html) shows fourteen
steps with fetched transaction signatures, decoded instructions and account bytes.
Open it at <http://localhost:18880/walkthrough.html>. The four-minute capture
verified six publications, 308 confirmed transactions and refunds for 73 closed
accounts. Five devnet fault experiments passed.

## Validation and remaining scope

```bash
cargo test --locked -p quorum-allocation
npm --prefix testing/devnet test
npm --prefix deployment/devnet test
./scripts/devnet/test-policy.sh
npm --prefix sdk run build
npm --prefix sdk run check:rust
```

The six confirmed review findings are addressed: constrained median publication,
wide divergence arithmetic, terminal superseded rounds, terminal zero medians,
immutable feed widths, and consistent min/max interval validation. The SBF lifecycle
suite additionally checks snapshot commitments, consumer authorization, asynchronous
cadences, staleness, quorum loss, expiry and rent recovery.

Remaining work toward the original wider specification includes about ten distinct
feeds across four or five protocols, the full risk methodology and justified category
policy, independent operator hosts and RPC providers, Jito delivery, production
monitoring/funding, audit, capital execution and mainnet rollout. This demonstration
has twelve worker processes and wallets on one host under one administrator, shared
public RPC dependencies, and finite devnet SOL balances. It publishes allocation
signals; no capital is moved. The specification is
[specs/SPECIFICATION.md](../../specs/SPECIFICATION.md). The deleted task PDF is not
required to run the demonstration.

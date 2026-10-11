# What is built, and what remains

The current demonstration is a working USDC allocation **signal** pipeline on
Solana devnet. It reads real mainnet lending accounts and publishes allocation
weights; it does not execute deposits, withdrawals or rebalances.

| Area | Built now | Remaining toward the wider task / production |
|---|---|---|
| Sources | Marginfi, Save and Kamino mainnet USDC base supply APY; pinned SDK decoding and owner/mint/market checks | Approximately ten distinct metrics across four or five protocols; rewards and additional risk inputs |
| Producer consensus | Nine single-feed Docker processes, nine producer wallets, three signed median observations per feed, different cadences | Independent organizations/hosts and RPC providers; stronger per-feed authorization/source diversity |
| Consumer consensus | Three Docker processes with separate wallets, three-vote quorum, policy-bound v2 submissions | Migration of the older standalone Rust consumer and legacy harnesses to the v2 interface; new demo uses the complete JavaScript reference fleet |
| Shared inputs | Atomic on-chain RoundContext with values, ticks, sample slots, eligibility, full policy, authorized consumers, and SHA-256 commitment | Production policy governance and source-attestation threat modeling |
| Allocation logic | Fixed-point scoring, risk screening, venue/category caps enforced on submissions and final publication, safe abstention | Full supplied risk methodology and justified category definitions; current discounts/categories are illustrative |
| Correctness | Six confirmed contract findings fixed; 21 native tests; 12 compiled-program lifecycle checks; 45 JS unit tests; six generated-SDK ABI checks | External audit, broader adversarial testing, production review |
| Failure behavior | Devnet outlier, consumer loss, restart, stale-input abstention and feed recovery experiments, with signatures | Multi-host outage tests, long-term uptime and RPC-provider failover exercises |
| Runtime | Fifteen running containers, restart policies, isolated secrets, durable journals, rent cleanup, separate RPC gateway | Production deployment infrastructure, alerts, funding automation and operating budgets |
| Product demo | Live on-chain dashboard, exact consumed-input proof, individual votes, transaction decoding, policy simulator, Fleet view | Portfolio accounting, wallet transaction flows, real capital execution |
| Presentation | Evidence-backed 15-slide pitch in HTML/PDF/editable PowerPoint, linked on-chain accounts/transactions | Mainnet operating evidence, customers and commercial validation |
| Delivery | Ordinary Solana RPC transactions on devnet | Jito delivery integration and mainnet rollout |

The administrator and one host remain trusted. Separate processes and wallets
provide inspectable signed agreement; they do not establish organizational
independence. Public RPC access and devnet SOL balances remain finite dependencies.

## Showing that the containers are running

Open **http://localhost:18880/#fleet** beside the on-chain proof tab. It shows the
actual Docker state and health check for all fifteen services, each worker's
heartbeat age and latest slot, and the exact Docker-check time. The host monitor
updates the local page every fifteen seconds. A hosted copy labels the age of its
captured Docker check instead of claiming live access to the local Docker engine.

For direct evidence during a presentation, keep a second terminal visible:

```bash
./scripts/devnet/show-fleet.sh
```

This runs `watch` on `docker compose ps` every two seconds. Show the producer and
consumer logs if needed, then point to their public keys and signed on-chain votes
in the product. **Running/healthy containers and successful publications are
separate checks**; both are demonstrated.

Current decoded evidence and experiment results are in [evidence/v2](evidence/v2/).
Historical evidence in `evidence/latest` describes the earlier four-container run.

The 2026-10-11 v2 capture verified six publications in a four-minute observation,
fetched and decoded 308 confirmed transactions, and checked rent refunds for
73 closed accounts. All five devnet fault experiments passed. The captured
allocation was Marginfi 50%, Save 15.98%, Kamino 34.02%; the live page keeps reading
new publications. See the [deployment walkthrough](evidence/v2/presentation.html)
and [product pitch](evidence/v2/pitch.html).

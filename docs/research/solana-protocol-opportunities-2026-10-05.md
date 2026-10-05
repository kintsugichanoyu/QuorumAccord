# Solana protocol opportunities for Quorum

Research date: 2026-10-05. Repository baseline: `19c3f98`. Code links follow the
current `quorum-allocation` directory. Quorum was previously named Reflect;
Reflect Money below names the external product described by the cited sources.

The strongest opportunities are Kamino curator-vault support, current Project 0
native-bank coverage, and integrations for Exponent Strategy Vaults and Carrot.
Velocity merits a separate USDT assessment. These are priorities based on product
and engineering fit, not measured yield or validated financial risk scores.

## Who this system was built for

[The specification](../../specs/SPECIFICATION.md) explicitly names **Palindrome**
as the original user. Its stablecoin allocation pipeline fetched data, scored
lending venues, and produced weights through one Python process. Quorum is
intended to distribute the measurement and allocation decisions across operators,
preserve metric history on chain, and publish quorum-approved weights for
the upstream vault core (`reflect-core` at baseline, outside this repository).
The external vault/rebalancer remains responsible for execution.

The spec's initial venue set is **Marginfi, Save/Solend, Kamino, Jupiter Lend and
Loopscale** (§5.3 and the production driver design). Its principal inputs are
supply APY, utilization, liquidity/TVL, capacity limits and risk discounts.
Production measurements must come from venue accounts through Solana RPC (§1.1,
§9). Jito NCN integration is deferred (§10).

Public sources connect this work to Reflect Money: the
[Palindrome engineering organization](https://github.com/palindrome-eng)
publishes Reflect infrastructure, while the
[USDC+ strategy](https://docs.reflect.money/strategies/USDC) describes allocating
USDC to lending venues including Kamino and Jupiter. This connection is consistent
with the local spec; it does not establish that this repo is deployed in that
product. Reflect Money's wider
[documented audience](https://docs.reflect.money/introduction) includes fintechs,
payments/payroll products, treasuries, marketplaces and consumer apps.

The direct users of this repository's output are vault operators and allocation
consumers. Stablecoin holders and borrowers benefit indirectly through those
integrators. A lending venue can supply data and receive allocated liquidity
without adopting Quorum as its own allocation engine.

## Ranked opportunities

The benefits below are our inferences from each product's documented behavior.
No adoption, partnership or interest from the named teams has been established.

| Opportunity | Relationship to existing scope | Benefit from Quorum | Assessment |
| --- | --- | --- | --- |
| **Kamino curator vaults** | New vault primitive and potential consumer within an already planned protocol | Shared reserve measurements and published target weights can inform curator allocation decisions | Highest implementation priority |
| **Project 0 native banks** | Current Marginfi/mrgnLendv2 surface; expands the original bank adapter definition | Comparable lending measurements and explicit assessment of cross-venue collateral dependencies | High adapter priority |
| **Exponent Strategy Vaults** | Additional consumer/execution framework | An authorized manager could use Quorum feeds or agreed weights when choosing approved strategy actions | High consumer-integration priority |
| **Carrot CRT** | Additional stablecoin allocator and possible customer | Shared risk-adjusted lending inputs, allocation history and independent operator agreement | High discovery priority; exact interface remains unverified |
| **Velocity borrow/lend** | Separate deployment from legacy Drift | USDT lending rates, utilization and withdrawal-limit feeds | Conditional new venue; requires current schemas and audit/version review |
| **Lulo** | Additional allocation consumer with Solana and Ethereum exposure | Shared measurements for its Solana allocation component | Medium; cross-chain portfolio and coverage logic exceed this MVP |
| **Meteora Dynamic Vault** | Additional vault consumer; legacy product | Consensus feeds could inform the configured operator's strategy decisions | Lower priority; current documented external strategy support is concentrated in JupLend |

### Kamino curator vaults

[Kamino's vault docs](https://kamino.com/docs/curators/vaults) describe single-token
vaults routing capital across lending reserves. Its
[allocation model](https://kamino.com/docs/curators/vaults/concepts/allocations)
includes relative integer weights, absolute token caps and an unallocated buffer.
This creates a concrete mapping opportunity for Quorum's output.

Start with floating-rate USDC reserves. Proposed feeds include net supply yield,
utilization, available liquidity, remaining deposit capacity, market flags and
withdrawal-queue depth. Keep reserve identity separate from curator branding.
Gauntlet and Steakhouse are curator names, not independent lending programs.

An integration must translate weights and token caps explicitly. Fixed-rate
Conditional allocations ignore weights and depend on caps, so they need a
different model. The
[withdrawal documentation](https://kamino.com/docs/curators/vaults/concepts/liquidity-and-withdrawals)
also makes queue behavior and liquidity reserves material to allocation choices.

### Project 0 / current Marginfi surface

[The current Marginfi documentation](https://docs.marginfi.com/) introduces
Project 0 on mrgnLendv2. Its
[lending guide](https://docs.marginfi.com/guides/lending-and-earning-yield)
documents native lending banks, utilization-driven interest and USDC deposits.
This is a concrete candidate for extending the planned Marginfi driver.

Separate native banks from third-party collateral wrappers. The
[architecture overview](https://docs.marginfi.com/introduction/what-is-project-0)
explains that a wrapped Kamino deposit retains Kamino-derived yield, whereas
borrowing originates in P0 native banks. Counting both as independent liquidity
sources would misrepresent exposure. Useful feeds include native-bank net supply
yield, utilization, liquidity, caps, asset weights, oracle status and collateral
dependencies. P0 could also consume higher-level risk feeds; liquidation pricing
must retain its protocol-defined requirements.

Source inconsistency remains: the introduction labels Jupiter Lend integration
as forthcoming, while the [website](https://www.0.xyz/) and
[Solana's April roundup](https://solana.com/news/solana-ecosystem-roundup-april-2026)
describe it as integrated. Activation must be determined from the selected bank's
current accounts and configuration.

### Exponent Strategy Vaults and fixed yield

[Exponent Strategy Vaults](https://docs.exponent.finance/developer-strategy-vaults/create-vault)
offer manager-controlled, policy-gated actions, including Kamino, Jupiter Lend and
Loopscale integrations. Quorum can publish measurements or allocation targets
for an authorized manager to translate into permitted actions. Manager execution,
governance and queued withdrawals remain separate responsibilities.

[Exponent Core](https://docs.exponent.finance/developers/exponent-developer-docs)
also exposes principal/yield-token products. A stablecoin principal-token market
is a later potential allocation destination, requiring maturity, redemption,
entry/exit price, liquidity and underlying-source risk modeling. A quoted implied
fixed yield cannot simply replace a floating supply APY in today's rubric.

### Carrot and Lulo

[Carrot's CRT documentation](https://docs.deficarrot.com/products/earn/how-crt-works)
describes allocation across several Solana lending sources and consideration of
rates, liquidity and diversification. This closely matches Quorum's intended
consumer workflow. Carrot could evaluate shared inputs or consensus targets while
retaining its own vault execution. CRT's displayed APY is calculated from trailing
NAV changes; that differs from a current lending rate. Treating CRT itself as an
additional venue also requires tracking its underlying exposures to avoid counting
the same lending risk twice. Public docs do not establish a supported Quorum
integration interface.

[Lulo's current site](https://www.lulo.fi/) describes allocation using TVL and
lending rates across Solana and Ethereum, alongside a coverage system. Quorum's
Solana measurements could serve its Solana component. Full portfolio consensus,
bridge risk and coverage economics need additional design. Its public API example
requires an API key; that API is outside this repo's intended production
measurement path. Public marketing descriptions do not establish a keyless
account-decoding integration.

### Velocity and Meteora

[Velocity's migration guide](https://docs.velocity.exchange/developers/migrate-from-drift)
documents a new program deployment and PDAs, a paused legacy Drift program and
USDT as the mainnet quote token. Its
[borrow/lend model](https://docs.velocity.exchange/protocol/borrow-lend) exposes
utilization-dependent lending yield and withdrawal limits. Evaluate a selected
USDT lending market with current owner/layout checks and risk inputs. The
[developer overview](https://docs.velocity.exchange/developers) says the current
program source and monorepo are not public yet, which limits independent decoder
review. Reusing a legacy Drift USDC decoder is insufficient.

[Meteora Dynamic Vault](https://docs.meteora.ag/legacy-products/dynamic-vault/what-is-dynamic-vault)
has single-token vault accounting and an authorized operator. Its
[Hermes documentation](https://docs.meteora.ag/legacy-products/dynamic-vault/hermes/what-is-hermes)
places market monitoring and allocation policy off chain, creating a possible
consumer role for Quorum. However, current docs identify JupLend as the active
external lending handler. A wrapper allocation would inherit Jupiter exposure
and add vault/operator dependencies. Deployed code alone does not establish a
new independent yield source.

## Other candidates and scope boundaries

- **cLend and Carrot Boost pools:** named in Carrot's docs. Independent deployment
  identity, public schemas and external access were not established here. Keep
  them on the discovery list rather than registering invented mappings.
- **Texture SuperLendy:** a public
  [SDK repository](https://github.com/texture-fi/superlendy-sdk) exists; the displayed
  latest commit is June 2025. Current pool liquidity, supported mints and deposit
  status were not verified. Lower priority until account-level checks are possible.
- **Perena:** its [current product](https://perena.org/) includes structured
  portfolios involving lending, hedged positions and tokenized assets. There is
  potential demand for on-chain risk measurements, but the full product requires
  a broader methodology than the current lending rubric.
- **Jupiter Lend v2 Smart Vaults:**
  [Solana's August roundup](https://solana.com/news/solana-ecosystem-roundup-august-2026)
  describes trading-fee exposure alongside lending. Jupiter is already in the spec;
  this is a version/product assessment, not a newly discovered protocol. Keep
  vanilla Earn, smart-vault liquidity and JLP-linked collateral mappings explicit.
- SOL staking, volatile LP positions, leveraged yield-token positions and private
  credit require distinct asset, liquidity and risk models before allocation.

## Mainnet evidence

The [saved public RPC snapshot](evidence/solana-mainnet-2026-10-05.json) verifies
mainnet genesis and checks nine documented addresses at confirmed slot
**453531045**, on 2026-10-05 at 08:53:38 UTC. All nine existed, were executable and
were owned by the upgradeable loader: Kamino Lending/Vaults, Exponent Core/Strategy
Vaults, Meteora Dynamic Vault, Velocity, legacy Drift, Project 0/mrgnLendv2 and
Jupiter Lend Earn.

Sampled address histories contained recent successful transactions for Kamino
Vaults, Exponent Strategy Vaults, Meteora Dynamic Vault and Velocity. The Meteora
sample also contained failures, preserved in the evidence. Legacy Drift's sample
was older; its current operational status is described by Velocity's docs.

These read-only checks establish program existence and sampled activity. They do
not decode a particular pool, certify a deposit/withdrawal path, measure available
stablecoin liquidity, verify deployed bytecode against a release, or prove adapter
compatibility. No signing, deposits or rebalances were performed.

## Concrete implementation sequence

1. **Pin one current USDC reserve for each baseline source:** Kamino and Jupiter
   Earn. Their inclusion is supported both by the local spec and the public USDC+
   strategy. Pin program version, market, mint and related accounts; implement
   typed reads for yield, utilization, liquidity, caps and status.
2. **Extend bank coverage to P0 native USDC:** explicitly distinguish native banks
   and third-party wrappers. Validate interest units and incentive treatment.
3. **Build a read-only Kamino curator or Exponent Strategy Vault integration:**
   compare published inputs/targets with current allocations and show source
   identities and freshness. A production execution adapter remains separate work.
4. **Assess Carrot as a feed consumer and Velocity USDT as a new venue:** qualify
   exact accounts, schemas, risk policies and interfaces before registering feeds.

The existing [release ledger](../../OPEN_QUESTIONS.md) still requires coherent
snapshots, mandatory risk-input coverage, full financial methodology, cap
preservation and a reserve/halted policy when eligible capacity is insufficient.
Those requirements apply to every proposed addition. Independent operator
agreement cannot correct a shared faulty decoder or establish source truth.

There are also concrete reuse limits in the current code:

- [The allocation vector](../../programs/quorum-allocation/src/constants.rs) is
  fixed at **16 venue entries**. Slots must identify particular markets/pools, with
  additional tracking for common underlying exposure.
- [Allocation state and consensus seeds](../../programs/quorum-allocation/src/instructions/allocation.rs)
  provide one allocation stream per deployment. Independent customers with
  different mandates need strategy-specific state or separate deployments; sharing
  metric feeds does not require sharing allocation policies.
- New scalar feeds use the existing generic consensus path. Structured collateral
  composition, signed yields and maturity-sensitive strategies need explicit
  representation and methodology decisions.

Research used primary protocol docs and direct mainnet RPC checks. The shortlist
is selective. Rain's documentation and Meteora's generic developer-guide URL
returned Firecrawl `INVALID_ARGUMENT`; usable Meteora legacy pages were retrieved
separately. A guessed Texture constants-file URL returned 404. None of those
failed fetches was treated as evidence of protocol availability or inactivity.

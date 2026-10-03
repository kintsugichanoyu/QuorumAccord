//! TEST ONLY: independent HTTP price providers, an on-chain price consumer and
//! an executable multi-process integration suite. No HTTP driver is added to the
//! production producer. Prices are integer millionths of USD, not allocation APY.

use anyhow::{anyhow, bail, ensure, Context, Result};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use solana_sdk::{
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair},
    signer::Signer,
    system_instruction,
    transaction::{Transaction, TransactionError},
};
use std::{
    env, fs,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use worker_core::{
    feed_view::{AllocationStateView, DataFeedView},
    ix, pda,
    rpc::RpcPool,
    tx,
};

const PROTOCOLS: [&str; 3] = ["atlas", "boreal", "cygnus"];
const DEVNET_GENESIS: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

#[derive(Clone, Deserialize)]
struct Asset {
    symbol: String,
    pool_id: u8,
    data_id: u8,
    base_price_micro_usd: u64,
}

#[derive(Deserialize)]
struct Config {
    network: String,
    rpc_url: String,
    program_id: String,
    backend_url: String,
    admin_keypair: String,
    operator_keypairs: Vec<String>,
    outsider_keypair: String,
    window_slots: u32,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Quote {
    test_only: bool,
    protocol: String,
    symbol: String,
    price_micro_usd: u64,
    decimals: u8,
    phase: String,
    observed_at_ms: u64,
}

impl Quote {
    fn validate(&self, protocol: &str, symbol: &str, now: u64) -> Result<()> {
        ensure!(self.test_only, "backend did not identify test data");
        ensure!(
            self.protocol == protocol && self.symbol == symbol,
            "wrong quote identity"
        );
        ensure!(
            self.decimals == 6 && self.price_micro_usd > 0,
            "invalid quote units/value"
        );
        ensure!(
            self.observed_at_ms <= now + 1000 && now.saturating_sub(self.observed_at_ms) <= 30_000,
            "stale/future backend quote"
        );
        Ok(())
    }
}

#[derive(Serialize)]
struct Price {
    symbol: String,
    price_micro_usd: u64,
    tick: u64,
    finalized_window_slot: u64,
    rpc_context_slot: u64,
    feed: String,
}

struct Lab {
    cfg: Config,
    pool: RpcPool,
    program: Pubkey,
    admin: Keypair,
    ops: Vec<Keypair>,
    outsider: Keypair,
    http: Client,
}

fn keypair(path: &str) -> Result<Keypair> {
    read_keypair_file(path).map_err(|e| anyhow!("cannot read test keypair {path}: {e}"))
}

impl Lab {
    fn load() -> Result<Self> {
        let path = env::var("LAB_CONFIG")
            .context("set LAB_CONFIG to testing/devnet/.state/<network>.json")?;
        let cfg: Config = serde_json::from_slice(&fs::read(path)?)?;
        ensure!(
            cfg.operator_keypairs.len() == 3,
            "need three distinct test operators"
        );
        ensure!(
            cfg.window_slots >= 30 && cfg.window_slots <= 600,
            "window must be 30..600 slots"
        );
        ensure!(!cfg.assets.is_empty(), "no assets configured");
        ensure!(
            cfg.backend_url.starts_with("http://127.0.0.1:")
                || cfg.backend_url.starts_with("http://localhost:"),
            "test backend must be loopback"
        );
        let pool = RpcPool::new(&[cfg.rpc_url.clone()]);
        let genesis = pool.primary().get_genesis_hash()?.to_string();
        match cfg.network.as_str() {
            "devnet" => ensure!(genesis == DEVNET_GENESIS, "RPC is not devnet"),
            "localnet" => ensure!(
                cfg.rpc_url.starts_with("http://127.0.0.1:")
                    || cfg.rpc_url.starts_with("http://localhost:"),
                "localnet RPC must be loopback"
            ),
            _ => bail!("only localnet and devnet are supported"),
        }
        let ops = cfg
            .operator_keypairs
            .iter()
            .map(|p| keypair(p))
            .collect::<Result<Vec<_>>>()?;
        ensure!(
            ops[0].pubkey() != ops[1].pubkey()
                && ops[0].pubkey() != ops[2].pubkey()
                && ops[1].pubkey() != ops[2].pubkey(),
            "operator keys must be independent"
        );
        Ok(Self {
            program: cfg.program_id.parse()?,
            admin: keypair(&cfg.admin_keypair)?,
            outsider: keypair(&cfg.outsider_keypair)?,
            ops,
            pool,
            cfg,
            http: Client::builder().timeout(Duration::from_secs(10)).build()?,
        })
    }

    fn send(&self, payer: &Keypair, instruction: Instruction) -> Result<String> {
        Ok(tx::send_with_retry(self.pool.primary(), payer, &[instruction], 3)?.to_string())
    }

    fn exists(&self, key: &Pubkey) -> Result<bool> {
        Ok(self.pool.get_account_with_context(key, 0)?.1.is_some())
    }

    fn reject(&self, payer: &Keypair, instruction: Instruction, code: u32) -> Result<()> {
        let hash = self.pool.primary().get_latest_blockhash()?;
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&payer.pubkey()),
            &[payer],
            hash,
        );
        let response = self.pool.primary().simulate_transaction(&transaction)?;
        let expected = Some(TransactionError::InstructionError(
            0,
            InstructionError::Custom(code),
        ));
        ensure!(
            response.value.err == expected,
            "expected custom error {code}, got {:?}; logs={:?}",
            response.value.err,
            response.value.logs
        );
        Ok(())
    }

    fn feed(&self, asset: &Asset) -> Pubkey {
        pda::data_feed(&self.program, asset.pool_id, asset.data_id).0
    }

    fn view(&self, asset: &Asset) -> Result<DataFeedView> {
        let account = self.pool.primary().get_account(&self.feed(asset))?;
        ensure!(account.owner == self.program, "feed has wrong owner");
        DataFeedView::parse(&account.data)
    }

    fn wait_slot(&self, target: u64) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(360);
        while self.pool.get_slot()? < target {
            ensure!(
                Instant::now() < deadline,
                "timed out waiting for slot {target}"
            );
            thread::sleep(Duration::from_millis(350));
        }
        Ok(())
    }

    fn next_window(&self) -> Result<(u64, u64)> {
        let width = self.cfg.window_slots as u64;
        let slot = self.pool.get_slot()?;
        let current = slot / width;
        let index = if (current + 1) * width - slot >= width * 3 / 4 {
            current
        } else {
            current + 1
        };
        self.wait_slot(index * width)?;
        Ok((index, (index + 1) * width))
    }

    fn setup(&self) -> Result<Value> {
        let mut signatures = Vec::new();
        for op in self.ops.iter().chain(std::iter::once(&self.outsider)) {
            if self.pool.primary().get_balance(&op.pubkey())? < 100_000_000 {
                signatures.push(self.send(
                    &self.admin,
                    system_instruction::transfer(&self.admin.pubkey(), &op.pubkey(), 200_000_000),
                )?);
            }
        }
        let registry = pda::registry(&self.program).0;
        let bootstrap_checked = !self.exists(&registry)?;
        if bootstrap_checked {
            self.reject(
                &self.outsider,
                ix::init_registry(&self.program, &self.outsider.pubkey()),
                6000,
            )?;
            ensure!(
                !self.exists(&registry)?,
                "outsider simulation created registry"
            );
            signatures.push(self.send(
                &self.admin,
                ix::init_registry(&self.program, &self.admin.pubkey()),
            )?);
        }
        // Read registered keys rather than swallowing arbitrary transaction errors.
        for op in &self.ops {
            let account = self.pool.primary().get_account(&registry)?;
            let count = u16::from_le_bytes(account.data[40..42].try_into()?) as usize;
            let registered = (0..count)
                .any(|i| account.data[44 + i * 32..76 + i * 32] == op.pubkey().to_bytes());
            if !registered {
                signatures.push(self.send(
                    &self.admin,
                    ix::add_operator(&self.program, &self.admin.pubkey(), &op.pubkey()),
                )?);
            }
        }
        for asset in &self.cfg.assets {
            if !self.exists(&self.feed(asset))? {
                signatures.push(self.send(
                    &self.admin,
                    ix::init_data_feed(
                        &self.program,
                        &self.admin.pubkey(),
                        asset.pool_id,
                        asset.data_id,
                        &self.feed_config(3),
                    ),
                )?);
            } else {
                ensure!(
                    self.view(asset)?.window_slots == self.cfg.window_slots,
                    "pre-existing feed has incompatible window; use fresh deployment"
                );
            }
        }
        for (pool, quorum) in [(190u8, 0), (191, 65)] {
            self.reject(
                &self.admin,
                ix::init_data_feed(
                    &self.program,
                    &self.admin.pubkey(),
                    pool,
                    250,
                    &self.feed_config(quorum),
                ),
                6005,
            )?;
        }
        Ok(
            json!({"bootstrap_authority_checked": bootstrap_checked, "invalid_quorums_rejected": [0,65], "signatures": signatures}),
        )
    }

    fn feed_config(&self, min_number: u8) -> ix::DataFeedConfig {
        ix::DataFeedConfig {
            measurand: 0,
            window_slots: self.cfg.window_slots,
            threshold_bps: 50,
            min_interval_slots: 0,
            max_interval_slots: self.cfg.window_slots,
            min_number,
            rule: 1,
            trim_pct: 0,
        }
    }

    fn provide(&self, index: usize, window: u64) -> Result<Value> {
        let protocol = PROTOCOLS
            .get(index)
            .context("operator index must be 0..2")?;
        let operator = &self.ops[index];
        let mut reports = Vec::new();
        for asset in &self.cfg.assets {
            let quote: Quote = self
                .http
                .get(format!(
                    "{}/v1/protocols/{}/prices/{}",
                    self.cfg.backend_url, protocol, asset.symbol
                ))
                .send()?
                .error_for_status()?
                .json()?;
            let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
            quote.validate(protocol, &asset.symbol, now)?;
            let slot = self.pool.get_slot()?;
            ensure!(
                slot / self.cfg.window_slots as u64 == window,
                "missed price window {window}"
            );
            let consensus = pda::tick_consensus(&self.program, &self.feed(asset), window).0;
            let instruction = if self.exists(&consensus)? {
                ix::corroborate_sample(
                    &self.program,
                    asset.pool_id,
                    asset.data_id,
                    window,
                    &operator.pubkey(),
                    quote.price_micro_usd,
                    slot,
                )
            } else {
                ix::propose_sample(
                    &self.program,
                    asset.pool_id,
                    asset.data_id,
                    window,
                    &operator.pubkey(),
                    quote.price_micro_usd,
                    slot,
                )
            };
            // A concurrent opener can win after our existence check. Retry as a
            // corroborator only if the PDA actually exists and this signer has
            // not already submitted (transaction confirmation may be ambiguous).
            let signature = match self.send(operator, instruction) {
                Ok(signature) => signature,
                Err(original) => {
                    let Some(account) = self.pool.get_account_with_context(&consensus, 0)?.1 else {
                        return Err(original);
                    };
                    let count =
                        worker_core::feed_view::sample_consensus_count(&account.data) as usize;
                    let submitted = (0..count).any(|i| {
                        worker_core::feed_view::sample_submission_submitter(&account.data, i)
                            == operator.pubkey()
                    });
                    ensure!(
                        !submitted,
                        "ambiguous confirmation; operator already submitted: {original}"
                    );
                    self.send(
                        operator,
                        ix::corroborate_sample(
                            &self.program,
                            asset.pool_id,
                            asset.data_id,
                            window,
                            &operator.pubkey(),
                            quote.price_micro_usd,
                            slot,
                        ),
                    )?
                }
            };
            reports.push(json!({"symbol": asset.symbol, "price_micro_usd": quote.price_micro_usd, "phase": quote.phase, "signature": signature}));
        }
        Ok(
            json!({"operator": operator.pubkey().to_string(), "protocol": protocol, "window": window, "reports": reports}),
        )
    }

    fn consume(&self) -> Result<Value> {
        let mut prices = Vec::new();
        for asset in &self.cfg.assets {
            let (context, account) = self.pool.get_account_with_context(&self.feed(asset), 0)?;
            let account = account.context("price feed missing")?;
            ensure!(
                account.owner == self.program,
                "price account owner mismatch"
            );
            let view = DataFeedView::parse(&account.data)?;
            ensure!(view.tick > 0, "no consensus price yet for {}", asset.symbol);
            ensure!(
                view.last_finalized_slot <= context
                    && !view.is_stale(context, 4 * self.cfg.window_slots as u64),
                "stale/future price for {}",
                asset.symbol
            );
            prices.push(Price {
                symbol: asset.symbol.clone(),
                price_micro_usd: view.scalar(&account.data),
                tick: view.tick,
                finalized_window_slot: view.last_finalized_slot,
                rpc_context_slot: context,
                feed: self.feed(asset).to_string(),
            });
        }
        Ok(
            json!({"network": self.cfg.network, "program": self.program.to_string(), "decimals": 6, "prices": prices}),
        )
    }

    fn run_window(
        &self,
        phase: &str,
        participants: &[usize],
        advance: bool,
        before_close_checks: bool,
    ) -> Result<Value> {
        self.http
            .post(format!("{}/control/state", self.cfg.backend_url))
            .json(&json!({"phase": phase}))
            .send()?
            .error_for_status()?;
        let before = self
            .cfg
            .assets
            .iter()
            .map(|a| self.view(a))
            .collect::<Result<Vec<_>>>()?;
        let (window, closes) = self.next_window()?;
        eprintln!("[{phase}] providers={participants:?}, window={window}, closes={closes}");
        let mut children = Vec::new();
        for &index in participants {
            children.push((
                index,
                Command::new(env::current_exe()?)
                    .args(["provide", &index.to_string(), &window.to_string()])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()?,
            ));
        }
        let mut providers = Vec::new();
        for (index, child) in children {
            let output = child.wait_with_output()?;
            if phase == "unavailable" && index == 2 {
                ensure!(
                    !output.status.success(),
                    "unavailable provider unexpectedly submitted"
                );
                let error = String::from_utf8_lossy(&output.stderr).to_string();
                ensure!(
                    error.contains("503"),
                    "provider failure was not the injected backend outage: {error}"
                );
                providers.push(json!({"protocol": PROTOCOLS[index], "expected_error": error}));
            } else {
                ensure!(
                    output.status.success(),
                    "provider {index} failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
                providers.push(serde_json::from_slice::<Value>(&output.stdout)?);
            }
        }
        if before_close_checks {
            let a = &self.cfg.assets[0];
            let slot = self.pool.get_slot()?;
            ensure!(slot < closes, "providers exhausted the submission window");
            self.reject(
                &self.ops[0],
                ix::corroborate_sample(
                    &self.program,
                    a.pool_id,
                    a.data_id,
                    window,
                    &self.ops[0].pubkey(),
                    a.base_price_micro_usd,
                    slot,
                ),
                6013,
            )?;
            self.reject(
                &self.outsider,
                ix::corroborate_sample(
                    &self.program,
                    a.pool_id,
                    a.data_id,
                    window,
                    &self.outsider.pubkey(),
                    a.base_price_micro_usd,
                    slot,
                ),
                6001,
            )?;
            self.reject(
                &self.admin,
                ix::finalize_sample(
                    &self.program,
                    a.pool_id,
                    a.data_id,
                    window,
                    &self.admin.pubkey(),
                ),
                6011,
            )?;
        }
        self.wait_slot(closes + 2)?;
        let mut signatures = Vec::new();
        for (asset, previous) in self.cfg.assets.iter().zip(before) {
            signatures.push(self.send(
                &self.admin,
                ix::finalize_sample(
                    &self.program,
                    asset.pool_id,
                    asset.data_id,
                    window,
                    &self.admin.pubkey(),
                ),
            )?);
            let after = self.view(asset)?;
            ensure!(
                after.tick == previous.tick + u64::from(advance),
                "unexpected tick transition for {}",
                asset.symbol
            );
            if advance {
                let expected = if phase == "updated" {
                    asset.base_price_micro_usd * 11 / 10
                } else {
                    asset.base_price_micro_usd
                };
                ensure!(
                    after.last_value == expected && after.last_finalized_slot == closes,
                    "wrong aggregate for {}: {:?}",
                    asset.symbol,
                    after
                );
            } else {
                ensure!(
                    after.last_value == previous.last_value
                        && after.last_finalized_slot == previous.last_finalized_slot,
                    "quorum miss changed published data"
                );
            }
            let consensus = pda::tick_consensus(&self.program, &self.feed(asset), window).0;
            let account = self.pool.primary().get_account(&consensus)?;
            ensure!(
                worker_core::feed_view::sample_consensus_status(&account.data)
                    == if advance { 2 } else { 1 },
                "wrong final consensus status"
            );
        }
        let backend: Value = self
            .http
            .get(format!("{}/control/state", self.cfg.backend_url))
            .send()?
            .error_for_status()?
            .json()?;
        for &index in participants {
            let requests = backend["requests"][PROTOCOLS[index]]
                .as_u64()
                .context("missing backend request counter")?;
            ensure!(
                requests
                    >= if phase == "unavailable" && index == 2 {
                        1
                    } else {
                        self.cfg.assets.len() as u64
                    },
                "provider did not actually call backend"
            );
        }
        // Exercise the standalone consumer as a separate process, not only the
        // verification helpers inside the orchestrator.
        let output = Command::new(env::current_exe()?).arg("consume").output()?;
        ensure!(
            output.status.success(),
            "price consumer failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let consumed: Value = serde_json::from_slice(&output.stdout)?;
        for (price, asset) in consumed["prices"]
            .as_array()
            .context("missing consumer prices")?
            .iter()
            .zip(&self.cfg.assets)
        {
            ensure!(
                price["price_micro_usd"].as_u64() == Some(self.view(asset)?.last_value),
                "consumer read a different price"
            );
        }
        Ok(
            json!({"phase": phase, "advanced": advance, "window": window, "providers": providers, "backend": backend, "consumer": consumed, "finalize_signatures": signatures}),
        )
    }

    fn allocation_checks(&self) -> Result<Value> {
        let state = pda::allocation_state(&self.program).0;
        if !self.exists(&state)? {
            self.send(
                &self.admin,
                ix::init_allocation_state(&self.program, &self.admin.pubkey()),
            )?;
        }
        let round = self.pool.get_slot()?;
        let closes = round + self.cfg.window_slots as u64;
        for quorum in [0, 65] {
            self.reject(
                &self.admin,
                ix::open_allocation_round(
                    &self.program,
                    &self.admin.pubkey(),
                    round + 100 + quorum as u64,
                    closes,
                    quorum,
                    0,
                    0,
                ),
                6005,
            )?;
        }
        let mut signatures = Vec::new();
        for r in [round, round + 1] {
            signatures.push(self.send(
                &self.admin,
                ix::open_allocation_round(&self.program, &self.admin.pubkey(), r, closes, 2, 0, 0),
            )?);
            for i in 0..2 {
                let mut weights = [0u16; 16];
                weights[..2].copy_from_slice(if i == 0 { &[5001, 4999] } else { &[5000, 5000] });
                signatures.push(self.send(
                    &self.ops[i],
                    ix::submit_weights(&self.program, r, &self.ops[i].pubkey(), &weights),
                )?);
            }
        }
        self.wait_slot(closes + 2)?;
        signatures.push(self.send(
            &self.admin,
            ix::finalize_allocation(&self.program, round + 1, &self.admin.pubkey()),
        )?);
        self.reject(
            &self.admin,
            ix::finalize_allocation(&self.program, round, &self.admin.pubkey()),
            6018,
        )?;
        let account = self.pool.primary().get_account(&state)?;
        let published = AllocationStateView::parse(&account.data)?;
        ensure!(
            published.round == round + 1,
            "old allocation overwrote newer round"
        );
        ensure!(
            published.weights[..2] == [5000, 5000]
                && published.weights[2..].iter().all(|&w| w == 0),
            "rounding allocated to excluded venues"
        );
        Ok(
            json!({"new_round": published.round, "old_round_rejected": round, "weights": published.weights, "invalid_quorums_rejected": [0,65], "signatures": signatures}),
        )
    }

    fn suite(&self) -> Result<Value> {
        let setup = self.setup()?;
        let scenarios = vec![
            self.run_window("baseline", &[0, 1, 2], true, true)?,
            self.run_window("baseline", &[0, 1], false, false)?,
            self.run_window("outlier", &[0, 1, 2], true, false)?,
            self.run_window("updated", &[0, 1, 2], true, false)?,
            self.run_window("unavailable", &[0, 1, 2], false, false)?,
        ];
        let allocation = self.allocation_checks()?;
        Ok(
            json!({"status": "passed", "network": self.cfg.network, "program": self.program.to_string(),
            "rpc": self.cfg.rpc_url, "admin": self.admin.pubkey().to_string(), "setup": setup,
            "scenarios": scenarios, "allocation": allocation, "limitations": ["test-only HTTP data", "one centralized fixture backend", "no real lending protocol integration"]}),
        )
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    let lab = Lab::load()?;
    let result = match args.get(1).map(String::as_str).unwrap_or("consume") {
        "setup" => lab.setup()?,
        "provide" => lab.provide(
            args.get(2)
                .context("provide <operator index> <window>")?
                .parse()?,
            args.get(3).context("missing window")?.parse()?,
        )?,
        "consume" => lab.consume()?,
        "watch" => loop {
            println!("{}", lab.consume()?);
            thread::sleep(Duration::from_secs(2));
        },
        "suite" => lab.suite()?,
        command => bail!("unknown command {command}; use setup/provide/consume/watch/suite"),
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_quotes_reject_wrong_identity_units_and_staleness() {
        let mut q = Quote {
            test_only: true,
            protocol: "atlas".into(),
            symbol: "SOL".into(),
            price_micro_usd: 10,
            decimals: 6,
            phase: "baseline".into(),
            observed_at_ms: 100_000,
        };
        assert!(q.validate("atlas", "SOL", 100_010).is_ok());
        assert!(q.validate("cygnus", "SOL", 100_010).is_err());
        assert!(q.validate("atlas", "BTC", 100_010).is_err());
        assert!(q.validate("atlas", "SOL", 140_000).is_err());
        assert!(q.validate("atlas", "SOL", 1).is_err());
        q.decimals = 9;
        assert!(q.validate("atlas", "SOL", 100_010).is_err());
    }
}

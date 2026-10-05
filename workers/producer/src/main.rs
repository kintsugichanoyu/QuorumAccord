//! Producer daemon. One instance per `DataFeed`, per operator.
//!
//! Loop: derive the current tick window from the Solana clock, read the assigned
//! venue account with a context lower bound, decode it to fixed-point bps, and `propose` (or
//! `corroborate`) into the window's consensus. Once the previous window has
//! closed, crank `finalize_sample`. The on-chain program is authoritative for
//! windows, brakes and triggers — the producer is a write-only sensor.

mod driver;
mod drivers;

use std::{thread, time::Duration};

use anyhow::{anyhow, bail, Result};
use solana_sdk::signer::Signer;
use quorum_worker_core::{
    config::WorkerConfig, feed_view::DataFeedView, ix, pda, rpc::RpcPool, tx, window,
};

use driver::Driver;

fn env(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| anyhow!("{key} not set"))
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

/// Build the configured driver. The MVP exposes the generic offset decoder; real
/// protocol drivers register here behind a `DRIVER` selector.
fn build_driver() -> Result<Box<dyn Driver>> {
    let kind = std::env::var("DRIVER").unwrap_or_else(|_| "offset_u64".to_string());
    match kind.as_str() {
        "offset_u64" => Ok(Box::new(drivers::OffsetU64Driver {
            pool_id: env("POOL_ID")?.parse()?,
            data_id: env("DATA_ID")?.parse()?,
            target: env("TARGET_ACCOUNT")?.parse()?,
            offset: env_parse("OFFSET", 0usize),
            scale_num: env_parse("SCALE_NUM", 1u128),
            scale_den: env_parse("SCALE_DEN", 1u128),
        })),
        other => bail!("unknown DRIVER '{other}'"),
    }
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = WorkerConfig::from_env()?;
    let pool = RpcPool::new(&cfg.rpc_urls);
    let driver = build_driver()?;
    let operator = cfg.keypair.pubkey();
    let feed_pda = pda::data_feed(&cfg.program_id, driver.pool_id(), driver.data_id()).0;
    let poll = Duration::from_millis(env_parse("POLL_MS", 2000u64));

    tracing::info!(
        "producer up: feed=({},{}) pda={feed_pda} operator={operator}",
        driver.pool_id(),
        driver.data_id()
    );

    let mut last_finalized_window: Option<u64> = None;
    loop {
        if let Err(e) = tick(
            &pool,
            &cfg,
            driver.as_ref(),
            &feed_pda,
            &operator,
            &mut last_finalized_window,
        ) {
            tracing::warn!("tick error: {e}");
        }
        thread::sleep(poll);
    }
}

fn tick(
    pool: &RpcPool,
    cfg: &WorkerConfig,
    driver: &dyn Driver,
    feed_pda: &solana_sdk::pubkey::Pubkey,
    operator: &solana_sdk::pubkey::Pubkey,
    last_finalized_window: &mut Option<u64>,
) -> Result<()> {
    // Read the feed config to learn the window width.
    let feed_acct = pool.primary().get_account(feed_pda)?;
    let view = DataFeedView::parse(&feed_acct.data)?;
    let window_slots = view.window_slots as u64;
    if window_slots == 0 {
        bail!("feed window_slots is 0");
    }

    let slot = pool.get_slot()?;
    let widx = window::window_index(slot, window_slots);

    // Read + decode the venue account, pinned at this slot.
    if let Some(acct) = pool.get_account_pinned(&driver.target_account(), slot)? {
        let value = driver.decode(&acct.data)?;
        let consensus = pda::tick_consensus(&cfg.program_id, feed_pda, widx).0;
        let exists = pool.primary().get_account(&consensus).is_ok();
        let instruction = if exists {
            ix::corroborate_sample(
                &cfg.program_id,
                driver.pool_id(),
                driver.data_id(),
                widx,
                operator,
                value,
                slot,
            )
        } else {
            ix::propose_sample(
                &cfg.program_id,
                driver.pool_id(),
                driver.data_id(),
                widx,
                operator,
                value,
                slot,
            )
        };
        match tx::send_with_retry(pool.primary(), &cfg.keypair, &[instruction], 3) {
            Ok(sig) => {
                tracing::info!("submit window={widx} value={value} exists={exists} sig={sig}")
            }
            Err(e) => tracing::warn!("submit failed (window={widx}): {e}"),
        }
    }

    // Crank finalize for the previous window once it has closed.
    if widx > 0 {
        let prev = widx - 1;
        if *last_finalized_window != Some(prev) {
            let prev_consensus = pda::tick_consensus(&cfg.program_id, feed_pda, prev).0;
            if pool.primary().get_account(&prev_consensus).is_ok() {
                let fin = ix::finalize_sample(
                    &cfg.program_id,
                    driver.pool_id(),
                    driver.data_id(),
                    prev,
                    operator,
                );
                if let Ok(sig) = tx::send_with_retry(pool.primary(), &cfg.keypair, &[fin], 2) {
                    tracing::info!("finalize window={prev} sig={sig}");
                    *last_finalized_window = Some(prev);
                }
            }
        }
    }
    Ok(())
}

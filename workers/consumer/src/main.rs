//! Consumer daemon. Reads each `DataFeed` with a minimum-context-slot lower bound,
//! runs the fixed-point rubric, and submits the resulting weight vector into the
//! active `AllocationConsensus`. Reads chain only; tolerant of producer failure
//! (stale feeds exclude their venue).
//!
//! Feed → venue mapping is provided via the `FEEDS` env var as JSON, e.g.:
//! `[{"pool_id":1,"data_id":0,"venue":0,"role":"apy"},
//!   {"pool_id":1,"data_id":1,"venue":0,"role":"crr","cap_bps":4000}, ...]`
//!
//! NOTE: the (pool_id,data_id)->role mapping and CRR derivation are MVP
//! simplifications; production maps these per `ALLOCATION_METHODOLOGY.md`.

use std::{thread, time::Duration};

use anyhow::{Context, Result};
use serde::Deserialize;
use solana_sdk::signer::Signer;
use quorum_worker_core::{config::WorkerConfig, feed_view::DataFeedView, ix, pda, rpc::RpcPool, tx};

use quorum_rubric::{compute_weights, RubricConfig, VenueInput, MAX_BPS};

const N_VENUES: usize = 16; // must match the on-chain program

#[derive(Deserialize, Clone)]
struct FeedSpec {
    pool_id: u8,
    data_id: u8,
    venue: usize,
    role: String, // "apy" | "crr"
    cap_bps: Option<u16>,
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = WorkerConfig::from_env()?;
    let pool = RpcPool::new(&cfg.rpc_urls);
    let feeds: Vec<FeedSpec> =
        serde_json::from_str(&std::env::var("FEEDS").context("FEEDS not set")?)
            .context("FEEDS is not valid JSON")?;
    let round: u64 = env_parse("ROUND", 0u64);
    let staleness: u64 = env_parse("STALENESS_SLOTS", 150_000u64);
    let poll = Duration::from_millis(env_parse("POLL_MS", 5000u64));
    let operator = cfg.keypair.pubkey();

    tracing::info!("consumer up: {} feeds, operator={operator}", feeds.len());

    loop {
        match run_once(&pool, &cfg, &feeds, round, staleness, &operator) {
            Ok(weights) => tracing::info!("round={round} weights={weights:?}"),
            Err(e) => tracing::warn!("consumer run error: {e}"),
        }
        thread::sleep(poll);
    }
}

fn run_once(
    pool: &RpcPool,
    cfg: &WorkerConfig,
    feeds: &[FeedSpec],
    round: u64,
    staleness: u64,
    operator: &solana_sdk::pubkey::Pubkey,
) -> Result<Vec<u16>> {
    // Local freshness lower bound only. This is not shared across operators and
    // minContextSlot does not select an exact historical snapshot.
    let anchor_slot = pool.get_slot()?;

    let mut apy = [0u64; N_VENUES];
    let mut crr = [0u64; N_VENUES];
    let mut cap = [MAX_BPS as u16; N_VENUES];
    let mut stale = [false; N_VENUES];

    for f in feeds {
        if f.venue >= N_VENUES {
            continue;
        }
        if let Some(c) = f.cap_bps {
            cap[f.venue] = c;
        }
        let feed_pda = pda::data_feed(&cfg.program_id, f.pool_id, f.data_id).0;
        let Some(acct) = pool.get_account_pinned(&feed_pda, anchor_slot)? else {
            stale[f.venue] = true;
            continue;
        };
        let view = DataFeedView::parse(&acct.data)?;
        if view.is_stale(anchor_slot, staleness) {
            stale[f.venue] = true;
        }
        let value = view.scalar(&acct.data);
        match f.role.as_str() {
            "apy" => apy[f.venue] = value,
            "crr" => crr[f.venue] = value,
            other => tracing::warn!("unknown feed role '{other}'"),
        }
    }

    let venues: Vec<VenueInput> = (0..N_VENUES)
        .map(|v| VenueInput {
            apy_bps: apy[v],
            crr_bps: crr[v],
            cap_bps: cap[v],
            stale: stale[v],
        })
        .collect();

    let weights = compute_weights(&venues, &RubricConfig::default());

    // Pad/truncate to the fixed on-chain vector width.
    let mut w16 = [0u16; N_VENUES];
    for (i, &w) in weights.iter().take(N_VENUES).enumerate() {
        w16[i] = w;
    }

    let instruction = ix::submit_weights(&cfg.program_id, round, operator, &w16);
    match tx::send_with_retry(pool.primary(), &cfg.keypair, &[instruction], 3) {
        Ok(sig) => tracing::info!("submit_weights round={round} sig={sig}"),
        Err(e) => tracing::warn!("submit_weights failed: {e}"),
    }
    Ok(w16.to_vec())
}

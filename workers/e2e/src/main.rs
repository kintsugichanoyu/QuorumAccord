//! Devnet end-to-end harness for the reflect allocation flow.
//!
//! Drives the whole pipeline against a controlled data source (the `mock-oracle`
//! program) and then *fetches the resulting on-chain accounts and asserts they
//! are logically correct*: each `DataFeed` ring head equals the value we injected,
//! and `AllocationState.weights` equals what `rubric::compute_weights` produces
//! for those same inputs (summing to exactly 10 000 bps).
//!
//! Commands:
//!   setup            init registry/operators/feeds/alloc-state/mocks + seed values
//!   run-happy        scripted happy path (sample → aggregate → consume → allocate)
//!   run-invariants   scenarios 2–6 + cross-operator determinism, each self-checking
//!   verify           fetch accounts and assert (CI-gradeable: non-zero on failure)
//!   open-round       open the allocation round (admin)
//!   crank-alloc      finalize the allocation round (anyone)
//!   sample <op> <pool> <data> <value>     submit one sample in the current window
//!   crank-sample <pool> <data> <window>   finalize one sample window
//!
//! Config (env): SOLANA_RPC_URL, PROGRAM_ID (reflect), MOCK_PROGRAM_ID,
//! ADMIN_KEYPAIR, OP_KEYPAIRS (comma-separated paths, >=2), OUTSIDER_KEYPAIR,
//! ROUND (default 0), STALENESS_SLOTS (default 150000).

use std::{str::FromStr, thread, time::Duration};

use anyhow::{anyhow, bail, ensure, Result};
use solana_sdk::{
    pubkey::Pubkey,
    signer::{
        keypair::{read_keypair_file, Keypair},
        Signer,
    },
    system_instruction,
};

use rubric::{compute_weights, RubricConfig, VenueInput};
use worker_core::{
    feed_view::{self, AllocationStateView, DataFeedView},
    ix, pda,
    rpc::RpcPool,
    tx,
};

const N_VENUES: usize = 16;
/// The mock value is written at payload offset 0, i.e. account offset 8.
const PRODUCER_OFFSET: u8 = 8;

/// `(pool_id, apy_bps, crr_bps)` for the five exercised venues. The remaining
/// venues (5–15) stay zero. v3 (Jupiter) has CRR > 6000 so the rubric screens it.
const VENUES: [(u8, u64, u64); 5] = [
    (1, 1000, 2000), // v0 Marginfi
    (2, 1200, 4000), // v1 Kamino
    (3, 800, 1000),  // v2 Save
    (4, 1500, 7000), // v3 Jupiter — screened out
    (5, 600, 3000),  // v4 Loopscale
];
const DATA_APY: u8 = 0;
const DATA_CRR: u8 = 2;

const RULE_MEAN: u8 = 0;
const RULE_MEDIAN: u8 = 1;
const STATUS_CLOSED: u8 = 1;

fn happy_cfg() -> ix::DataFeedConfig {
    // Window generous enough that all 20 sample txs land inside one window on devnet.
    ix::DataFeedConfig {
        measurand: 0,
        window_slots: 300,
        threshold_bps: 30,
        min_interval_slots: 0,
        max_interval_slots: 3000,
        min_number: 2,
        rule: RULE_MEDIAN,
        trim_pct: 0,
    }
}

struct FeedDef {
    pool_id: u8,
    data_id: u8,
    venue: usize,
    is_apy: bool,
    value: u64,
    mock_id: u8,
}

fn happy_feeds() -> Vec<FeedDef> {
    let mut out = Vec::new();
    for (v, &(pool, apy, crr)) in VENUES.iter().enumerate() {
        out.push(FeedDef { pool_id: pool, data_id: DATA_APY, venue: v, is_apy: true, value: apy, mock_id: (v as u8) * 2 });
        out.push(FeedDef { pool_id: pool, data_id: DATA_CRR, venue: v, is_apy: false, value: crr, mock_id: (v as u8) * 2 + 1 });
    }
    out
}

// ---- config -------------------------------------------------------------------

struct Cfg {
    pool: RpcPool,
    reflect: Pubkey,
    mock: Pubkey,
    admin: Keypair,
    ops: Vec<Keypair>,
    outsider: Keypair,
    round: u64,
    staleness: u64,
}

fn env(k: &str) -> Result<String> {
    std::env::var(k).map_err(|_| anyhow!("{k} not set"))
}

fn load_kp(path: &str) -> Result<Keypair> {
    read_keypair_file(path).map_err(|e| anyhow!("read keypair {path}: {e}"))
}

impl Cfg {
    fn from_env() -> Result<Self> {
        let rpc_urls: Vec<String> = env("SOLANA_RPC_URL")?
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        ensure!(!rpc_urls.is_empty(), "SOLANA_RPC_URL is empty");
        let reflect = Pubkey::from_str(env("PROGRAM_ID")?.trim())?;
        let mock = Pubkey::from_str(env("MOCK_PROGRAM_ID")?.trim())?;
        let admin = load_kp(&env("ADMIN_KEYPAIR")?)?;
        let op_paths: Vec<String> = env("OP_KEYPAIRS")?
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        ensure!(op_paths.len() >= 2, "need at least 2 OP_KEYPAIRS (got {})", op_paths.len());
        let ops = op_paths.iter().map(|p| load_kp(p)).collect::<Result<Vec<_>>>()?;
        let outsider = load_kp(&env("OUTSIDER_KEYPAIR")?)?;
        let round = std::env::var("ROUND").ok().and_then(|s| s.parse().ok()).unwrap_or(0u64);
        let staleness = std::env::var("STALENESS_SLOTS").ok().and_then(|s| s.parse().ok()).unwrap_or(150_000u64);
        Ok(Self { pool: RpcPool::new(&rpc_urls), reflect, mock, admin, ops, outsider, round, staleness })
    }
}

// ---- low-level account helpers ------------------------------------------------

fn exists(cfg: &Cfg, key: &Pubkey) -> bool {
    cfg.pool.primary().get_account(key).is_ok()
}

fn get_data(cfg: &Cfg, key: &Pubkey) -> Result<Vec<u8>> {
    Ok(cfg.pool.primary().get_account(key)?.data)
}

fn current_slot(cfg: &Cfg) -> Result<u64> {
    cfg.pool.get_slot()
}

fn feed_view_of(cfg: &Cfg, pool_id: u8, data_id: u8) -> Result<DataFeedView> {
    let d = get_data(cfg, &pda::data_feed(&cfg.reflect, pool_id, data_id).0)?;
    DataFeedView::parse(&d)
}

// ---- funding + setup ----------------------------------------------------------

fn airdrop_if_low(cfg: &Cfg, key: &Pubkey, target: u64) -> Result<()> {
    let bal = cfg.pool.primary().get_balance(key).unwrap_or(0);
    if bal >= target {
        return Ok(());
    }
    let want = target - bal;
    tracing::info!("airdropping {want} lamports to {key}");
    match cfg.pool.primary().request_airdrop(key, want) {
        Ok(_) => {
            for _ in 0..30 {
                if cfg.pool.primary().get_balance(key).unwrap_or(0) >= target {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(1000));
            }
            tracing::warn!("airdrop not yet reflected for {key}; continuing");
        }
        Err(e) => tracing::warn!("airdrop failed (devnet faucet rate-limited?): {e}; fund {key} manually"),
    }
    Ok(())
}

fn fund(cfg: &Cfg) -> Result<()> {
    airdrop_if_low(cfg, &cfg.admin.pubkey(), 2_000_000_000)?;
    let mut recips: Vec<Pubkey> = cfg.ops.iter().map(|k| k.pubkey()).collect();
    recips.push(cfg.outsider.pubkey());
    for r in recips {
        let bal = cfg.pool.primary().get_balance(&r).unwrap_or(0);
        if bal < 100_000_000 {
            let i = system_instruction::transfer(&cfg.admin.pubkey(), &r, 200_000_000);
            tx::send_with_retry(cfg.pool.primary(), &cfg.admin, &[i], 3)?;
            tracing::info!("funded {r}");
        }
    }
    Ok(())
}

fn registry_has(data: &[u8], key: &Pubkey) -> bool {
    // OperatorRegistry: disc(8) admin(32) count u16@40 bump _pad operators@44.
    let count = u16::from_le_bytes([data[40], data[41]]) as usize;
    (0..count).any(|i| &data[44 + i * 32..44 + i * 32 + 32] == key.as_ref())
}

fn ensure_registry(cfg: &Cfg) -> Result<()> {
    let p = pda::registry(&cfg.reflect).0;
    if exists(cfg, &p) {
        return Ok(());
    }
    tx::send_with_retry(cfg.pool.primary(), &cfg.admin, &[ix::init_registry(&cfg.reflect, &cfg.admin.pubkey())], 3)?;
    tracing::info!("init_registry");
    Ok(())
}

fn ensure_operators(cfg: &Cfg) -> Result<()> {
    let data = get_data(cfg, &pda::registry(&cfg.reflect).0)?;
    for op in &cfg.ops {
        let k = op.pubkey();
        if registry_has(&data, &k) {
            continue;
        }
        tx::send_with_retry(cfg.pool.primary(), &cfg.admin, &[ix::add_operator(&cfg.reflect, &cfg.admin.pubkey(), &k)], 3)?;
        tracing::info!("add_operator {k}");
    }
    Ok(())
}

fn ensure_alloc_state(cfg: &Cfg) -> Result<()> {
    let p = pda::allocation_state(&cfg.reflect).0;
    if exists(cfg, &p) {
        return Ok(());
    }
    tx::send_with_retry(cfg.pool.primary(), &cfg.admin, &[ix::init_allocation_state(&cfg.reflect, &cfg.admin.pubkey())], 3)?;
    tracing::info!("init_allocation_state");
    Ok(())
}

fn ensure_feed(cfg: &Cfg, pool_id: u8, data_id: u8, c: &ix::DataFeedConfig) -> Result<()> {
    let p = pda::data_feed(&cfg.reflect, pool_id, data_id).0;
    if exists(cfg, &p) {
        return Ok(());
    }
    tx::send_with_retry(
        cfg.pool.primary(),
        &cfg.admin,
        &[ix::init_data_feed(&cfg.reflect, &cfg.admin.pubkey(), pool_id, data_id, c)],
        3,
    )?;
    tracing::info!("init_data_feed ({pool_id},{data_id})");
    Ok(())
}

fn ensure_mock(cfg: &Cfg, id: u8) -> Result<()> {
    let p = pda::mock(&cfg.mock, id).0;
    if exists(cfg, &p) {
        return Ok(());
    }
    tx::send_with_retry(cfg.pool.primary(), &cfg.admin, &[ix::init_mock(&cfg.mock, &cfg.admin.pubkey(), id)], 3)?;
    Ok(())
}

fn write_mock(cfg: &Cfg, id: u8, value: u64) -> Result<()> {
    tx::send_with_retry(
        cfg.pool.primary(),
        &cfg.admin,
        &[ix::write_u64(&cfg.mock, &cfg.admin.pubkey(), id, 0, value)],
        3,
    )?;
    Ok(())
}

fn read_mock_u64(cfg: &Cfg, id: u8) -> Result<u64> {
    let d = get_data(cfg, &pda::mock(&cfg.mock, id).0)?;
    let off = PRODUCER_OFFSET as usize;
    ensure!(d.len() >= off + 8, "mock account too small");
    Ok(u64::from_le_bytes(d[off..off + 8].try_into().unwrap()))
}

fn setup_base(cfg: &Cfg) -> Result<()> {
    fund(cfg)?;
    ensure_registry(cfg)?;
    ensure_operators(cfg)?;
    Ok(())
}

fn cmd_setup(cfg: &Cfg) -> Result<()> {
    setup_base(cfg)?;
    ensure_alloc_state(cfg)?;
    for f in happy_feeds() {
        ensure_feed(cfg, f.pool_id, f.data_id, &happy_cfg())?;
    }
    for f in happy_feeds() {
        ensure_mock(cfg, f.mock_id)?;
        write_mock(cfg, f.mock_id, f.value)?;
    }
    tracing::info!("setup complete");
    Ok(())
}

// ---- slot / window timing -----------------------------------------------------

fn wait_until_slot(cfg: &Cfg, target: u64) -> Result<()> {
    loop {
        let s = current_slot(cfg)?;
        if s >= target {
            return Ok(());
        }
        let remaining = target - s;
        tracing::info!("waiting for slot {target} (now {s})");
        thread::sleep(Duration::from_millis((remaining.min(20) * 450).max(500)));
    }
}

/// Return `(window_index, closes_at_slot)` for a window with at least `headroom`
/// slots remaining, waiting for the next window if the current one is too close
/// to its boundary.
fn wait_open_window(cfg: &Cfg, window_slots: u64, headroom: u64) -> Result<(u64, u64)> {
    loop {
        let s = current_slot(cfg)?;
        let widx = s / window_slots;
        let closes_at = (widx + 1) * window_slots;
        if closes_at.saturating_sub(s) >= headroom {
            return Ok((widx, closes_at));
        }
        wait_until_slot(cfg, closes_at)?;
    }
}

// ---- sampling -----------------------------------------------------------------

/// Submit one sample for `op_idx`: propose if the window's consensus PDA does not
/// yet exist, otherwise corroborate.
fn submit_sample(cfg: &Cfg, op_idx: usize, pool_id: u8, data_id: u8, widx: u64, value: u64) -> Result<()> {
    let feed = pda::data_feed(&cfg.reflect, pool_id, data_id).0;
    let consensus = pda::tick_consensus(&cfg.reflect, &feed, widx).0;
    let op = &cfg.ops[op_idx];
    let slot = current_slot(cfg)?;
    let i = if exists(cfg, &consensus) {
        ix::corroborate_sample(&cfg.reflect, pool_id, data_id, widx, &op.pubkey(), value, slot)
    } else {
        ix::propose_sample(&cfg.reflect, pool_id, data_id, widx, &op.pubkey(), value, slot)
    };
    tx::send_with_retry(cfg.pool.primary(), op, &[i], 3)?;
    Ok(())
}

fn finalize_sample(cfg: &Cfg, pool_id: u8, data_id: u8, widx: u64) -> Result<()> {
    tx::send_with_retry(
        cfg.pool.primary(),
        &cfg.admin,
        &[ix::finalize_sample(&cfg.reflect, pool_id, data_id, widx, &cfg.admin.pubkey())],
        2,
    )?;
    Ok(())
}

/// One full sample round on a feed: ops 0 and 1 submit `value`, then finalize.
fn round_and_finalize(cfg: &Cfg, pool_id: u8, data_id: u8, value: u64) -> Result<()> {
    let window = feed_view_of(cfg, pool_id, data_id)?.window_slots as u64;
    let (widx, closes) = wait_open_window(cfg, window, window / 2)?;
    submit_sample(cfg, 0, pool_id, data_id, widx, value)?;
    submit_sample(cfg, 1, pool_id, data_id, widx, value)?;
    wait_until_slot(cfg, closes + 2)?;
    finalize_sample(cfg, pool_id, data_id, widx)?;
    Ok(())
}

// ---- consumer (rubric) replica ------------------------------------------------

/// Replicates `workers/consumer` exactly: pin one anchor slot, read every feed,
/// build `VenueInput`s, run the rubric. Ground truth for the expected vector.
fn consumer_compute(cfg: &Cfg) -> Result<[u16; N_VENUES]> {
    let anchor = current_slot(cfg)?;
    let mut apy = [0u64; N_VENUES];
    let mut crr = [0u64; N_VENUES];
    let cap = [rubric::MAX_BPS as u16; N_VENUES];
    let mut stale = [false; N_VENUES];
    for f in happy_feeds() {
        let p = pda::data_feed(&cfg.reflect, f.pool_id, f.data_id).0;
        match cfg.pool.get_account_pinned(&p, anchor)? {
            Some(acct) => {
                let view = DataFeedView::parse(&acct.data)?;
                if view.is_stale(anchor, cfg.staleness) {
                    stale[f.venue] = true;
                }
                let val = view.scalar(&acct.data);
                if f.is_apy {
                    apy[f.venue] = val;
                } else {
                    crr[f.venue] = val;
                }
            }
            None => stale[f.venue] = true,
        }
    }
    let venues: Vec<VenueInput> = (0..N_VENUES)
        .map(|v| VenueInput { apy_bps: apy[v], crr_bps: crr[v], cap_bps: cap[v], stale: stale[v] })
        .collect();
    let w = compute_weights(&venues, &RubricConfig::default());
    let mut out = [0u16; N_VENUES];
    for (i, &x) in w.iter().take(N_VENUES).enumerate() {
        out[i] = x;
    }
    Ok(out)
}

// ---- allocation round ---------------------------------------------------------

fn open_round(cfg: &Cfg) -> Result<()> {
    let p = pda::allocation_consensus(&cfg.reflect, cfg.round).0;
    if exists(cfg, &p) {
        tracing::info!("allocation round {} already open", cfg.round);
        return Ok(());
    }
    let closes_at = current_slot(cfg)? + happy_cfg().window_slots as u64;
    tx::send_with_retry(
        cfg.pool.primary(),
        &cfg.admin,
        &[ix::open_allocation_round(&cfg.reflect, &cfg.admin.pubkey(), cfg.round, closes_at, 2, RULE_MEAN, 0)],
        3,
    )?;
    tracing::info!("open_allocation_round {} closes_at {closes_at}", cfg.round);
    Ok(())
}

fn crank_alloc(cfg: &Cfg) -> Result<()> {
    tx::send_with_retry(
        cfg.pool.primary(),
        &cfg.admin,
        &[ix::finalize_allocation(&cfg.reflect, cfg.round, &cfg.admin.pubkey())],
        3,
    )?;
    tracing::info!("finalize_allocation {}", cfg.round);
    Ok(())
}

fn run_allocation(cfg: &Cfg) -> Result<()> {
    open_round(cfg)?;
    for op_idx in 0..2 {
        let w = consumer_compute(cfg)?;
        let i = ix::submit_weights(&cfg.reflect, cfg.round, &cfg.ops[op_idx].pubkey(), &w);
        match tx::send_with_retry(cfg.pool.primary(), &cfg.ops[op_idx], &[i], 3) {
            Ok(sig) => tracing::info!("op{op_idx} submit_weights {:?} sig={sig}", w),
            Err(e) => tracing::warn!("op{op_idx} submit_weights: {e}"),
        }
    }
    // Read the real close slot in case the round pre-existed.
    let cdata = get_data(cfg, &pda::allocation_consensus(&cfg.reflect, cfg.round).0)?;
    let closes_at = u64::from_le_bytes(cdata[16..24].try_into().unwrap());
    wait_until_slot(cfg, closes_at + 2)?;
    crank_alloc(cfg)?;
    Ok(())
}

// ---- happy path ---------------------------------------------------------------

fn cmd_run_happy(cfg: &Cfg) -> Result<()> {
    cmd_setup(cfg)?;
    let feeds = happy_feeds();
    let window = happy_cfg().window_slots as u64;
    let (widx, closes_at) = wait_open_window(cfg, window, window / 2)?;
    tracing::info!("sampling all feeds in window {widx} (closes_at {closes_at})");
    for f in &feeds {
        let v = read_mock_u64(cfg, f.mock_id)?; // exercise the real read path
        submit_sample(cfg, 0, f.pool_id, f.data_id, widx, v)?;
        submit_sample(cfg, 1, f.pool_id, f.data_id, widx, v)?;
    }
    wait_until_slot(cfg, closes_at + 2)?;
    for f in &feeds {
        if let Err(e) = finalize_sample(cfg, f.pool_id, f.data_id, widx) {
            tracing::warn!("finalize ({},{}): {e}", f.pool_id, f.data_id);
        }
    }
    run_allocation(cfg)?;
    cmd_verify(cfg)
}

// ---- verification -------------------------------------------------------------

fn check(failures: &mut usize, cond: bool, msg: impl AsRef<str>) {
    if cond {
        tracing::info!("ok  : {}", msg.as_ref());
    } else {
        tracing::error!("FAIL: {}", msg.as_ref());
        *failures += 1;
    }
}

fn cmd_verify(cfg: &Cfg) -> Result<()> {
    let mut f = 0usize;
    let now = current_slot(cfg)?;

    for fd in happy_feeds() {
        let p = pda::data_feed(&cfg.reflect, fd.pool_id, fd.data_id).0;
        let data = match cfg.pool.primary().get_account(&p) {
            Ok(a) => a.data,
            Err(e) => {
                check(&mut f, false, format!("feed ({},{}) missing: {e}", fd.pool_id, fd.data_id));
                continue;
            }
        };
        let view = DataFeedView::parse(&data)?;
        let scalar = view.scalar(&data);
        check(&mut f, view.tick >= 1, format!("feed ({},{}) tick={} (>=1)", fd.pool_id, fd.data_id, view.tick));
        check(&mut f, scalar == fd.value, format!("feed ({},{}) scalar={scalar} (want {})", fd.pool_id, fd.data_id, fd.value));
        check(&mut f, view.last_finalized_slot > 0, format!("feed ({},{}) last_finalized_slot>0", fd.pool_id, fd.data_id));
        check(&mut f, !view.is_stale(now, cfg.staleness), format!("feed ({},{}) not stale", fd.pool_id, fd.data_id));
    }

    let expected = consumer_compute(cfg)?;
    match cfg.pool.primary().get_account(&pda::allocation_state(&cfg.reflect).0) {
        Ok(a) => {
            let st = AllocationStateView::parse(&a.data)?;
            tracing::info!("allocation weights = {:?} (round {}, slot {})", st.weights, st.round, st.updated_slot);
            check(&mut f, st.weights == expected, format!("weights {:?} == expected {:?}", st.weights, expected));
            let sum: u32 = st.weights.iter().map(|&x| x as u32).sum();
            check(&mut f, sum == 10_000, format!("weight sum={sum} (want 10000)"));
            check(&mut f, st.round == cfg.round, format!("round={} (want {})", st.round, cfg.round));
            check(&mut f, st.updated_slot > 0, "allocation updated_slot>0");
        }
        Err(e) => check(&mut f, false, format!("allocation_state missing: {e}")),
    }

    // Cross-operator determinism: the two consumer submissions are identical.
    if let Ok(a) = cfg.pool.primary().get_account(&pda::allocation_consensus(&cfg.reflect, cfg.round).0) {
        let count = feed_view::alloc_consensus_count(&a.data);
        if count >= 2 {
            let w0 = feed_view::alloc_submission_weights(&a.data, 0);
            let w1 = feed_view::alloc_submission_weights(&a.data, 1);
            check(&mut f, w0 == w1, format!("determinism: submission0 == submission1 ({:?})", w0));
        } else {
            tracing::warn!("determinism: only {count} submission(s) present, skipping");
        }
    }

    if f == 0 {
        tracing::info!("VERIFY PASS");
        Ok(())
    } else {
        bail!("VERIFY FAILED: {f} check(s)");
    }
}

// ---- invariant matrix ---------------------------------------------------------

const INV_DATA: u8 = 0;

fn warn_if_not_fresh(cfg: &Cfg, pool_id: u8, label: &str) {
    if let Ok(v) = feed_view_of(cfg, pool_id, INV_DATA) {
        if v.tick != 0 {
            tracing::warn!("[{label}] feed pool {pool_id} already has tick={} — results may be stale; redeploy or use fresh pool ids", v.tick);
        }
    }
}

fn inv_quorum(cfg: &Cfg) -> Result<usize> {
    let mut f = 0;
    let (pool, data) = (10u8, INV_DATA);
    let c = ix::DataFeedConfig { measurand: 0, window_slots: 60, threshold_bps: 30, min_interval_slots: 0, max_interval_slots: 100_000, min_number: 3, rule: RULE_MEDIAN, trim_pct: 0 };
    ensure_feed(cfg, pool, data, &c)?;
    warn_if_not_fresh(cfg, pool, "quorum");
    let before = feed_view_of(cfg, pool, data)?;
    let (widx, closes) = wait_open_window(cfg, 60, 30)?;
    submit_sample(cfg, 0, pool, data, widx, 1234)?;
    submit_sample(cfg, 1, pool, data, widx, 1234)?; // 2 < min_number 3
    wait_until_slot(cfg, closes + 2)?;
    finalize_sample(cfg, pool, data, widx)?;
    let after = feed_view_of(cfg, pool, data)?;
    check(&mut f, after.tick == before.tick, format!("[quorum] tick {} -> {} (unchanged)", before.tick, after.tick));
    let cdata = get_data(cfg, &pda::tick_consensus(&cfg.reflect, &pda::data_feed(&cfg.reflect, pool, data).0, widx).0)?;
    check(&mut f, feed_view::sample_consensus_status(&cdata) == STATUS_CLOSED, "[quorum] consensus CLOSED");
    Ok(f)
}

fn inv_brake(cfg: &Cfg) -> Result<usize> {
    let mut f = 0;
    let (pool, data) = (11u8, INV_DATA);
    let c = ix::DataFeedConfig { measurand: 0, window_slots: 60, threshold_bps: 30, min_interval_slots: 1000, max_interval_slots: 1_000_000, min_number: 2, rule: RULE_MEDIAN, trim_pct: 0 };
    ensure_feed(cfg, pool, data, &c)?;
    warn_if_not_fresh(cfg, pool, "brake");
    round_and_finalize(cfg, pool, data, 1000)?; // first finalize advances
    let a = feed_view_of(cfg, pool, data)?;
    round_and_finalize(cfg, pool, data, 5000)?; // divergent, but braked (min_interval not elapsed)
    let b = feed_view_of(cfg, pool, data)?;
    check(&mut f, b.tick == a.tick, format!("[brake] tick {} -> {} (braked, unchanged)", a.tick, b.tick));
    check(&mut f, b.last_finalized_slot == a.last_finalized_slot, "[brake] last_finalized_slot unchanged");
    Ok(f)
}

fn inv_notrig(cfg: &Cfg) -> Result<usize> {
    let mut f = 0;
    let (pool, data) = (12u8, INV_DATA);
    let c = ix::DataFeedConfig { measurand: 0, window_slots: 60, threshold_bps: 500, min_interval_slots: 0, max_interval_slots: 1_000_000, min_number: 2, rule: RULE_MEDIAN, trim_pct: 0 };
    ensure_feed(cfg, pool, data, &c)?;
    warn_if_not_fresh(cfg, pool, "no-trigger");
    round_and_finalize(cfg, pool, data, 10_000)?; // first → last_value 10000
    let a = feed_view_of(cfg, pool, data)?;
    round_and_finalize(cfg, pool, data, 10_200)?; // divergence 200bps < 500, idle < max → no trigger
    let b = feed_view_of(cfg, pool, data)?;
    check(&mut f, b.tick == a.tick, format!("[no-trigger] tick {} -> {} (unchanged)", a.tick, b.tick));
    check(&mut f, b.last_value == a.last_value, format!("[no-trigger] last_value {} unchanged", a.last_value));
    Ok(f)
}

fn inv_force(cfg: &Cfg) -> Result<usize> {
    let mut f = 0;
    let (pool, data) = (13u8, INV_DATA);
    let c = ix::DataFeedConfig { measurand: 0, window_slots: 60, threshold_bps: 60_000, min_interval_slots: 0, max_interval_slots: 30, min_number: 2, rule: RULE_MEDIAN, trim_pct: 0 };
    ensure_feed(cfg, pool, data, &c)?;
    warn_if_not_fresh(cfg, pool, "forced-refresh");
    round_and_finalize(cfg, pool, data, 5000)?; // first → tick 1
    let a = feed_view_of(cfg, pool, data)?;
    round_and_finalize(cfg, pool, data, 5000)?; // same value; idle (~window) >= max_interval 30 → forced
    let b = feed_view_of(cfg, pool, data)?;
    check(&mut f, b.tick == a.tick + 1, format!("[forced-refresh] tick {} -> {} (advanced on idle)", a.tick, b.tick));
    check(&mut f, b.last_value == 5000, "[forced-refresh] last_value still 5000");
    Ok(f)
}

fn inv_unauth(cfg: &Cfg) -> Result<usize> {
    let mut f = 0;
    let (pool, data) = (14u8, INV_DATA);
    let c = ix::DataFeedConfig { measurand: 0, window_slots: 120, threshold_bps: 30, min_interval_slots: 0, max_interval_slots: 100_000, min_number: 2, rule: RULE_MEDIAN, trim_pct: 0 };
    ensure_feed(cfg, pool, data, &c)?;
    let window = feed_view_of(cfg, pool, data)?.window_slots as u64;
    let (widx, _) = wait_open_window(cfg, window, window / 2)?;
    let feed = pda::data_feed(&cfg.reflect, pool, data).0;
    let consensus = pda::tick_consensus(&cfg.reflect, &feed, widx).0;
    let slot = current_slot(cfg)?;
    let i = ix::propose_sample(&cfg.reflect, pool, data, widx, &cfg.outsider.pubkey(), 1234, slot);
    let res = tx::send_with_retry(cfg.pool.primary(), &cfg.outsider, &[i], 1);
    check(&mut f, res.is_err(), format!("[unauth] outsider propose rejected (ok={})", res.is_ok()));
    check(&mut f, !exists(cfg, &consensus), "[unauth] consensus PDA not created");
    Ok(f)
}

fn cmd_run_invariants(cfg: &Cfg) -> Result<()> {
    setup_base(cfg)?;
    let mut total = 0;
    total += inv_quorum(cfg)?;
    total += inv_brake(cfg)?;
    total += inv_notrig(cfg)?;
    total += inv_force(cfg)?;
    total += inv_unauth(cfg)?;
    if total == 0 {
        tracing::info!("INVARIANTS PASS");
        Ok(())
    } else {
        bail!("INVARIANTS FAILED: {total} check(s)");
    }
}

// ---- arg parsing + main -------------------------------------------------------

fn parse_arg<T: FromStr>(args: &[String], i: usize) -> Result<T>
where
    <T as FromStr>::Err: std::fmt::Display,
{
    let s = args.get(i).ok_or_else(|| anyhow!("missing arg #{i}"))?;
    s.parse::<T>().map_err(|e| anyhow!("bad arg #{i} '{s}': {e}"))
}

fn usage() {
    eprintln!(
        "usage: e2e <command>\n  \
         setup | run-happy | run-invariants | verify | open-round | crank-alloc\n  \
         sample <op_idx> <pool> <data> <value>\n  \
         crank-sample <pool> <data> <window>"
    );
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    let cfg = Cfg::from_env()?;
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("") {
        "setup" => cmd_setup(&cfg),
        "run-happy" => cmd_run_happy(&cfg),
        "run-invariants" => cmd_run_invariants(&cfg),
        "verify" => cmd_verify(&cfg),
        "open-round" => open_round(&cfg),
        "crank-alloc" => crank_alloc(&cfg),
        "sample" => {
            let op: usize = parse_arg(&args, 2)?;
            let pool: u8 = parse_arg(&args, 3)?;
            let data: u8 = parse_arg(&args, 4)?;
            let value: u64 = parse_arg(&args, 5)?;
            let window = feed_view_of(&cfg, pool, data)?.window_slots as u64;
            let (widx, _) = wait_open_window(&cfg, window, 5)?;
            submit_sample(&cfg, op, pool, data, widx, value)
        }
        "crank-sample" => {
            let pool: u8 = parse_arg(&args, 2)?;
            let data: u8 = parse_arg(&args, 3)?;
            let widx: u64 = parse_arg(&args, 4)?;
            finalize_sample(&cfg, pool, data, widx)
        }
        // stdout helpers consumed by scripts/devnet/run_e2e.sh
        "print-feeds" => {
            // one line per feed: pool data mock_id mock_pda venue role
            for f in happy_feeds() {
                let mock_pda = pda::mock(&cfg.mock, f.mock_id).0;
                println!(
                    "{} {} {} {} {} {}",
                    f.pool_id, f.data_id, f.mock_id, mock_pda, f.venue, if f.is_apy { "apy" } else { "crr" }
                );
            }
            Ok(())
        }
        "consumer-feeds" => {
            // the FEEDS JSON the consumer daemon expects
            let items: Vec<String> = happy_feeds()
                .iter()
                .map(|f| {
                    format!(
                        "{{\"pool_id\":{},\"data_id\":{},\"venue\":{},\"role\":\"{}\"}}",
                        f.pool_id, f.data_id, f.venue, if f.is_apy { "apy" } else { "crr" }
                    )
                })
                .collect();
            println!("[{}]", items.join(","));
            Ok(())
        }
        other => {
            if !other.is_empty() {
                eprintln!("unknown command: {other}");
            }
            usage();
            bail!("no command");
        }
    }
}

use anchor_lang::prelude::*;

use crate::aggregation;
use crate::constants::*;
use crate::error::ReflectError;
use crate::state::{DataFeed, DataFeedConsensus, OperatorRegistry};

// ---- propose_sample -----------------------------------------------------------
// Opens the consensus round for the current window and records the first vote.
// (An operator races to `propose`; if the account already exists they fall back
// to `corroborate`.)

#[derive(Accounts)]
#[instruction(window_index: u64)]
pub struct ProposeSample<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    pub data_feed: AccountLoader<'info, DataFeed>,
    #[account(
        init,
        payer = operator,
        space = 8 + DataFeedConsensus::LEN,
        seeds = [TICK_CONSENSUS_SEED, data_feed.key().as_ref(), &window_index.to_le_bytes()],
        bump
    )]
    pub consensus: AccountLoader<'info, DataFeedConsensus>,
    #[account(mut)]
    pub operator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn propose_sample(
    ctx: Context<ProposeSample>,
    window_index: u64,
    value: u64,
    slot_at_read: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        ctx.accounts
            .registry
            .load()?
            .is_operator(&ctx.accounts.operator.key()),
        ReflectError::UnauthorizedOperator
    );

    let (window_slots, min_number, rule, trim_pct) = {
        let df = ctx.accounts.data_feed.load()?;
        (df.window_slots as u64, df.min_number, df.rule, df.trim_pct)
    };
    require!(window_slots > 0, ReflectError::InvalidConfig);

    let (opens_at, closes_at) = window_bounds(window_index, window_slots)?;
    // The opener can only open the window that the chain is currently in.
    require!(
        window_index == clock.slot / window_slots,
        ReflectError::WindowClosed
    );
    require!(
        slot_at_read >= opens_at && slot_at_read < closes_at && slot_at_read <= clock.slot,
        ReflectError::SlotOutsideWindow
    );

    let mut c = ctx.accounts.consensus.load_init()?;
    c.window_index = window_index;
    c.closes_at_slot = closes_at;
    c.output = 0;
    c.data_feed = ctx.accounts.data_feed.key();
    c.status = state_flags::OPEN;
    c.min_number = min_number;
    c.rule = rule;
    c.trim_pct = trim_pct;
    c.count = 0;
    c.bump = ctx.bumps.consensus;
    c.add_submission(ctx.accounts.operator.key(), value)
}

// ---- corroborate_sample -------------------------------------------------------

#[derive(Accounts)]
#[instruction(window_index: u64)]
pub struct CorroborateSample<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    pub data_feed: AccountLoader<'info, DataFeed>,
    #[account(
        mut,
        seeds = [TICK_CONSENSUS_SEED, data_feed.key().as_ref(), &window_index.to_le_bytes()],
        bump
    )]
    pub consensus: AccountLoader<'info, DataFeedConsensus>,
    pub operator: Signer<'info>,
}

pub fn corroborate_sample(
    ctx: Context<CorroborateSample>,
    window_index: u64,
    value: u64,
    slot_at_read: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        ctx.accounts
            .registry
            .load()?
            .is_operator(&ctx.accounts.operator.key()),
        ReflectError::UnauthorizedOperator
    );
    let window_slots = ctx.accounts.data_feed.load()?.window_slots as u64;
    require!(window_slots > 0, ReflectError::InvalidConfig);

    let mut c = ctx.accounts.consensus.load_mut()?;
    require!(
        c.data_feed == ctx.accounts.data_feed.key() && c.window_index == window_index,
        ReflectError::IdentityMismatch
    );
    require!(clock.slot < c.closes_at_slot, ReflectError::WindowClosed);

    // Derive the original window width from the round, not mutable feed config.
    let original_width = c.closes_at_slot
        / c.window_index
            .checked_add(1)
            .ok_or(ReflectError::MathOverflow)?;
    let opens_at = c.closes_at_slot - original_width;
    require!(
        slot_at_read >= opens_at && slot_at_read < c.closes_at_slot && slot_at_read <= clock.slot,
        ReflectError::SlotOutsideWindow
    );

    c.add_submission(ctx.accounts.operator.key(), value)
}

// ---- finalize_sample ----------------------------------------------------------
// Anyone may crank. Aggregates the round, applies brakes/triggers, and (only if a
// trigger fired and quorum was met) appends one Sample to the ring.

#[derive(Accounts)]
#[instruction(window_index: u64)]
pub struct FinalizeSample<'info> {
    #[account(mut)]
    pub data_feed: AccountLoader<'info, DataFeed>,
    #[account(
        mut,
        seeds = [TICK_CONSENSUS_SEED, data_feed.key().as_ref(), &window_index.to_le_bytes()],
        bump
    )]
    pub consensus: AccountLoader<'info, DataFeedConsensus>,
    pub cranker: Signer<'info>,
}

/// Outcome of a finalize attempt, surfaced to clients via the return log.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum FinalizeOutcome {
    Advanced,
    QuorumNotMet,
    Brake,
    NoTrigger,
}

pub fn finalize_sample(ctx: Context<FinalizeSample>, window_index: u64) -> Result<()> {
    let clock = Clock::get()?;
    let mut c = ctx.accounts.consensus.load_mut()?;

    require!(
        c.status == state_flags::OPEN,
        ReflectError::AlreadyFinalized
    );
    require!(
        c.data_feed == ctx.accounts.data_feed.key() && c.window_index == window_index,
        ReflectError::IdentityMismatch
    );
    require!(
        clock.slot >= c.closes_at_slot,
        ReflectError::WindowStillOpen
    );

    // Quorum: too few votes -> round ends without advancing the ring.
    if (c.count as usize) < (c.min_number as usize) {
        c.status = state_flags::CLOSED;
        msg!("finalize: {:?}", FinalizeOutcome::QuorumNotMet);
        return Ok(());
    }

    // Aggregate the votes.
    let n = c.count as usize;
    let mut buf = [0u64; MAX_SUBMISSIONS];
    for (i, s) in c.submissions[..n].iter().enumerate() {
        buf[i] = s.value;
    }
    let agg = aggregation::aggregate_scalar(&mut buf[..n], c.rule, c.trim_pct);

    let mut df = ctx.accounts.data_feed.load_mut()?;
    require!(
        c.closes_at_slot > df.last_finalized_slot,
        ReflectError::StaleRound
    );
    let first = df.last_finalized_slot == 0 && df.tick == 0;

    // Brake: min_interval_slots since the last finalize must have elapsed.
    if !first {
        let elapsed = c.closes_at_slot.saturating_sub(df.last_finalized_slot);
        if elapsed < df.min_interval_slots as u64 {
            c.status = state_flags::CLOSED;
            msg!("finalize: {:?}", FinalizeOutcome::Brake);
            return Ok(());
        }
    }

    // Trigger: forced refresh (max_interval) OR ratio divergence.
    let idle = c.closes_at_slot.saturating_sub(df.last_finalized_slot);
    let advance = first
        || idle >= df.max_interval_slots as u64
        || aggregation::divergence_bps(agg, df.last_value) >= df.threshold_bps as u64;
    if !advance {
        c.status = state_flags::CLOSED;
        msg!("finalize: {:?}", FinalizeOutcome::NoTrigger);
        return Ok(());
    }

    // Append one Sample to the ring.
    let head = df.head as usize;
    let new_tick = df.tick.checked_add(1).ok_or(ReflectError::MathOverflow)?;
    df.ring[head].value = agg;
    df.ring[head].slot = c.closes_at_slot;
    df.ring[head].tick = new_tick;
    df.ring[head].ts = clock.unix_timestamp;
    df.head = ((head + 1) % RING_LEN) as u16;
    df.tick = new_tick;
    df.last_finalized_slot = c.closes_at_slot;
    df.last_value = agg;

    c.output = agg;
    c.status = state_flags::FINALIZED;
    msg!("finalize: {:?}", FinalizeOutcome::Advanced);
    Ok(())
}

/// `[opens_at, closes_at)` for a window index, with overflow checks.
fn window_bounds(window_index: u64, window_slots: u64) -> Result<(u64, u64)> {
    let opens_at = window_index
        .checked_mul(window_slots)
        .ok_or(ReflectError::MathOverflow)?;
    let closes_at = opens_at
        .checked_add(window_slots)
        .ok_or(ReflectError::MathOverflow)?;
    Ok((opens_at, closes_at))
}

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReflectError;
use crate::state::{AllocationConsensus, AllocationState, OperatorRegistry};

// ---- init_allocation_state ----------------------------------------------------

#[derive(Accounts)]
pub struct InitAllocationState<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(
        init,
        payer = admin,
        space = 8 + AllocationState::INIT_SPACE,
        seeds = [ALLOCATION_STATE_SEED],
        bump
    )]
    pub allocation_state: Account<'info, AllocationState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn init_allocation_state(ctx: Context<InitAllocationState>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        ReflectError::Unauthorized
    );
    let st = &mut ctx.accounts.allocation_state;
    st.round = 0;
    st.updated_slot = 0;
    st.weights = [0u16; N_VENUES];
    st.bump = ctx.bumps.allocation_state;
    Ok(())
}

// ---- open_allocation_round ----------------------------------------------------

#[derive(Accounts)]
#[instruction(round: u64)]
pub struct OpenAllocationRound<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(
        init,
        payer = admin,
        space = 8 + AllocationConsensus::LEN,
        seeds = [ALLOCATION_CONSENSUS_SEED, &round.to_le_bytes()],
        bump
    )]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn open_allocation_round(
    ctx: Context<OpenAllocationRound>,
    round: u64,
    closes_at_slot: u64,
    min_number: u8,
    rule: u8,
    trim_pct: u8,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        ReflectError::Unauthorized
    );
    require!(
        (min_number as usize) <= MAX_SUBMISSIONS,
        ReflectError::InvalidQuorum
    );
    require!(rule <= rule_flags::TRIMMED_MEAN, ReflectError::InvalidRule);
    require!(trim_pct < 50, ReflectError::InvalidConfig);

    let mut c = ctx.accounts.consensus.load_init()?;
    c.round = round;
    c.closes_at_slot = closes_at_slot;
    c.status = state_flags::OPEN;
    c.min_number = min_number;
    c.rule = rule;
    c.trim_pct = trim_pct;
    c.count = 0;
    c.bump = ctx.bumps.consensus;
    c.output = [0u16; N_VENUES];
    Ok(())
}

// ---- submit_weights -----------------------------------------------------------

#[derive(Accounts)]
#[instruction(round: u64)]
pub struct SubmitWeights<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(
        mut,
        seeds = [ALLOCATION_CONSENSUS_SEED, &round.to_le_bytes()],
        bump
    )]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    pub operator: Signer<'info>,
}

pub fn submit_weights(
    ctx: Context<SubmitWeights>,
    _round: u64,
    weights: [u16; N_VENUES],
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        ctx.accounts
            .registry
            .load()?
            .is_operator(&ctx.accounts.operator.key()),
        ReflectError::UnauthorizedOperator
    );
    let mut c = ctx.accounts.consensus.load_mut()?;
    require!(clock.slot < c.closes_at_slot, ReflectError::WindowClosed);
    c.add_submission(ctx.accounts.operator.key(), weights)
}

// ---- finalize_allocation ------------------------------------------------------

#[derive(Accounts)]
#[instruction(round: u64)]
pub struct FinalizeAllocation<'info> {
    #[account(
        mut,
        seeds = [ALLOCATION_CONSENSUS_SEED, &round.to_le_bytes()],
        bump
    )]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    #[account(
        mut,
        seeds = [ALLOCATION_STATE_SEED],
        bump = allocation_state.bump
    )]
    pub allocation_state: Account<'info, AllocationState>,
    pub cranker: Signer<'info>,
}

pub fn finalize_allocation(
    ctx: Context<FinalizeAllocation>,
    _round: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let mut c = ctx.accounts.consensus.load_mut()?;
    require!(c.status == state_flags::OPEN, ReflectError::AlreadyFinalized);
    require!(
        clock.slot >= c.closes_at_slot,
        ReflectError::WindowStillOpen
    );

    if (c.count as usize) < (c.min_number as usize) {
        c.status = state_flags::CLOSED;
        msg!("finalize_allocation: quorum not met");
        return Ok(());
    }

    let out = c.aggregate();
    require!(
        crate::aggregation::valid_ratios(&out),
        ReflectError::InvalidRatios
    );
    c.output = out;
    c.status = state_flags::FINALIZED;

    let st = &mut ctx.accounts.allocation_state;
    st.round = c.round;
    st.updated_slot = clock.slot;
    st.weights = out;
    Ok(())
}

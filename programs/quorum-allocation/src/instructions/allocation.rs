use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::QuorumError;
use crate::state::{AllocationConsensus, AllocationState, OperatorRegistry};

/// Reclaim completed allocation-round rent to its original registry admin.
#[derive(Accounts)]
#[instruction(round: u64)]
pub struct CloseAllocationConsensus<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(mut, close = admin, seeds = [ALLOCATION_CONSENSUS_SEED, &round.to_le_bytes()], bump)]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

pub fn close_allocation_consensus(
    ctx: Context<CloseAllocationConsensus>,
    _round: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        QuorumError::Unauthorized
    );
    let c = ctx.accounts.consensus.load()?;
    require!(c.status != state_flags::OPEN, QuorumError::RoundNotOpen);
    require!(
        Clock::get()?.slot >= c.closes_at_slot,
        QuorumError::WindowStillOpen
    );
    Ok(())
}

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
        QuorumError::Unauthorized
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

/// Legacy unbound rounds are disabled after the policy/snapshot upgrade.
pub fn open_allocation_round(
    _ctx: Context<OpenAllocationRound>,
    _round: u64,
    _closes_at_slot: u64,
    _min_number: u8,
    _rule: u8,
    _trim_pct: u8,
) -> Result<()> {
    err!(QuorumError::LegacyAllocationDisabled)
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
    _ctx: Context<SubmitWeights>,
    _round: u64,
    _weights: [u16; N_VENUES],
) -> Result<()> {
    err!(QuorumError::LegacyAllocationDisabled)
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

/// Expired legacy accounts can still terminate and return rent; they cannot publish.
pub fn finalize_allocation(ctx: Context<FinalizeAllocation>, _round: u64) -> Result<()> {
    let mut c = ctx.accounts.consensus.load_mut()?;
    require!(
        Clock::get()?.slot >= c.closes_at_slot,
        QuorumError::WindowStillOpen
    );
    require!(c.status == state_flags::OPEN, QuorumError::AlreadyFinalized);
    require!(c._pad[0] != 2, QuorumError::LegacyAllocationDisabled);
    c.status = state_flags::CLOSED;
    msg!("finalize_allocation: legacy round retired; use snapshot-bound v2 instructions");
    Ok(())
}

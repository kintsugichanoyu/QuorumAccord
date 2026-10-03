use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReflectError;
use crate::state::OperatorRegistry;

#[derive(Accounts)]
pub struct InitRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + OperatorRegistry::LEN,
        seeds = [REGISTRY_SEED],
        bump
    )]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ReflectError::Unauthorized)]
    pub program: Program<'info, crate::program::ReflectAllocation>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ ReflectError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
}

pub fn init_registry(ctx: Context<InitRegistry>) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_init()?;
    registry.admin = ctx.accounts.admin.key();
    registry.count = 0;
    registry.bump = ctx.bumps.registry;
    Ok(())
}

#[derive(Accounts)]
pub struct MutateOperators<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    pub admin: Signer<'info>,
}

pub fn add_operator(ctx: Context<MutateOperators>, operator: Pubkey) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_mut()?;
    require_keys_eq!(
        registry.admin,
        ctx.accounts.admin.key(),
        ReflectError::Unauthorized
    );
    registry.add(operator)
}

pub fn remove_operator(ctx: Context<MutateOperators>, operator: Pubkey) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_mut()?;
    require_keys_eq!(
        registry.admin,
        ctx.accounts.admin.key(),
        ReflectError::Unauthorized
    );
    registry.remove(&operator)
}

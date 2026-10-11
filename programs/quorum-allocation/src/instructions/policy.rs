use crate::{constants::*, error::QuorumError, state::*};
use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

#[derive(Accounts)]
pub struct InitAllocationPolicy<'info> {
    #[account(seeds=[REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(init, payer=admin, space=8+AllocationPolicy::INIT_SPACE, seeds=[POLICY_SEED], bump)]
    pub policy: Box<Account<'info, AllocationPolicy>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}
pub fn init_allocation_policy(
    ctx: Context<InitAllocationPolicy>,
    config: PolicyConfig,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        QuorumError::Unauthorized
    );
    config.validate()?;
    ctx.accounts.policy.version = 1;
    ctx.accounts.policy.active_round = 0;
    ctx.accounts.policy.published_round = 0;
    ctx.accounts.policy.config = config;
    ctx.accounts.policy.bump = ctx.bumps.policy;
    Ok(())
}
#[derive(Accounts)]
pub struct UpdateAllocationPolicy<'info> {
    #[account(seeds=[REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(mut, seeds=[POLICY_SEED], bump=policy.bump)]
    pub policy: Box<Account<'info, AllocationPolicy>>,
    pub admin: Signer<'info>,
}
pub fn update_allocation_policy(
    ctx: Context<UpdateAllocationPolicy>,
    config: PolicyConfig,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        QuorumError::Unauthorized
    );
    config.validate()?;
    ctx.accounts.policy.version = ctx
        .accounts
        .policy
        .version
        .checked_add(1)
        .ok_or(QuorumError::MathOverflow)?;
    ctx.accounts.policy.config = config;
    Ok(())
}
#[derive(Accounts)]
#[instruction(round:u64)]
pub struct OpenAllocationRoundV2<'info> {
    #[account(seeds=[REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(mut, seeds=[POLICY_SEED], bump=policy.bump)]
    pub policy: Box<Account<'info, AllocationPolicy>>,
    #[account(init,payer=admin,space=8+AllocationConsensus::LEN,seeds=[ALLOCATION_CONSENSUS_SEED,&round.to_le_bytes()],bump)]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    #[account(init,payer=admin,space=8+RoundContext::INIT_SPACE,seeds=[ROUND_CONTEXT_SEED,&round.to_le_bytes()],bump)]
    pub round_context: Box<Account<'info, RoundContext>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}
pub fn open_allocation_round_v2(
    ctx: Context<OpenAllocationRoundV2>,
    round: u64,
    closes_at_slot: u64,
    rule: u8,
    trim_pct: u8,
) -> Result<()> {
    let registry = ctx.accounts.registry.load()?;
    require_keys_eq!(
        registry.admin,
        ctx.accounts.admin.key(),
        QuorumError::Unauthorized
    );
    let clock = Clock::get()?;
    let policy = &mut ctx.accounts.policy;
    require!(
        round > policy.active_round
            && closes_at_slot > clock.slot
            && closes_at_slot - clock.slot <= policy.config.max_round_slots as u64,
        QuorumError::InvalidConfig
    );
    require!(
        rule <= rule_flags::TRIMMED_MEAN && trim_pct < 50,
        QuorumError::InvalidRule
    );
    require!(
        policy
            .config
            .consumers
            .iter()
            .all(|key| registry.is_operator(key)),
        QuorumError::UnauthorizedConsumer
    );
    let snapshot = &mut ctx.accounts.round_context;
    snapshot.round = round;
    snapshot.anchor_slot = clock.slot;
    snapshot.policy_version = policy.version;
    snapshot.config = policy.config.clone();
    snapshot.bump = ctx.bumps.round_context;
    snapshot.outcome = 0;
    snapshot.input_hash = [0; 32];
    let mut position = 0;
    for i in 0..N_VENUES {
        snapshot.values[i] = 0;
        snapshot.ticks[i] = 0;
        snapshot.sample_slots[i] = 0;
        snapshot.eligible[i] = 0;
        let expected = policy.config.feeds[i];
        if expected == Pubkey::default() {
            continue;
        }
        let info = ctx
            .remaining_accounts
            .get(position)
            .ok_or(QuorumError::IdentityMismatch)?;
        position += 1;
        require_keys_eq!(*info.key, expected, QuorumError::IdentityMismatch);
        require_keys_eq!(*info.owner, crate::ID, QuorumError::IdentityMismatch);
        let data = info.try_borrow_data()?;
        require!(
            data.len() == 8 + DataFeed::LEN && &data[..8] == DataFeed::DISCRIMINATOR,
            QuorumError::IdentityMismatch
        );
        let feed = bytemuck::try_from_bytes::<DataFeed>(&data[8..])
            .map_err(|_| QuorumError::IdentityMismatch)?;
        let canonical = Pubkey::find_program_address(
            &[DATA_FEED_SEED, &[feed.pool_id], &[feed.data_id]],
            &crate::ID,
        )
        .0;
        require_keys_eq!(canonical, expected, QuorumError::IdentityMismatch);
        require!(
            feed.last_finalized_slot <= clock.slot,
            QuorumError::InvalidConfig
        );
        snapshot.values[i] = feed.scalar();
        snapshot.ticks[i] = feed.tick;
        snapshot.sample_slots[i] = feed.last_finalized_slot;
        snapshot.eligible[i] = u8::from(
            feed.tick > 0
                && clock.slot - feed.last_finalized_slot <= policy.config.max_stale_slots[i] as u64
                && policy.config.risk_bps[i] < policy.config.risk_screen_bps,
        );
    }
    require!(
        ctx.remaining_accounts.len() == position,
        QuorumError::IdentityMismatch
    );
    let mut encoded = Vec::new();
    snapshot.try_serialize(&mut encoded)?;
    snapshot.input_hash = solana_sha256_hasher::hashv(&[&encoded]).to_bytes();
    let mut c = ctx.accounts.consensus.load_init()?;
    c.round = round;
    c.closes_at_slot = closes_at_slot;
    c.min_number = policy.config.min_consumers;
    c.rule = rule;
    c.trim_pct = trim_pct;
    c.status = state_flags::OPEN;
    c.count = 0;
    c.bump = ctx.bumps.consensus;
    c.output = [0; N_VENUES];
    c._pad = [2, 0];
    policy.active_round = round;
    Ok(())
}
#[derive(Accounts)]
#[instruction(round:u64)]
pub struct SubmitWeightsV2<'info> {
    #[account(seeds=[REGISTRY_SEED],bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(mut,seeds=[ALLOCATION_CONSENSUS_SEED,&round.to_le_bytes()],bump)]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    #[account(seeds=[ROUND_CONTEXT_SEED,&round.to_le_bytes()],bump=round_context.bump)]
    pub round_context: Box<Account<'info, RoundContext>>,
    pub operator: Signer<'info>,
}
pub fn submit_weights_v2(
    ctx: Context<SubmitWeightsV2>,
    _round: u64,
    weights: [u16; N_VENUES],
    input_hash: [u8; 32],
) -> Result<()> {
    let snapshot = &ctx.accounts.round_context;
    require!(
        ctx.accounts
            .registry
            .load()?
            .is_operator(&ctx.accounts.operator.key()),
        QuorumError::UnauthorizedOperator
    );
    require!(
        snapshot
            .config
            .consumers
            .contains(&ctx.accounts.operator.key()),
        QuorumError::UnauthorizedConsumer
    );
    require!(
        snapshot.input_hash == input_hash,
        QuorumError::SnapshotMismatch
    );
    require!(
        snapshot.config.valid_weights(&weights, &snapshot.eligible),
        QuorumError::InvalidAllocationPolicy
    );
    let mut c = ctx.accounts.consensus.load_mut()?;
    require!(
        Clock::get()?.slot < c.closes_at_slot,
        QuorumError::WindowClosed
    );
    c.add_submission(ctx.accounts.operator.key(), weights)
}
#[derive(Accounts)]
#[instruction(round:u64)]
pub struct FinalizeAllocationV2<'info> {
    #[account(mut,seeds=[POLICY_SEED],bump=policy.bump)]
    pub policy: Box<Account<'info, AllocationPolicy>>,
    #[account(mut,seeds=[ALLOCATION_CONSENSUS_SEED,&round.to_le_bytes()],bump)]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    #[account(mut,seeds=[ROUND_CONTEXT_SEED,&round.to_le_bytes()],bump=round_context.bump)]
    pub round_context: Box<Account<'info, RoundContext>>,
    #[account(mut,seeds=[ALLOCATION_STATE_SEED],bump=allocation_state.bump)]
    pub allocation_state: Account<'info, AllocationState>,
    pub cranker: Signer<'info>,
}
pub fn finalize_allocation_v2(ctx: Context<FinalizeAllocationV2>, _round: u64) -> Result<()> {
    let clock = Clock::get()?;
    let mut c = ctx.accounts.consensus.load_mut()?;
    let snapshot = &mut ctx.accounts.round_context;
    require!(c.status == state_flags::OPEN, QuorumError::AlreadyFinalized);
    require!(clock.slot >= c.closes_at_slot, QuorumError::WindowStillOpen);
    // Every expired non-publishing result is terminal and reclaimable.
    c.status = state_flags::CLOSED;
    if ctx.accounts.allocation_state.updated_slot != 0
        && c.round <= ctx.accounts.allocation_state.round
    {
        snapshot.outcome = 3;
        return Ok(());
    }
    if c.count < c.min_number {
        snapshot.outcome = 2;
        return Ok(());
    }
    if clock.slot.saturating_sub(snapshot.anchor_slot) > snapshot.config.max_round_slots as u64 {
        snapshot.outcome = 6;
        return Ok(());
    }
    let raw = c.aggregate_raw();
    if raw.iter().all(|x| *x == 0) {
        snapshot.outcome = 5;
        return Ok(());
    }
    let Some(out) = constrained_allocation(raw, &snapshot.config, &snapshot.eligible) else {
        snapshot.outcome = 4;
        return Ok(());
    };
    require!(
        snapshot.config.valid_weights(&out, &snapshot.eligible),
        QuorumError::InvalidAllocationPolicy
    );
    c.output = out;
    c.status = state_flags::FINALIZED;
    snapshot.outcome = 1;
    let st = &mut ctx.accounts.allocation_state;
    st.round = c.round;
    st.updated_slot = clock.slot;
    st.weights = out;
    ctx.accounts.policy.published_round = c.round;
    Ok(())
}
#[derive(Accounts)]
#[instruction(round:u64)]
pub struct CloseAllocationRoundV2<'info> {
    #[account(seeds=[REGISTRY_SEED],bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(seeds=[POLICY_SEED],bump=policy.bump)]
    pub policy: Box<Account<'info, AllocationPolicy>>,
    #[account(mut,close=admin,seeds=[ALLOCATION_CONSENSUS_SEED,&round.to_le_bytes()],bump)]
    pub consensus: AccountLoader<'info, AllocationConsensus>,
    #[account(mut,close=admin,seeds=[ROUND_CONTEXT_SEED,&round.to_le_bytes()],bump=round_context.bump)]
    pub round_context: Box<Account<'info, RoundContext>>,
    #[account(mut)]
    pub admin: Signer<'info>,
}
pub fn close_allocation_round_v2(ctx: Context<CloseAllocationRoundV2>, round: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        QuorumError::Unauthorized
    );
    let c = ctx.accounts.consensus.load()?;
    require!(
        c.status != state_flags::OPEN && ctx.accounts.round_context.outcome != 0,
        QuorumError::RoundNotOpen
    );
    require!(
        Clock::get()?.slot >= c.closes_at_slot,
        QuorumError::WindowStillOpen
    );
    require!(
        round != ctx.accounts.policy.published_round,
        QuorumError::RetainPublishedSnapshot
    );
    Ok(())
}

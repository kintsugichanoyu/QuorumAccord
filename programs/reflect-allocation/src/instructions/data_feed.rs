use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReflectError;
use crate::state::{DataFeed, OperatorRegistry};

#[derive(Accounts)]
#[instruction(pool_id: u8, data_id: u8)]
pub struct InitDataFeed<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(
        init,
        payer = admin,
        space = 8 + DataFeed::LEN,
        seeds = [DATA_FEED_SEED, &[pool_id], &[data_id]],
        bump
    )]
    pub data_feed: AccountLoader<'info, DataFeed>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Trigger/aggregation config for a new series.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DataFeedConfig {
    pub measurand: u8,
    pub window_slots: u32,
    pub threshold_bps: u16,
    pub min_interval_slots: u32,
    pub max_interval_slots: u32,
    pub min_number: u8,
    pub rule: u8,
    pub trim_pct: u8,
}

impl DataFeedConfig {
    fn validate(&self) -> Result<()> {
        require!(self.window_slots > 0, ReflectError::InvalidConfig);
        require!(
            (self.min_number as usize) <= MAX_SUBMISSIONS,
            ReflectError::InvalidQuorum
        );
        require!(self.rule <= rule_flags::TRIMMED_MEAN, ReflectError::InvalidRule);
        require!(self.trim_pct < 50, ReflectError::InvalidConfig);
        Ok(())
    }
}

pub fn init_data_feed(
    ctx: Context<InitDataFeed>,
    pool_id: u8,
    data_id: u8,
    config: DataFeedConfig,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        ReflectError::Unauthorized
    );
    config.validate()?;

    let mut df = ctx.accounts.data_feed.load_init()?;
    df.pool_id = pool_id;
    df.data_id = data_id;
    df.measurand = config.measurand;
    df.window_slots = config.window_slots;
    df.threshold_bps = config.threshold_bps;
    df.min_interval_slots = config.min_interval_slots;
    df.max_interval_slots = config.max_interval_slots;
    df.min_number = config.min_number;
    df.rule = config.rule;
    df.trim_pct = config.trim_pct;
    df.bump = ctx.bumps.data_feed;
    df.head = 0;
    df.tick = 0;
    df.last_finalized_slot = 0;
    df.last_value = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateThresholds<'info> {
    #[account(seeds = [REGISTRY_SEED], bump)]
    pub registry: AccountLoader<'info, OperatorRegistry>,
    #[account(mut)]
    pub data_feed: AccountLoader<'info, DataFeed>,
    pub admin: Signer<'info>,
}

pub fn update_thresholds(
    ctx: Context<UpdateThresholds>,
    config: DataFeedConfig,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.registry.load()?.admin,
        ctx.accounts.admin.key(),
        ReflectError::Unauthorized
    );
    config.validate()?;

    let mut df = ctx.accounts.data_feed.load_mut()?;
    df.measurand = config.measurand;
    df.window_slots = config.window_slots;
    df.threshold_bps = config.threshold_bps;
    df.min_interval_slots = config.min_interval_slots;
    df.max_interval_slots = config.max_interval_slots;
    df.min_number = config.min_number;
    df.rule = config.rule;
    df.trim_pct = config.trim_pct;
    Ok(())
}

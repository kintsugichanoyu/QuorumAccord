//! Decentralised capital-allocation oracle + consensus program.
//!
//! One program, four account types:
//!   * `OperatorRegistry`   — admin authority + allowed signer set
//!   * `DataFeed`           — per-metric ring buffer + trigger config
//!   * `DataFeedConsensus`  — in-flight per-window sample round
//!   * `AllocationConsensus`— per-round weight-vector round (publishes `AllocationState`)
//!
//! A single instruction set serves every series; adding a metric registers a new
//! `DataFeed` PDA with no program upgrade. See `specs/SPECIFICATION.md`.

use anchor_lang::prelude::*;

pub mod aggregation;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

// Bring the `Accounts` contexts (and their derive-generated `__client_accounts_*`
// modules) into the crate root so the `#[program]` macro can resolve them by name.
use constants::N_VENUES;
pub use instructions::*;

declare_id!("DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz");

#[program]
pub mod reflect_allocation {
    use super::*;

    // ---- registry / admin ----
    pub fn init_registry(ctx: Context<InitRegistry>) -> Result<()> {
        instructions::init_registry(ctx)
    }
    pub fn add_operator(ctx: Context<MutateOperators>, operator: Pubkey) -> Result<()> {
        instructions::add_operator(ctx, operator)
    }
    pub fn remove_operator(ctx: Context<MutateOperators>, operator: Pubkey) -> Result<()> {
        instructions::remove_operator(ctx, operator)
    }

    // ---- data feeds ----
    pub fn init_data_feed(
        ctx: Context<InitDataFeed>,
        pool_id: u8,
        data_id: u8,
        config: DataFeedConfig,
    ) -> Result<()> {
        instructions::init_data_feed(ctx, pool_id, data_id, config)
    }
    pub fn update_thresholds(ctx: Context<UpdateThresholds>, config: DataFeedConfig) -> Result<()> {
        instructions::update_thresholds(ctx, config)
    }

    // ---- sample consensus (producers) ----
    pub fn propose_sample(
        ctx: Context<ProposeSample>,
        window_index: u64,
        value: u64,
        slot_at_read: u64,
    ) -> Result<()> {
        instructions::propose_sample(ctx, window_index, value, slot_at_read)
    }
    pub fn corroborate_sample(
        ctx: Context<CorroborateSample>,
        window_index: u64,
        value: u64,
        slot_at_read: u64,
    ) -> Result<()> {
        instructions::corroborate_sample(ctx, window_index, value, slot_at_read)
    }
    pub fn finalize_sample(ctx: Context<FinalizeSample>, window_index: u64) -> Result<()> {
        instructions::finalize_sample(ctx, window_index)
    }

    // ---- allocation consensus (consumers) ----
    pub fn init_allocation_state(ctx: Context<InitAllocationState>) -> Result<()> {
        instructions::init_allocation_state(ctx)
    }
    pub fn open_allocation_round(
        ctx: Context<OpenAllocationRound>,
        round: u64,
        closes_at_slot: u64,
        min_number: u8,
        rule: u8,
        trim_pct: u8,
    ) -> Result<()> {
        instructions::open_allocation_round(ctx, round, closes_at_slot, min_number, rule, trim_pct)
    }
    pub fn submit_weights(
        ctx: Context<SubmitWeights>,
        round: u64,
        weights: [u16; N_VENUES],
    ) -> Result<()> {
        instructions::submit_weights(ctx, round, weights)
    }
    pub fn finalize_allocation(ctx: Context<FinalizeAllocation>, round: u64) -> Result<()> {
        instructions::finalize_allocation(ctx, round)
    }
}

#[cfg(test)]
mod layout_tests {
    use crate::state::*;
    use core::mem::size_of;

    /// Solana's default single-account budget before zero-copy/realloc gymnastics.
    const SINGLE_ACCOUNT_BUDGET: usize = 10 * 1024;
    const DISCRIMINATOR: usize = 8;

    #[test]
    fn pod_struct_sizes_are_padding_free() {
        // These exact sizes follow from the field layouts; if a field is added
        // without fixing the explicit padding, this test catches it.
        assert_eq!(size_of::<Sample>(), 32);
        assert_eq!(size_of::<SampleSubmission>(), 40);
        assert_eq!(size_of::<WeightSubmission>(), 64);
        assert_eq!(size_of::<DataFeed>(), 8240);
        assert_eq!(size_of::<DataFeedConsensus>(), 4064);
        assert_eq!(size_of::<AllocationConsensus>(), 6456);
    }

    #[test]
    fn every_account_fits_a_single_solana_account() {
        for (name, body) in [
            ("OperatorRegistry", OperatorRegistry::LEN),
            ("DataFeed", DataFeed::LEN),
            ("DataFeedConsensus", DataFeedConsensus::LEN),
            ("AllocationConsensus", AllocationConsensus::LEN),
        ] {
            assert!(
                DISCRIMINATOR + body <= SINGLE_ACCOUNT_BUDGET,
                "{name} = {} bytes exceeds the {SINGLE_ACCOUNT_BUDGET}-byte budget",
                DISCRIMINATOR + body
            );
        }
    }
}

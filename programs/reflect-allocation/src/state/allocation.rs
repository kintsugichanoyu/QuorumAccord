use anchor_lang::prelude::*;

use crate::aggregation;
use crate::constants::*;
use crate::error::ReflectError;

/// One consumer's weight-vector submission. Weights are stored *positionally*:
/// index == `venue_id`, dropping the explicit per-entry id byte to keep the
/// 100-submission array within a single account. `#[repr(C)]`, 64 bytes.
#[zero_copy]
pub struct WeightSubmission {
    pub submitter: Pubkey,
    pub weights: [u16; N_VENUES],
}

/// Per weight-round consensus, independent of any `DataFeed` tick. Aggregates the
/// consumers' venue-weight vectors into the published allocation.
#[account(zero_copy)]
pub struct AllocationConsensus {
    pub round: u64,
    pub closes_at_slot: u64,
    pub status: u8,
    pub min_number: u8,
    pub rule: u8,
    pub trim_pct: u8,
    pub count: u8,
    pub bump: u8,
    pub output: [u16; N_VENUES], // sums to MAX_BPS after renormalisation
    pub submissions: [WeightSubmission; MAX_SUBMISSIONS],
    pub _pad: [u8; 2],
}

impl AllocationConsensus {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn add_submission(&mut self, submitter: Pubkey, weights: [u16; N_VENUES]) -> Result<()> {
        require!(self.status == state_flags::OPEN, ReflectError::RoundNotOpen);
        require!(
            aggregation::valid_ratios(&weights),
            ReflectError::InvalidRatios
        );
        let n = self.count as usize;
        require!(n < MAX_SUBMISSIONS, ReflectError::SubmissionBufferFull);
        for s in &self.submissions[..n] {
            require!(s.submitter != submitter, ReflectError::DuplicateSubmission);
        }
        self.submissions[n].submitter = submitter;
        self.submissions[n].weights = weights;
        self.count = (n + 1) as u8;
        Ok(())
    }

    /// Per-venue aggregation across all submissions, then renormalise to MAX_BPS.
    /// Uses a single reusable column buffer to keep the stack frame small.
    pub fn aggregate(&self) -> [u16; N_VENUES] {
        let n = self.count as usize;
        let mut out = [0u16; N_VENUES];
        let mut col = [0u64; MAX_SUBMISSIONS];
        for (v, slot) in out.iter_mut().enumerate() {
            for i in 0..n {
                col[i] = self.submissions[i].weights[v] as u64;
            }
            *slot = aggregation::aggregate_scalar(&mut col[..n], self.rule, self.trim_pct) as u16;
        }
        aggregation::renormalize_to_bps(&mut out);
        out
    }
}

/// The published allocation weight vector — a small, stable read target for
/// reflect-core (the vault reads this one PDA). Written by `finalize_allocation`.
#[account]
#[derive(InitSpace)]
pub struct AllocationState {
    pub round: u64,
    pub updated_slot: u64,
    pub weights: [u16; N_VENUES],
    pub bump: u8,
}

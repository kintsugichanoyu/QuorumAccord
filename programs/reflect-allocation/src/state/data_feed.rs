use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReflectError;

/// One ring-buffer entry. `#[repr(C)]`, 32 bytes, no padding (Pod-safe).
#[zero_copy]
pub struct Sample {
    pub value: u64,
    pub slot: u64, // closing slot of the tick window this sample covers
    pub tick: u64, // monotonic sample counter at write time
    pub ts: i64,   // unix timestamp at finalize
}

/// Per-`(pool_id, data_id)` measured series: identity, trigger config and the
/// ring buffer. Sized to fit a single Solana account (8-byte discriminator +
/// ~8.2 KB body, well under the 10 KB default).
///
/// Field order is chosen so the struct has no implicit padding: 8-byte fields,
/// then 4-byte, then 2-byte, then 1-byte, an explicit pad to an 8-byte boundary,
/// and finally the 8-byte-aligned ring.
#[account(zero_copy)]
pub struct DataFeed {
    // 8-byte
    pub tick: u64,                // monotonic finalized-sample counter
    pub last_finalized_slot: u64, // closing slot of the most recent tick window
    pub last_value: u64,          // scalar value at head
    // 4-byte — trigger config
    pub window_slots: u32, // width of a tick's Solana slot range (consensus window)
    pub min_interval_slots: u32, // brake: refuse a new tick sooner than this
    pub max_interval_slots: u32, // floor: force a new tick after this idle interval
    // 2-byte
    pub threshold_bps: u16, // ratio divergence (bps) that allows an early tick
    pub head: u16,          // ring write index
    // 1-byte
    pub pool_id: u8,    // which venue/pool (index into PoolRegistry)
    pub data_id: u8,    // metric tag inside the rubric equation
    pub measurand: u8,  // decode type for `value` (see constants::data_type)
    pub min_number: u8, // quorum inherited by each round's consensus
    pub rule: u8,       // aggregation rule (see constants::rule_flags)
    pub trim_pct: u8,   // trim percent for TrimmedMean
    pub bump: u8,
    pub _pad: [u8; 1],
    // 8-byte aligned ring
    pub ring: [Sample; RING_LEN],
}

impl DataFeed {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// MVP accessor — the latest finalized value.
    pub fn scalar(&self) -> u64 {
        let head = self.head as usize;
        let last = if head == 0 { RING_LEN - 1 } else { head - 1 };
        self.ring[last].value
    }
}

/// One operator's sample submission. `#[repr(C)]`, 40 bytes, no padding.
#[zero_copy]
pub struct SampleSubmission {
    pub value: u64,
    pub submitter: Pubkey,
}

/// In-flight consensus round for one `(data_feed, window_index)` pair. Opens at
/// the first submission, closes at `closes_at_slot`, then `finalize_sample`
/// aggregates and the result lands in `DataFeed.ring[head]`.
#[account(zero_copy)]
pub struct DataFeedConsensus {
    pub window_index: u64,   // floor(slot / window_slots) — also the PDA seed
    pub closes_at_slot: u64, // = (window_index + 1) * window_slots
    pub output: u64,         // aggregated result; set when status == FINALIZED
    pub data_feed: Pubkey,   // parent DataFeed this round writes back into
    pub status: u8,          // see constants::state_flags
    pub min_number: u8,      // quorum required at close (<= MAX_SUBMISSIONS)
    pub rule: u8,
    pub trim_pct: u8,
    pub count: u8, // populated entries in `submissions`
    pub bump: u8,
    pub _pad: [u8; 2],
    pub submissions: [SampleSubmission; MAX_SUBMISSIONS],
}

impl DataFeedConsensus {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Append a submission, enforcing open status, capacity and one-per-operator.
    pub fn add_submission(&mut self, submitter: Pubkey, value: u64) -> Result<()> {
        require!(self.status == state_flags::OPEN, ReflectError::RoundNotOpen);
        let n = self.count as usize;
        require!(n < MAX_SUBMISSIONS, ReflectError::SubmissionBufferFull);
        for s in &self.submissions[..n] {
            require!(s.submitter != submitter, ReflectError::DuplicateSubmission);
        }
        self.submissions[n].submitter = submitter;
        self.submissions[n].value = value;
        self.count = (n + 1) as u8;
        Ok(())
    }
}

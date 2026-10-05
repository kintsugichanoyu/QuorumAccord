//! Read-only byte view over a `DataFeed` account, so the consumer can decode the
//! fields it needs without the on-chain crate. Offsets follow the zero-copy
//! layout in `programs/quorum-allocation/src/state/data_feed.rs` (8-byte Anchor
//! discriminator first).

use anyhow::{ensure, Result};
use solana_sdk::pubkey::Pubkey;

const DISC: usize = 8;
const RING_LEN: usize = 256;
const SAMPLE_SIZE: usize = 32;
const RING_OFFSET: usize = DISC + 48; // header is 48 bytes after the discriminator
const N_VENUES: usize = 16;

#[derive(Clone, Copy, Debug)]
pub struct DataFeedView {
    pub tick: u64,
    pub last_finalized_slot: u64,
    pub last_value: u64,
    pub window_slots: u32,
    pub head: u16,
}

impl DataFeedView {
    pub fn parse(data: &[u8]) -> Result<Self> {
        ensure!(
            data.len() >= RING_OFFSET + RING_LEN * SAMPLE_SIZE,
            "account too small to be a DataFeed ({} bytes)",
            data.len()
        );
        ensure!(
            data[..DISC] == crate::anchor_codec::account_discriminator("DataFeed"),
            "wrong DataFeed discriminator"
        );
        ensure!(
            (u16_at(data, DISC + 38) as usize) < RING_LEN,
            "invalid ring head"
        );
        Ok(Self {
            tick: u64_at(data, DISC),
            last_finalized_slot: u64_at(data, DISC + 8),
            last_value: u64_at(data, DISC + 16),
            window_slots: u32_at(data, DISC + 24),
            head: u16_at(data, DISC + 38),
        })
    }

    /// MVP accessor — the latest finalized value (ring[head-1]).
    pub fn scalar(&self, data: &[u8]) -> u64 {
        if self.tick == 0 {
            return 0;
        }
        let head = self.head as usize;
        let last = if head == 0 { RING_LEN - 1 } else { head - 1 };
        u64_at(data, RING_OFFSET + last * SAMPLE_SIZE) // Sample.value is first
    }

    pub fn is_stale(&self, now_slot: u64, tolerance_slots: u64) -> bool {
        self.last_finalized_slot == 0
            || now_slot.saturating_sub(self.last_finalized_slot) > tolerance_slots
    }
}

/// Read-only view over the published `AllocationState` account (the small, stable
/// PDA the vault reads). Borsh layout (`#[account]`, not zero-copy):
/// disc(8) → round u64 → updated_slot u64 → weights [u16; 16] → bump u8.
#[derive(Clone, Copy, Debug)]
pub struct AllocationStateView {
    pub round: u64,
    pub updated_slot: u64,
    pub weights: [u16; N_VENUES],
}

impl AllocationStateView {
    pub fn parse(data: &[u8]) -> Result<Self> {
        ensure!(
            data.len() >= DISC + 8 + 8 + N_VENUES * 2 + 1,
            "account too small to be an AllocationState ({} bytes)",
            data.len()
        );
        ensure!(
            data[..DISC] == crate::anchor_codec::account_discriminator("AllocationState"),
            "wrong AllocationState discriminator"
        );
        let mut weights = [0u16; N_VENUES];
        for (i, w) in weights.iter_mut().enumerate() {
            *w = u16_at(data, DISC + 16 + i * 2);
        }
        Ok(Self {
            round: u64_at(data, DISC),
            updated_slot: u64_at(data, DISC + 8),
            weights,
        })
    }
}

// ---- in-flight consensus account decoders (used by the e2e verifier) ----------
// Offsets follow the zero-copy layouts in
// `programs/quorum-allocation/src/state/{data_feed.rs,allocation.rs}`.

// DataFeedConsensus: disc(8) window_index(8) closes_at(8) output(8) data_feed(32)
//   status(1)@64 min_number(1) rule(1) trim_pct(1) count(1)@68 bump(1) _pad(2)
//   submissions@72, each SampleSubmission = value(8) + submitter(32) = 40.
pub fn sample_consensus_status(d: &[u8]) -> u8 {
    d[DISC + 56]
}
pub fn sample_consensus_count(d: &[u8]) -> u8 {
    d[DISC + 60]
}
pub fn sample_submission_value(d: &[u8], i: usize) -> u64 {
    u64_at(d, DISC + 64 + i * 40)
}
pub fn sample_submission_submitter(d: &[u8], i: usize) -> Pubkey {
    pubkey_at(d, DISC + 72 + i * 40)
}

// AllocationConsensus: disc(8) round(8) closes_at(8) status(1)@24 min_number(1)
//   rule(1) trim_pct(1) count(1)@28 bump(1) output[16](32)@30 submissions@62,
//   each WeightSubmission = submitter(32) + weights[16](32) = 64.
pub fn alloc_consensus_status(d: &[u8]) -> u8 {
    d[DISC + 16]
}
pub fn alloc_consensus_count(d: &[u8]) -> u8 {
    d[DISC + 20]
}
pub fn alloc_submission_submitter(d: &[u8], i: usize) -> Pubkey {
    pubkey_at(d, DISC + 54 + i * 64)
}
pub fn alloc_submission_weights(d: &[u8], i: usize) -> [u16; N_VENUES] {
    let base = DISC + 86 + i * 64;
    let mut w = [0u16; N_VENUES];
    for (k, slot) in w.iter_mut().enumerate() {
        *slot = u16_at(d, base + k * 2);
    }
    w
}

fn u64_at(d: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(d[off..off + 8].try_into().unwrap())
}
fn u32_at(d: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(d[off..off + 4].try_into().unwrap())
}
fn u16_at(d: &[u8], off: usize) -> u16 {
    u16::from_le_bytes(d[off..off + 2].try_into().unwrap())
}
fn pubkey_at(d: &[u8], off: usize) -> Pubkey {
    Pubkey::new_from_array(d[off..off + 32].try_into().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed() -> Vec<u8> {
        let mut data = vec![0; RING_OFFSET + RING_LEN * SAMPLE_SIZE];
        data[..DISC].copy_from_slice(&crate::anchor_codec::account_discriminator("DataFeed"));
        data
    }

    #[test]
    fn feed_rejects_truncation_wrong_discriminator_and_invalid_head() {
        let mut data = feed();
        assert!(DataFeedView::parse(&data).is_ok());
        assert!(DataFeedView::parse(&data[..data.len() - 1]).is_err());
        data[0] ^= 1;
        assert!(DataFeedView::parse(&data).is_err());
        data[0] ^= 1;
        data[DISC + 38..DISC + 40].copy_from_slice(&256u16.to_le_bytes());
        assert!(DataFeedView::parse(&data).is_err());
    }

    #[test]
    fn scalar_reads_wrapped_ring_and_staleness_boundary() {
        let mut data = feed();
        assert_eq!(DataFeedView::parse(&data).unwrap().scalar(&data), 0);
        data[DISC..DISC + 8].copy_from_slice(&256u64.to_le_bytes());
        data[DISC + 8..DISC + 16].copy_from_slice(&100u64.to_le_bytes());
        let offset = RING_OFFSET + 255 * SAMPLE_SIZE;
        data[offset..offset + 8].copy_from_slice(&12345u64.to_le_bytes());
        let view = DataFeedView::parse(&data).unwrap();
        assert_eq!(view.scalar(&data), 12345);
        assert!(!view.is_stale(120, 20));
        assert!(view.is_stale(121, 20));
    }

    #[test]
    fn allocation_rejects_wrong_account_type_and_truncation() {
        let mut data = vec![0; DISC + 16 + N_VENUES * 2 + 1];
        assert!(AllocationStateView::parse(&data).is_err());
        data[..DISC].copy_from_slice(&crate::anchor_codec::account_discriminator(
            "AllocationState",
        ));
        assert!(AllocationStateView::parse(&data).is_ok());
        assert!(AllocationStateView::parse(&data[..data.len() - 1]).is_err());
    }
}

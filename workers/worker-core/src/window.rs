//! Deterministic tick-window maths, shared by every producer.
//!
//! Windows are derived purely from the Solana clock, with no global coordinator:
//! `window_index = floor(slot / window_slots)`, covering `[opens, closes)`.

/// The window index a given slot falls into.
pub fn window_index(slot: u64, window_slots: u64) -> u64 {
    slot / window_slots.max(1)
}

/// `[opens_at, closes_at)` slots for a window index.
pub fn window_bounds(window_index: u64, window_slots: u64) -> (u64, u64) {
    let opens = window_index.saturating_mul(window_slots);
    (opens, opens.saturating_add(window_slots))
}

/// Ratio divergence in basis points — mirrors the on-chain check exactly.
pub fn divergence_bps(current: u64, last: u64) -> u64 {
    current.abs_diff(last).saturating_mul(10_000) / last.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_and_bounds_agree() {
        let ws = 450;
        for slot in [0u64, 1, 449, 450, 451, 12_345] {
            let idx = window_index(slot, ws);
            let (o, c) = window_bounds(idx, ws);
            assert!(o <= slot && slot < c, "slot {slot} not in [{o},{c})");
        }
    }

    #[test]
    fn divergence_matches_program() {
        assert_eq!(divergence_bps(110, 100), 1000);
        assert_eq!(divergence_bps(100, 100), 0);
        assert_eq!(divergence_bps(5, 0), 50_000);
    }
}

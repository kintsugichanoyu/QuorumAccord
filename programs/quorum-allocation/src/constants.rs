//! Program-wide constants and small flag namespaces.
//!
//! Flags are stored as raw `u8` inside the zero-copy (`bytemuck::Pod`) accounts —
//! Rust enums are not `Pod`-safe, so `status` / `rule` live as bytes and these
//! modules give them names.

/// Maximum number of registered operator signers held by `OperatorRegistry`.
pub const MAX_OPERATORS: usize = 64;

/// Ring-buffer capacity per `DataFeed`. The MVP reads only the head; the extra
/// history exists so future EMA / median / trimmed-mean accessors can be wired in
/// without re-architecting the on-chain layout.
pub const RING_LEN: usize = 256;

/// Maximum submissions aggregated in a single consensus round (per the spec's
/// 100-slot array). `min_number` must be `<= MAX_SUBMISSIONS`.
pub const MAX_SUBMISSIONS: usize = 100;

/// Number of lending venues in the allocation weight vector.
pub const N_VENUES: usize = 16;

/// Basis-point denominator. A finalized weight vector sums to exactly `MAX_BPS`.
pub const MAX_BPS: u64 = 10_000;

// ---- PDA seeds ----------------------------------------------------------------

pub const REGISTRY_SEED: &[u8] = b"registry";
pub const DATA_FEED_SEED: &[u8] = b"data_feed";
pub const TICK_CONSENSUS_SEED: &[u8] = b"tick_consensus";
pub const ALLOCATION_CONSENSUS_SEED: &[u8] = b"consensus";
pub const ALLOCATION_STATE_SEED: &[u8] = b"allocation_state";

/// Consensus round lifecycle, stored as `u8`.
pub mod state_flags {
    pub const OPEN: u8 = 0;
    pub const CLOSED: u8 = 1;
    pub const FINALIZED: u8 = 2;
}

/// Aggregation rule applied at finalize, stored as `u8`. `TrimmedMean` carries a
/// separate `trim_pct` byte (percent trimmed from each tail).
pub mod rule_flags {
    pub const MEAN: u8 = 0;
    pub const MEDIAN: u8 = 1;
    pub const TRIMMED_MEAN: u8 = 2;
}

/// Decode type for a `DataFeed`'s scalar `value`, stored as `u8`. The MVP always
/// materialises the value as `u64`; this tags how a producer decoded it.
pub mod data_type {
    pub const U64: u8 = 0;
    pub const U32: u8 = 1;
    pub const U16: u8 = 2;
}

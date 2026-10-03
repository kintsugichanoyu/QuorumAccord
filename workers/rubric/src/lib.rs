//! Deterministic, integer-only allocation rubric — the consumer's scoring core.
//!
//! Reproduces the MVP "live-scalar" formula from the brief:
//!
//! ```text
//! yield × risk-discount  →  screen  →  normalise  →  cap
//! ```
//!
//! Every operator must compute the *same* weight vector from the *same* inputs,
//! so there is no floating point anywhere: all maths is `u64`/`u128` fixed-point
//! in basis points, division always follows multiplication, and apportionment
//! uses the deterministic largest-remainder method (ties broken by lowest index).
//!
//! NOTE: the screen direction (`max_crr_bps`) and the cap-redistribution policy
//! are the two places that must be reconciled bit-for-bit against the production
//! `analysis/risk_scoring.py` / `ALLOCATION_METHODOLOGY.md` before mainnet. The
//! structure here is correct and self-consistent; the exact thresholds are config.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

/// Basis-point denominator. A finalised weight vector sums to exactly `MAX_BPS`.
pub const MAX_BPS: u32 = 10_000;

/// One venue's decoded inputs for a single scoring run.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct VenueInput {
    /// Supply APY in basis points (e.g. 5.25% = 525).
    pub apy_bps: u64,
    /// Risk discount (CRR) in basis points, clamped to `0..=MAX_BPS`.
    pub crr_bps: u64,
    /// Per-venue capital cap in basis points; `MAX_BPS` means effectively uncapped.
    pub cap_bps: u16,
    /// True if the venue's feed is too stale to use — excluded from allocation.
    pub stale: bool,
}

/// Tunable rubric parameters (the on-chain `RubricConfig` analogue, off-chain).
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct RubricConfig {
    /// Venues whose CRR is greater than or equal to this are screened out entirely.
    pub max_crr_bps: u64,
}

impl Default for RubricConfig {
    fn default() -> Self {
        // 0.60 discount ceiling, per the brief's "CRR screen ≥ 0.60" example.
        Self { max_crr_bps: 6_000 }
    }
}

/// `risk_adj_yield = APY × (1 − CRR)` in basis points.
pub fn risk_adjusted_yield_bps(apy_bps: u64, crr_bps: u64) -> u64 {
    let crr = crr_bps.min(MAX_BPS as u64);
    ((apy_bps as u128 * (MAX_BPS as u128 - crr as u128)) / MAX_BPS as u128) as u64
}

/// Compute the weight vector (basis points) for the given venues.
///
/// Output length equals the input length; screened-out / stale venues get 0.
/// When at least one venue survives and aggregate caps allow it, the result sums
/// to exactly `MAX_BPS`. If the surviving caps total less than `MAX_BPS`, the
/// result sums to that total (under-allocation is surfaced rather than hidden).
pub fn compute_weights(venues: &[VenueInput], cfg: &RubricConfig) -> Vec<u16> {
    let n = venues.len();
    let mut weights = vec![0u16; n];

    // 1. screen + risk-adjusted yield
    let mut raw = vec![0u128; n];
    for (i, v) in venues.iter().enumerate() {
        if v.stale || v.crr_bps >= cfg.max_crr_bps {
            continue;
        }
        raw[i] = risk_adjusted_yield_bps(v.apy_bps, v.crr_bps) as u128;
    }
    let sum: u128 = raw.iter().sum();
    if sum == 0 {
        return weights;
    }

    // 2. normalise to MAX_BPS via largest-remainder apportionment
    let mut allocated: u32 = 0;
    let mut remainders: Vec<(u128, usize)> = Vec::with_capacity(n);
    for i in 0..n {
        let scaled = raw[i] * MAX_BPS as u128;
        let q = (scaled / sum) as u32;
        weights[i] = q as u16;
        allocated += q;
        remainders.push((scaled % sum, i));
    }
    // leftover < number of survivors, so a single ranked pass suffices.
    remainders.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut leftover = MAX_BPS - allocated;
    for &(_, idx) in &remainders {
        if leftover == 0 {
            break;
        }
        if raw[idx] > 0 {
            weights[idx] += 1;
            leftover -= 1;
        }
    }

    // 3. caps
    apply_caps(&mut weights, venues, &raw);
    weights
}

/// Clamp weights to per-venue caps and redistribute the freed basis points to
/// survivors with headroom, proportional to that headroom. Bounded passes keep it
/// deterministic and terminating; any final rounding remainder goes to the venue
/// with the most headroom (ties → lowest index).
fn apply_caps(weights: &mut [u16], venues: &[VenueInput], raw: &[u128]) {
    const MAX_PASSES: usize = 16;
    let n = weights.len();

    for _ in 0..MAX_PASSES {
        let mut excess: u32 = 0;
        for i in 0..n {
            let cap = venues[i].cap_bps as u32;
            let w = weights[i] as u32;
            if w > cap {
                excess += w - cap;
                weights[i] = cap as u16;
            }
        }
        if excess == 0 {
            return;
        }

        // headroom for survivors that are below their cap
        let mut headroom = vec![0u128; n];
        let mut total_headroom: u128 = 0;
        for i in 0..n {
            if venues[i].stale || raw[i] == 0 {
                continue;
            }
            let cap = venues[i].cap_bps as u32;
            let w = weights[i] as u32;
            if cap > w {
                headroom[i] = (cap - w) as u128;
                total_headroom += headroom[i];
            }
        }
        if total_headroom == 0 {
            return; // nowhere to put the excess; weights under-sum (surfaced)
        }

        // proportional distribution (largest-remainder), clamped to headroom
        let mut given: u32 = 0;
        let mut rema: Vec<(u128, usize)> = Vec::with_capacity(n);
        for i in 0..n {
            if headroom[i] == 0 {
                continue;
            }
            let scaled = headroom[i] * excess as u128;
            let q = (scaled / total_headroom) as u32;
            let add = q.min(headroom[i] as u32);
            weights[i] += add as u16;
            given += add;
            rema.push((scaled % total_headroom, i));
        }
        let mut leftover = excess - given;
        rema.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        for &(_, idx) in &rema {
            if leftover == 0 {
                break;
            }
            let cap = venues[idx].cap_bps as u32;
            if (weights[idx] as u32) < cap {
                weights[idx] += 1;
                leftover -= 1;
            }
        }
        // loop again to re-clamp anything pushed over cap by integer rounding
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(apy_bps: u64, crr_bps: u64) -> VenueInput {
        VenueInput {
            apy_bps,
            crr_bps,
            cap_bps: MAX_BPS as u16,
            stale: false,
        }
    }

    fn sum(w: &[u16]) -> u32 {
        w.iter().map(|&x| x as u32).sum()
    }

    #[test]
    fn risk_adjusted_yield() {
        assert_eq!(risk_adjusted_yield_bps(1000, 0), 1000);
        assert_eq!(risk_adjusted_yield_bps(1000, 5000), 500); // 50% discount
        assert_eq!(risk_adjusted_yield_bps(1000, 10_000), 0);
    }

    #[test]
    fn equal_yields_split_evenly() {
        let w = compute_weights(&[v(500, 0), v(500, 0)], &RubricConfig::default());
        assert_eq!(w, vec![5000, 5000]);
        assert_eq!(sum(&w), MAX_BPS);
    }

    #[test]
    fn proportional_to_risk_adjusted_yield() {
        // venue A: 10% apy, 0 crr -> raw 1000; venue B: 10% apy, 50% crr -> raw 500
        let w = compute_weights(&[v(1000, 0), v(1000, 5000)], &RubricConfig::default());
        assert_eq!(sum(&w), MAX_BPS);
        // 1000:500 => 2:1 => 6667/3333
        assert_eq!(w, vec![6667, 3333]);
    }

    #[test]
    fn screen_drops_high_crr_venue() {
        let cfg = RubricConfig { max_crr_bps: 6_000 };
        let w = compute_weights(&[v(500, 0), v(500, 7000)], &cfg);
        assert_eq!(w, vec![10_000, 0]);
    }

    #[test]
    fn screen_excludes_exact_boundary() {
        assert_eq!(
            compute_weights(&[v(500, 6000)], &RubricConfig::default()),
            vec![0]
        );
    }

    #[test]
    fn cap_redistribution_includes_eligible_zero_rounded_weight() {
        let mut a = v(1_000_000, 0);
        a.cap_bps = 3000;
        assert_eq!(
            compute_weights(&[a, v(1, 0)], &RubricConfig::default()),
            vec![3000, 7000]
        );
    }

    #[test]
    fn stale_venue_excluded() {
        let mut a = v(500, 0);
        let mut b = v(500, 0);
        b.stale = true;
        let _ = &mut a;
        let w = compute_weights(&[a, b], &RubricConfig::default());
        assert_eq!(w, vec![10_000, 0]);
    }

    #[test]
    fn no_survivors_yields_zero_vector() {
        let cfg = RubricConfig { max_crr_bps: 1 };
        let w = compute_weights(&[v(500, 9000), v(500, 9000)], &cfg);
        assert_eq!(w, vec![0, 0]);
    }

    #[test]
    fn cap_clamps_and_redistributes() {
        // Two equal venues would be 5000/5000, but cap venue 0 at 3000.
        let mut a = v(500, 0);
        a.cap_bps = 3000;
        let b = v(500, 0);
        let w = compute_weights(&[a, b], &RubricConfig::default());
        assert_eq!(sum(&w), MAX_BPS);
        assert_eq!(w[0], 3000);
        assert_eq!(w[1], 7000);
    }

    #[test]
    fn caps_below_total_under_allocate_is_surfaced() {
        // both capped at 3000 -> max achievable is 6000, not 10000
        let mut a = v(500, 0);
        let mut b = v(500, 0);
        a.cap_bps = 3000;
        b.cap_bps = 3000;
        let w = compute_weights(&[a, b], &RubricConfig::default());
        assert_eq!(sum(&w), 6000);
    }

    /// Golden vector for `testing/devnet/src/allocation.ts`: five venues with
    /// the documented (apy, crr) bps, padded to the on-chain 16-venue width. v3
    /// (crr 7000 > 6000) is screened out. This is the exact value the e2e verifier
    /// asserts `AllocationState.weights` equals after `finalize_allocation`.
    #[test]
    fn e2e_dataset_golden_vector() {
        // (apy_bps, crr_bps) per the e2e VENUES table.
        let inputs = [
            (1000u64, 2000u64),
            (1200, 4000),
            (800, 1000),
            (1500, 7000),
            (600, 3000),
        ];
        let mut venues: Vec<VenueInput> = inputs.iter().map(|&(a, c)| v(a, c)).collect();
        venues.resize(16, v(0, 0)); // venues 5..15 contribute zero

        let w = compute_weights(&venues, &RubricConfig::default());
        let mut expected = vec![3007u16, 2707, 2707, 0, 1579];
        expected.resize(16, 0);
        assert_eq!(w, expected);
        assert_eq!(sum(&w), MAX_BPS);
    }
}

//! Pure, integer-only aggregation and renormalisation helpers.
//!
//! No floating point: results must be bit-identical across every operator and
//! every validator. All intermediate sums use `u128` to avoid overflow, and
//! division always follows multiplication. These functions are deliberately
//! free of any Solana/Anchor types so they can be unit-tested natively (see the
//! `tests` module at the bottom — run with `cargo test -p reflect-allocation`).

use crate::constants::{rule_flags, MAX_BPS, N_VENUES};

/// Ratio divergence in basis points between a candidate value and the last value:
/// `|current - last| * 10_000 / max(last, 1)`. Saturating to avoid overflow.
pub fn divergence_bps(current: u64, last: u64) -> u64 {
    let diff = current.abs_diff(last);
    diff.saturating_mul(MAX_BPS) / last.max(1)
}

/// Aggregate a set of scalar submissions under the given rule.
/// `values` is sorted in place for median / trimmed-mean.
pub fn aggregate_scalar(values: &mut [u64], rule: u8, trim_pct: u8) -> u64 {
    if values.is_empty() {
        return 0;
    }
    match rule {
        rule_flags::MEDIAN => median(values),
        rule_flags::TRIMMED_MEAN => trimmed_mean(values, trim_pct),
        _ => mean(values),
    }
}

fn mean(values: &[u64]) -> u64 {
    let sum: u128 = values.iter().map(|&v| v as u128).sum();
    (sum / values.len() as u128) as u64
}

fn median(values: &mut [u64]) -> u64 {
    values.sort_unstable();
    let n = values.len();
    if n % 2 == 1 {
        values[n / 2]
    } else {
        ((values[n / 2 - 1] as u128 + values[n / 2] as u128) / 2) as u64
    }
}

fn trimmed_mean(values: &mut [u64], trim_pct: u8) -> u64 {
    values.sort_unstable();
    let n = values.len();
    let k = (n * trim_pct as usize) / 100;
    if 2 * k >= n {
        // Trimming would remove everything — fall back to the median.
        return median(values);
    }
    mean(&values[k..n - k])
}

/// True iff the weight vector sums to exactly `MAX_BPS`.
pub fn valid_ratios(weights: &[u16; N_VENUES]) -> bool {
    let sum: u32 = weights.iter().map(|&w| w as u32).sum();
    sum as u64 == MAX_BPS
}

/// Force a weight vector to sum to exactly `MAX_BPS`.
///
/// A deficit is added to the smallest *positive* weight, an excess removed
/// from the *largest*; ties broken by lowest index (= lowest `venue_id`). The
/// loops handle the pathological case where a single slot cannot absorb the whole
/// adjustment without `u16` under/overflow.
pub fn renormalize_to_bps(weights: &mut [u16; N_VENUES]) {
    // Never create an allocation where every aggregate weight is zero.
    if weights.iter().all(|&w| w == 0) {
        return;
    }
    let sum = |w: &[u16; N_VENUES]| -> i64 { w.iter().map(|&x| x as i64).sum() };

    let mut s = sum(weights);
    while s < MAX_BPS as i64 {
        let deficit = (MAX_BPS as i64 - s) as u64;
        let idx = argmin_positive(weights);
        let headroom = u16::MAX as u64 - weights[idx] as u64;
        let add = deficit.min(headroom);
        if add == 0 {
            break;
        }
        weights[idx] += add as u16;
        s += add as i64;
    }
    while s > MAX_BPS as i64 {
        let excess = (s - MAX_BPS as i64) as u64;
        let idx = argmax(weights);
        let sub = excess.min(weights[idx] as u64);
        if sub == 0 {
            break;
        }
        weights[idx] -= sub as u16;
        s -= sub as i64;
    }
}

/// Index of the smallest weight; ties resolve to the lowest index.
fn argmin_positive(weights: &[u16; N_VENUES]) -> usize {
    let mut idx = weights.iter().position(|&w| w > 0).unwrap_or(0);
    for i in 0..N_VENUES {
        if weights[i] > 0 && weights[i] < weights[idx] {
            idx = i;
        }
    }
    idx
}

/// Index of the largest weight; ties resolve to the lowest index.
fn argmax(weights: &[u16; N_VENUES]) -> usize {
    let mut idx = 0;
    for i in 1..N_VENUES {
        if weights[i] > weights[idx] {
            idx = i;
        }
    }
    idx
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::rule_flags::*;

    fn zeros() -> [u16; N_VENUES] {
        [0u16; N_VENUES]
    }

    #[test]
    fn mean_basic() {
        assert_eq!(aggregate_scalar(&mut [10, 20, 30], MEAN, 0), 20);
        assert_eq!(aggregate_scalar(&mut [1, 2], MEAN, 0), 1); // integer floor
    }

    #[test]
    fn median_odd_and_even() {
        assert_eq!(aggregate_scalar(&mut [30, 10, 20], MEDIAN, 0), 20);
        assert_eq!(aggregate_scalar(&mut [10, 20, 30, 40], MEDIAN, 0), 25);
    }

    #[test]
    fn trimmed_drops_outliers() {
        // 10 values, 10% trim => k=1: drop the 1 and the 1000, mean of middle 8.
        let mut v = [1, 100, 101, 102, 103, 104, 105, 106, 107, 1000];
        assert_eq!(aggregate_scalar(&mut v, TRIMMED_MEAN, 10), 103);
    }

    #[test]
    fn trimmed_full_trim_falls_back_to_median() {
        // 50% trim on 3 values removes all -> median.
        assert_eq!(aggregate_scalar(&mut [5, 10, 15], TRIMMED_MEAN, 50), 10);
    }

    #[test]
    fn divergence() {
        assert_eq!(divergence_bps(110, 100), 1000); // +10% = 1000 bps
        assert_eq!(divergence_bps(100, 100), 0);
        assert_eq!(divergence_bps(90, 100), 1000);
        assert_eq!(divergence_bps(5, 0), 50_000); // last==0 guarded by max(last,1)
    }

    #[test]
    fn renorm_deficit_goes_to_smallest_lowest_index() {
        let mut w = zeros();
        w[0] = 4000;
        w[1] = 5000;
        renormalize_to_bps(&mut w);
        assert!(valid_ratios(&w));
        assert_eq!(w[0], 5000);
        assert!(w[2..].iter().all(|&x| x == 0));
    }

    #[test]
    fn renorm_empty_does_not_invent_an_allocation() {
        let mut w = zeros();
        renormalize_to_bps(&mut w);
        assert_eq!(w, zeros());
        assert!(!valid_ratios(&w));
    }

    #[test]
    fn renorm_excess_comes_off_largest_lowest_index() {
        let mut w = zeros();
        w[0] = 6000;
        w[1] = 5000;
        renormalize_to_bps(&mut w);
        assert!(valid_ratios(&w));
        assert_eq!(w[0], 5000);
        assert_eq!(w[1], 5000);
    }

    #[test]
    fn renorm_already_balanced_is_noop() {
        let mut w = zeros();
        w[0] = MAX_BPS as u16;
        renormalize_to_bps(&mut w);
        assert_eq!(w[0], MAX_BPS as u16);
        assert!(valid_ratios(&w));
    }

    #[test]
    fn valid_ratios_check() {
        let mut w = zeros();
        w[0] = MAX_BPS as u16;
        assert!(valid_ratios(&w));
        w[0] = 9999;
        assert!(!valid_ratios(&w));
    }
}

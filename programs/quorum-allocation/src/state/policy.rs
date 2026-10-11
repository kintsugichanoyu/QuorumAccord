use crate::{aggregation, constants::*, error::QuorumError};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PolicyConfig {
    pub feeds: [Pubkey; N_VENUES],
    pub max_stale_slots: [u32; N_VENUES],
    pub risk_bps: [u16; N_VENUES],
    pub caps_bps: [u16; N_VENUES],
    pub categories: [u8; N_VENUES],
    pub category_caps_bps: [u16; N_CATEGORIES],
    pub risk_screen_bps: u16,
    pub min_consumers: u8,
    pub max_round_slots: u32,
    #[max_len(64)]
    pub consumers: Vec<Pubkey>,
}
impl PolicyConfig {
    pub fn validate(&self) -> Result<()> {
        require!(
            !self.consumers.is_empty() && self.consumers.len() <= MAX_OPERATORS,
            QuorumError::InvalidAllocationPolicy
        );
        require!(
            self.min_consumers > 0 && self.min_consumers as usize <= self.consumers.len(),
            QuorumError::InvalidQuorum
        );
        require!(
            self.max_round_slots > 0 && self.risk_screen_bps <= MAX_BPS as u16,
            QuorumError::InvalidAllocationPolicy
        );
        for (i, key) in self.consumers.iter().enumerate() {
            require!(
                *key != Pubkey::default() && !self.consumers[..i].contains(key),
                QuorumError::InvalidAllocationPolicy
            );
        }
        for i in 0..N_VENUES {
            require!(
                self.risk_bps[i] <= 10_000
                    && self.caps_bps[i] <= 10_000
                    && (self.categories[i] as usize) < N_CATEGORIES,
                QuorumError::InvalidAllocationPolicy
            );
            if self.feeds[i] == Pubkey::default() {
                require!(self.caps_bps[i] == 0, QuorumError::InvalidAllocationPolicy);
            } else {
                require!(
                    self.max_stale_slots[i] > 0 && !self.feeds[..i].contains(&self.feeds[i]),
                    QuorumError::InvalidAllocationPolicy
                );
            }
        }
        require!(
            self.category_caps_bps.iter().all(|v| *v <= 10_000),
            QuorumError::InvalidAllocationPolicy
        );
        Ok(())
    }
    pub fn valid_weights(&self, weights: &[u16; N_VENUES], eligible: &[u8; N_VENUES]) -> bool {
        if !aggregation::valid_ratios(weights) {
            return false;
        }
        let mut totals = [0u32; N_CATEGORIES];
        for i in 0..N_VENUES {
            if weights[i] > self.caps_bps[i] || (eligible[i] == 0 && weights[i] != 0) {
                return false;
            }
            totals[self.categories[i] as usize] += weights[i] as u32;
        }
        totals
            .iter()
            .zip(self.category_caps_bps)
            .all(|(sum, cap)| *sum <= cap as u32)
    }
}

#[account]
#[derive(InitSpace)]
pub struct AllocationPolicy {
    pub version: u64,
    pub active_round: u64,
    pub published_round: u64,
    pub config: PolicyConfig,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RoundContext {
    pub round: u64,
    pub anchor_slot: u64,
    pub policy_version: u64,
    pub input_hash: [u8; 32],
    pub values: [u64; N_VENUES],
    pub ticks: [u64; N_VENUES],
    pub sample_slots: [u64; N_VENUES],
    pub eligible: [u8; N_VENUES],
    /// 0=open, 1=published, 2=no quorum, 3=superseded, 4=infeasible, 5=zero median, 6=expired.
    pub outcome: u8,
    pub config: PolicyConfig,
    pub bump: u8,
}

/// Keep excluded zeros; a median with insufficient admissible capacity aborts.
/// Capping and deficit redistribution both respect disjoint category budgets.
pub fn constrained_allocation(
    mut weights: [u16; N_VENUES],
    config: &PolicyConfig,
    eligible: &[u8; N_VENUES],
) -> Option<[u16; N_VENUES]> {
    let active: [bool; N_VENUES] = core::array::from_fn(|i| eligible[i] != 0 && weights[i] != 0);
    for i in 0..N_VENUES {
        weights[i] = if active[i] {
            weights[i].min(config.caps_bps[i])
        } else {
            0
        };
    }
    for cat in 0..N_CATEGORIES {
        let total: u32 = (0..N_VENUES)
            .filter(|i| config.categories[*i] as usize == cat)
            .map(|i| weights[i] as u32)
            .sum();
        let mut excess = total.saturating_sub(config.category_caps_bps[cat] as u32);
        while excess > 0 {
            let index = (0..N_VENUES)
                .filter(|i| config.categories[*i] as usize == cat && weights[*i] > 0)
                .max_by_key(|i| (weights[*i], core::cmp::Reverse(*i)))?;
            let reduction = excess.min(weights[index] as u32);
            weights[index] -= reduction as u16;
            excess -= reduction;
        }
    }
    let mut total: u32 = weights.iter().map(|x| *x as u32).sum();
    while total > 10_000 {
        let i = (0..N_VENUES).max_by_key(|i| (weights[*i], core::cmp::Reverse(*i)))?;
        let reduction = (total - 10_000).min(weights[i] as u32);
        weights[i] -= reduction as u16;
        total -= reduction;
    }
    // At most 10,000 bps are assigned. Each step exhausts the deficit, a venue or a category.
    for _ in 0..(N_VENUES + N_CATEGORIES + 1) {
        if total == 10_000 {
            return config.valid_weights(&weights, eligible).then_some(weights);
        }
        let category_totals: [u32; N_CATEGORIES] = core::array::from_fn(|cat| {
            (0..N_VENUES)
                .filter(|i| config.categories[*i] as usize == cat)
                .map(|i| weights[i] as u32)
                .sum()
        });
        let mut candidate = None;
        for i in 0..N_VENUES {
            let cat = config.categories[i] as usize;
            let room = (config.caps_bps[i] - weights[i]) as u32;
            let room = room
                .min((config.category_caps_bps[cat] as u32).saturating_sub(category_totals[cat]));
            if active[i]
                && room > 0
                && candidate.map_or(true, |(j, _)| (weights[i], i) < (weights[j], j))
            {
                candidate = Some((i, room));
            }
        }
        let (i, room) = candidate?;
        let amount = room.min(10_000 - total);
        weights[i] += amount as u16;
        total += amount;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> PolicyConfig {
        PolicyConfig {
            feeds: [Pubkey::new_unique(); N_VENUES],
            max_stale_slots: [100; N_VENUES],
            risk_bps: [0; N_VENUES],
            caps_bps: [5000; N_VENUES],
            categories: [0; N_VENUES],
            category_caps_bps: [10000; N_CATEGORIES],
            risk_screen_bps: 6000,
            min_consumers: 1,
            max_round_slots: 100,
            consumers: vec![Pubkey::new_unique()],
        }
    }
    #[test]
    fn concentrated_median_cannot_escape_cap() {
        let mut raw = [0; N_VENUES];
        raw[0] = 5000;
        assert_eq!(constrained_allocation(raw, &config(), &[1; N_VENUES]), None);
    }
    #[test]
    fn empty_median_has_no_invented_weights() {
        assert_eq!(
            constrained_allocation([0; N_VENUES], &config(), &[1; N_VENUES]),
            None
        );
    }
    #[test]
    fn redistribution_obeys_venue_and_category_caps() {
        let mut cfg = config();
        cfg.categories[2] = 1;
        cfg.category_caps_bps[0] = 6000;
        let mut raw = [0; N_VENUES];
        raw[..3].copy_from_slice(&[5000, 4000, 2000]);
        let out = constrained_allocation(raw, &cfg, &[1; N_VENUES]).unwrap();
        assert!(cfg.valid_weights(&out, &[1; N_VENUES]));
        assert!(out[0] + out[1] <= 6000);
        assert!(out[2] >= 4000);
    }
    #[test]
    fn stale_and_screened_positions_stay_zero() {
        let mut cfg = config();
        cfg.caps_bps[1] = 10000;
        let mut raw = [0; N_VENUES];
        raw[..2].copy_from_slice(&[5000, 5000]);
        let mut eligible = [1; N_VENUES];
        eligible[0] = 0;
        let out = constrained_allocation(raw, &cfg, &eligible).unwrap();
        assert_eq!(out[0], 0);
        assert_eq!(out[1], 10000);
    }
    #[test]
    fn arbitrary_medians_either_abort_or_satisfy_all_constraints() {
        let mut seed = 27u64;
        for _ in 0..2000 {
            let mut cfg = config();
            let mut raw = [0; N_VENUES];
            let mut eligible = [0; N_VENUES];
            for i in 0..N_VENUES {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                raw[i] = (seed % 10001) as u16;
                cfg.caps_bps[i] = ((seed >> 16) % 10001) as u16;
                cfg.categories[i] = (i % 4) as u8;
                eligible[i] = ((seed >> 32) % 2) as u8;
            }
            cfg.category_caps_bps = [3000, 4000, 5000, 6000];
            if let Some(out) = constrained_allocation(raw, &cfg, &eligible) {
                assert!(cfg.valid_weights(&out, &eligible));
            }
        }
    }
    #[test]
    fn policy_accounts_fit_default_creation_limit() {
        assert!(8 + AllocationPolicy::INIT_SPACE <= 10_240);
        assert!(8 + RoundContext::INIT_SPACE <= 10_240);
    }
}

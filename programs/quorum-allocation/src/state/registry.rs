use anchor_lang::prelude::*;

use crate::constants::MAX_OPERATORS;
use crate::error::QuorumError;

/// Allowed signer set + admin authority. Mutated only by `admin`.
///
/// When Jito NCN is integrated later this account is swapped for the NCN's
/// restaking-stake-weighted operator view; the producer / consumer instruction
/// surface does not change. Zero-copy so the hot-path `is_operator` check never
/// pays full deserialisation.
#[account(zero_copy)]
pub struct OperatorRegistry {
    pub admin: Pubkey,
    pub count: u16,
    pub bump: u8,
    pub _pad: [u8; 1],
    pub operators: [Pubkey; MAX_OPERATORS],
}

impl OperatorRegistry {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn is_operator(&self, key: &Pubkey) -> bool {
        self.operators[..self.count as usize]
            .iter()
            .any(|k| k == key)
    }

    pub fn add(&mut self, key: Pubkey) -> Result<()> {
        require!(
            (self.count as usize) < MAX_OPERATORS,
            QuorumError::OperatorSetFull
        );
        require!(
            !self.is_operator(&key),
            QuorumError::OperatorAlreadyRegistered
        );
        let n = self.count as usize;
        self.operators[n] = key;
        self.count += 1;
        Ok(())
    }

    pub fn remove(&mut self, key: &Pubkey) -> Result<()> {
        let n = self.count as usize;
        let pos = self.operators[..n]
            .iter()
            .position(|k| k == key)
            .ok_or(QuorumError::OperatorNotFound)?;
        // swap-remove and zero the vacated tail slot
        self.operators[pos] = self.operators[n - 1];
        self.operators[n - 1] = Pubkey::default();
        self.count -= 1;
        Ok(())
    }
}

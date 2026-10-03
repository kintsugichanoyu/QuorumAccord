//! Concrete drivers.
//!
//! `OffsetU64Driver` covers the common "one packed integer field" case and
//! documents the pattern: read a little-endian `u64` at a fixed offset and
//! rescale to basis points. Protocol-specific drivers (Marginfi, Kamino, Save,
//! Jupiter Lend, Loopscale) specialise `decode` to each account's real layout —
//! pull the field offsets from each protocol's published account schema / crate.

use anyhow::{ensure, Result};
use solana_sdk::pubkey::Pubkey;

use crate::driver::Driver;

pub struct OffsetU64Driver {
    pub pool_id: u8,
    pub data_id: u8,
    pub target: Pubkey,
    pub offset: usize,
    pub scale_num: u128,
    pub scale_den: u128,
}

impl Driver for OffsetU64Driver {
    fn pool_id(&self) -> u8 {
        self.pool_id
    }
    fn data_id(&self) -> u8 {
        self.data_id
    }
    fn target_account(&self) -> Pubkey {
        self.target
    }
    fn decode(&self, data: &[u8]) -> Result<u64> {
        ensure!(
            data.len() >= self.offset + 8,
            "account ({} bytes) too small for offset {}",
            data.len(),
            self.offset
        );
        let raw = u64::from_le_bytes(data[self.offset..self.offset + 8].try_into().unwrap());
        Ok(((raw as u128 * self.scale_num) / self.scale_den.max(1)) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offset_decode_rescales() {
        let d = OffsetU64Driver {
            pool_id: 1,
            data_id: 0,
            target: Pubkey::new_unique(),
            offset: 8,
            scale_num: 1,
            scale_den: 1,
        };
        let mut buf = vec![0u8; 16];
        buf[8..16].copy_from_slice(&525u64.to_le_bytes());
        assert_eq!(d.decode(&buf).unwrap(), 525);
    }
}

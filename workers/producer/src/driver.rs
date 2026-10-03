use anyhow::Result;
use solana_sdk::pubkey::Pubkey;

/// A producer driver is 1:1 with a `DataFeed`. It knows how to read *one* venue
/// account and decode *one* metric deterministically into fixed-point basis
/// points. A driver that decodes Kamino main USDC APY knows nothing else; drivers
/// ship independently, so a schema change in one protocol only re-ships its driver.
pub trait Driver: Send + Sync {
    fn pool_id(&self) -> u8;
    fn data_id(&self) -> u8;
    /// The on-chain venue account this driver reads (accounts only — no APIs).
    fn target_account(&self) -> Pubkey;
    /// Pure, deterministic decode of the raw account bytes to a bps value.
    fn decode(&self, account_data: &[u8]) -> Result<u64>;
}

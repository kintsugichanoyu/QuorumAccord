//! Environment-driven worker configuration. The only secret is the RPC URL(s)
//! and the operator signing keypair — no proprietary API keys.

use anyhow::{anyhow, ensure, Context, Result};
use solana_sdk::{pubkey::Pubkey, signature::Keypair};
use std::str::FromStr;

pub struct WorkerConfig {
    pub rpc_urls: Vec<String>,
    pub program_id: Pubkey,
    pub keypair: Keypair,
}

impl WorkerConfig {
    pub fn from_env() -> Result<Self> {
        let rpc_urls: Vec<String> = std::env::var("SOLANA_RPC_URL")
            .context("SOLANA_RPC_URL not set")?
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        ensure!(!rpc_urls.is_empty(), "SOLANA_RPC_URL is empty");

        let program_id = Pubkey::from_str(
            std::env::var("PROGRAM_ID")
                .context("PROGRAM_ID not set")?
                .trim(),
        )
        .context("PROGRAM_ID is not a valid pubkey")?;

        Ok(Self {
            rpc_urls,
            program_id,
            keypair: load_keypair_from_env()?,
        })
    }
}

/// Accept either a JSON byte array (the `solana-keygen` format) or a base58 key.
fn load_keypair_from_env() -> Result<Keypair> {
    let raw = std::env::var("KEYPAIR").context("KEYPAIR not set")?;
    let bytes = if raw.trim_start().starts_with('[') {
        serde_json::from_str::<Vec<u8>>(&raw).context("KEYPAIR is not a valid byte array")?
    } else {
        bs58::decode(raw.trim())
            .into_vec()
            .context("KEYPAIR is not valid base58")?
    };
    Keypair::from_bytes(&bytes).map_err(|e| anyhow!("invalid keypair bytes: {e}"))
}

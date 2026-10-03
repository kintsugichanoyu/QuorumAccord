//! RPC client pool with endpoint failover and slot-pinned reads.
//!
//! Slot pinning (`min_context_slot`) is what makes operators deterministic: every
//! honest RPC must return identical bytes for an account at a given slot, so two
//! operators reading the same anchor slot see the same input.

use anyhow::{anyhow, Result};
use solana_client::{rpc_client::RpcClient, rpc_config::RpcAccountInfoConfig};
use solana_sdk::{account::Account, commitment_config::CommitmentConfig, pubkey::Pubkey};

pub struct RpcPool {
    clients: Vec<RpcClient>,
}

impl RpcPool {
    pub fn new(urls: &[String]) -> Self {
        let clients = urls
            .iter()
            .map(|u| RpcClient::new_with_commitment(u.clone(), CommitmentConfig::confirmed()))
            .collect();
        Self { clients }
    }

    pub fn primary(&self) -> &RpcClient {
        &self.clients[0]
    }

    pub fn get_slot(&self) -> Result<u64> {
        self.try_each(|c| c.get_slot().map_err(|e| anyhow!(e)))
    }

    /// Read an account as of (at least) `min_slot`, trying each endpoint in turn.
    pub fn get_account_pinned(&self, key: &Pubkey, min_slot: u64) -> Result<Option<Account>> {
        let cfg = RpcAccountInfoConfig {
            commitment: Some(CommitmentConfig::confirmed()),
            min_context_slot: Some(min_slot),
            encoding: None,
            data_slice: None,
        };
        self.try_each(|c| {
            c.get_account_with_config(key, cfg.clone())
                .map(|resp| resp.value)
                .map_err(|e| anyhow!(e))
        })
    }

    fn try_each<T>(&self, f: impl Fn(&RpcClient) -> Result<T>) -> Result<T> {
        let mut last = None;
        for c in &self.clients {
            match f(c) {
                Ok(v) => return Ok(v),
                Err(e) => {
                    tracing::warn!("rpc endpoint failed, failing over: {e}");
                    last = Some(e);
                }
            }
        }
        Err(last.unwrap_or_else(|| anyhow!("no rpc endpoints configured")))
    }
}

//! Transaction submission with blockhash refresh + bounded retry.

use anyhow::{anyhow, Result};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    instruction::Instruction,
    signature::{Keypair, Signature},
    signer::Signer,
    transaction::Transaction,
};

/// Sign and confirm `ixs`, refreshing the blockhash on each attempt. Returns the
/// signature on success or the last error after `max_attempts`.
pub fn send_with_retry(
    rpc: &RpcClient,
    payer: &Keypair,
    ixs: &[Instruction],
    max_attempts: usize,
) -> Result<Signature> {
    let mut last = None;
    for attempt in 0..max_attempts.max(1) {
        let blockhash = rpc.get_latest_blockhash().map_err(|e| anyhow!(e))?;
        let tx =
            Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &[payer], blockhash);
        match rpc.send_and_confirm_transaction(&tx) {
            Ok(sig) => return Ok(sig),
            Err(e) => {
                tracing::warn!("tx attempt {attempt} failed: {e}");
                last = Some(anyhow!(e));
            }
        }
    }
    Err(last.unwrap_or_else(|| anyhow!("transaction send failed")))
}

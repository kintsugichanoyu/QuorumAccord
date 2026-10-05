//! Environment-driven worker configuration. The only secret is the RPC URL(s)
//! and the operator signing keypair — no proprietary API keys.

use anyhow::{anyhow, ensure, Context, Result};
use solana_sdk::{pubkey::Pubkey, signature::Keypair};
use std::{path::Path, str::FromStr};

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
    let raw = std::env::var("KEYPAIR").ok();
    let file = std::env::var_os("KEYPAIR_FILE").map(std::path::PathBuf::from);
    keypair_from_sources(raw.as_deref(), file.as_deref())
}

/// File-backed secrets keep the signing key out of Docker image configuration.
fn keypair_from_sources(raw: Option<&str>, file: Option<&Path>) -> Result<Keypair> {
    ensure!(
        raw.is_some() != file.is_some(),
        "set exactly one of KEYPAIR or KEYPAIR_FILE"
    );
    let contents;
    let raw = if let Some(file) = file {
        contents = std::fs::read_to_string(file).context("KEYPAIR_FILE could not be read")?;
        contents.as_str()
    } else {
        raw.expect("exactly one signing source was checked above")
    };
    let bytes = if raw.trim_start().starts_with('[') {
        serde_json::from_str::<Vec<u8>>(&raw).context("KEYPAIR is not a valid byte array")?
    } else {
        bs58::decode(raw.trim())
            .into_vec()
            .context("KEYPAIR is not valid base58")?
    };
    Keypair::try_from(bytes.as_slice()).map_err(|e| anyhow!("invalid keypair bytes: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signer::Signer;

    #[test]
    fn existing_json_and_base58_signers_remain_supported() {
        let key = Keypair::new();
        let json = serde_json::to_string(&key.to_bytes().to_vec()).unwrap();
        let base58 = bs58::encode(key.to_bytes()).into_string();
        for source in [&json, &base58] {
            assert_eq!(
                keypair_from_sources(Some(source), None).unwrap().pubkey(),
                key.pubkey()
            );
        }
    }

    #[test]
    fn missing_or_ambiguous_signing_sources_are_rejected() {
        assert!(keypair_from_sources(None, None).is_err());
        assert!(keypair_from_sources(Some("[]"), Some(Path::new("unused"))).is_err());
    }

    #[test]
    fn mounted_signer_file_is_read_as_a_solana_keypair() {
        let key = Keypair::new();
        let path = std::env::temp_dir().join(format!("quorum-key-{}.json", key.pubkey()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        use std::io::Write;
        let mut file = options.open(&path).unwrap();
        file.write_all(
            serde_json::to_string(&key.to_bytes().to_vec())
                .unwrap()
                .as_bytes(),
        )
        .unwrap();
        drop(file);
        let result = keypair_from_sources(None, Some(&path));
        std::fs::remove_file(path).unwrap();
        assert_eq!(result.unwrap().pubkey(), key.pubkey());
    }

    #[test]
    fn missing_files_and_invalid_keys_fail_without_substituting_a_signer() {
        let missing =
            std::env::temp_dir().join(format!("quorum-missing-{}.json", Pubkey::new_unique()));
        assert!(keypair_from_sources(None, Some(&missing)).is_err());
        assert!(keypair_from_sources(Some("[1,2,3]"), None).is_err());
        assert!(keypair_from_sources(Some("not a keypair"), None).is_err());
    }
}

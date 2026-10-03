//! Minimal Anchor wire-format helpers so workers don't need to depend on the
//! on-chain crate. An instruction's data is `sha256("global:<name>")[..8]`
//! followed by the borsh-encoded arguments (for scalars, little-endian bytes).

use sha2::{Digest, Sha256};

/// 8-byte Anchor instruction discriminator for `name` (the snake_case method).
pub fn ix_discriminator(name: &str) -> [u8; 8] {
    discriminator("global", name)
}

pub fn account_discriminator(name: &str) -> [u8; 8] {
    discriminator("account", name)
}

fn discriminator(namespace: &str, name: &str) -> [u8; 8] {
    let digest = Sha256::digest(format!("{namespace}:{name}").as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&digest[..8]);
    out
}

/// Discriminator + concatenated argument byte-slices.
pub fn encode(name: &str, args: &[&[u8]]) -> Vec<u8> {
    let mut data = ix_discriminator(name).to_vec();
    for a in args {
        data.extend_from_slice(a);
    }
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminator_is_stable_and_eight_bytes() {
        let d = ix_discriminator("propose_sample");
        assert_eq!(d.len(), 8);
        // recomputed value must be deterministic
        assert_eq!(d, ix_discriminator("propose_sample"));
        assert_ne!(d, ix_discriminator("finalize_sample"));
    }
}

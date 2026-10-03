//! PDA derivations — must match the on-chain seeds exactly.

use solana_sdk::pubkey::Pubkey;

pub fn registry(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"registry"], program_id)
}

pub fn data_feed(program_id: &Pubkey, pool_id: u8, data_id: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"data_feed", &[pool_id], &[data_id]], program_id)
}

pub fn tick_consensus(program_id: &Pubkey, data_feed: &Pubkey, window_index: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"tick_consensus",
            data_feed.as_ref(),
            &window_index.to_le_bytes(),
        ],
        program_id,
    )
}

pub fn allocation_consensus(program_id: &Pubkey, round: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"consensus", &round.to_le_bytes()], program_id)
}

pub fn allocation_state(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"allocation_state"], program_id)
}

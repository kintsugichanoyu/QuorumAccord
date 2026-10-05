//! Instruction builders. Account ordering and mutability/signer flags mirror the
//! on-chain `#[derive(Accounts)]` contexts exactly.

use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::{anchor_codec::encode, pda};

fn weights_bytes(weights: &[u16]) -> Vec<u8> {
    let mut v = Vec::with_capacity(weights.len() * 2);
    for w in weights {
        v.extend_from_slice(&w.to_le_bytes());
    }
    v
}

pub fn propose_sample(
    program_id: &Pubkey,
    pool_id: u8,
    data_id: u8,
    window_index: u64,
    operator: &Pubkey,
    value: u64,
    slot_at_read: u64,
) -> Instruction {
    let registry = pda::registry(program_id).0;
    let feed = pda::data_feed(program_id, pool_id, data_id).0;
    let consensus = pda::tick_consensus(program_id, &feed, window_index).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new_readonly(feed, false),
            AccountMeta::new(consensus, false),
            AccountMeta::new(*operator, true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode(
            "propose_sample",
            &[
                &window_index.to_le_bytes(),
                &value.to_le_bytes(),
                &slot_at_read.to_le_bytes(),
            ],
        ),
    }
}

pub fn corroborate_sample(
    program_id: &Pubkey,
    pool_id: u8,
    data_id: u8,
    window_index: u64,
    operator: &Pubkey,
    value: u64,
    slot_at_read: u64,
) -> Instruction {
    let registry = pda::registry(program_id).0;
    let feed = pda::data_feed(program_id, pool_id, data_id).0;
    let consensus = pda::tick_consensus(program_id, &feed, window_index).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new_readonly(feed, false),
            AccountMeta::new(consensus, false),
            AccountMeta::new_readonly(*operator, true),
        ],
        data: encode(
            "corroborate_sample",
            &[
                &window_index.to_le_bytes(),
                &value.to_le_bytes(),
                &slot_at_read.to_le_bytes(),
            ],
        ),
    }
}

pub fn finalize_sample(
    program_id: &Pubkey,
    pool_id: u8,
    data_id: u8,
    window_index: u64,
    cranker: &Pubkey,
) -> Instruction {
    let feed = pda::data_feed(program_id, pool_id, data_id).0;
    let consensus = pda::tick_consensus(program_id, &feed, window_index).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(feed, false),
            AccountMeta::new(consensus, false),
            AccountMeta::new_readonly(*cranker, true),
        ],
        data: encode("finalize_sample", &[&window_index.to_le_bytes()]),
    }
}

pub fn submit_weights(
    program_id: &Pubkey,
    round: u64,
    operator: &Pubkey,
    weights: &[u16],
) -> Instruction {
    let registry = pda::registry(program_id).0;
    let consensus = pda::allocation_consensus(program_id, round).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new(consensus, false),
            AccountMeta::new_readonly(*operator, true),
        ],
        data: encode(
            "submit_weights",
            &[&round.to_le_bytes(), &weights_bytes(weights)],
        ),
    }
}

pub fn finalize_allocation(program_id: &Pubkey, round: u64, cranker: &Pubkey) -> Instruction {
    let consensus = pda::allocation_consensus(program_id, round).0;
    let state = pda::allocation_state(program_id).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(consensus, false),
            AccountMeta::new(state, false),
            AccountMeta::new_readonly(*cranker, true),
        ],
        data: encode("finalize_allocation", &[&round.to_le_bytes()]),
    }
}

// ---- admin / setup builders ---------------------------------------------------
// These mirror the on-chain `#[derive(Accounts)]` field order and the borsh arg
// order exactly. Used by the e2e harness; the daemons never call them.

/// Trigger/aggregation config for `init_data_feed` / `update_thresholds`. Field
/// order and `to_bytes` match the on-chain `DataFeedConfig` borsh layout in
/// `programs/quorum-allocation/src/instructions/data_feed.rs`.
#[derive(Clone, Copy, Debug)]
pub struct DataFeedConfig {
    pub measurand: u8,
    pub window_slots: u32,
    pub threshold_bps: u16,
    pub min_interval_slots: u32,
    pub max_interval_slots: u32,
    pub min_number: u8,
    pub rule: u8,
    pub trim_pct: u8,
}

impl DataFeedConfig {
    fn to_bytes(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(18);
        v.push(self.measurand);
        v.extend_from_slice(&self.window_slots.to_le_bytes());
        v.extend_from_slice(&self.threshold_bps.to_le_bytes());
        v.extend_from_slice(&self.min_interval_slots.to_le_bytes());
        v.extend_from_slice(&self.max_interval_slots.to_le_bytes());
        v.push(self.min_number);
        v.push(self.rule);
        v.push(self.trim_pct);
        v
    }
}

pub fn init_registry(program_id: &Pubkey, admin: &Pubkey) -> Instruction {
    let registry = pda::registry(program_id).0;
    let loader: Pubkey = "BPFLoaderUpgradeab1e11111111111111111111111"
        .parse()
        .unwrap();
    let program_data = Pubkey::find_program_address(&[program_id.as_ref()], &loader).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(registry, false),
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(*program_id, false),
            AccountMeta::new_readonly(program_data, false),
        ],
        data: encode("init_registry", &[]),
    }
}

pub fn add_operator(program_id: &Pubkey, admin: &Pubkey, operator: &Pubkey) -> Instruction {
    mutate_operator(program_id, admin, operator, "add_operator")
}

pub fn remove_operator(program_id: &Pubkey, admin: &Pubkey, operator: &Pubkey) -> Instruction {
    mutate_operator(program_id, admin, operator, "remove_operator")
}

fn mutate_operator(
    program_id: &Pubkey,
    admin: &Pubkey,
    operator: &Pubkey,
    name: &str,
) -> Instruction {
    let registry = pda::registry(program_id).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(registry, false),
            AccountMeta::new_readonly(*admin, true),
        ],
        data: encode(name, &[&operator.to_bytes()]),
    }
}

pub fn init_data_feed(
    program_id: &Pubkey,
    admin: &Pubkey,
    pool_id: u8,
    data_id: u8,
    config: &DataFeedConfig,
) -> Instruction {
    let registry = pda::registry(program_id).0;
    let feed = pda::data_feed(program_id, pool_id, data_id).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new(feed, false),
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode(
            "init_data_feed",
            &[&[pool_id], &[data_id], &config.to_bytes()],
        ),
    }
}

pub fn update_thresholds(
    program_id: &Pubkey,
    admin: &Pubkey,
    pool_id: u8,
    data_id: u8,
    config: &DataFeedConfig,
) -> Instruction {
    let registry = pda::registry(program_id).0;
    let feed = pda::data_feed(program_id, pool_id, data_id).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new(feed, false),
            AccountMeta::new_readonly(*admin, true),
        ],
        data: encode("update_thresholds", &[&config.to_bytes()]),
    }
}

pub fn init_allocation_state(program_id: &Pubkey, admin: &Pubkey) -> Instruction {
    let registry = pda::registry(program_id).0;
    let state = pda::allocation_state(program_id).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new(state, false),
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode("init_allocation_state", &[]),
    }
}

pub fn open_allocation_round(
    program_id: &Pubkey,
    admin: &Pubkey,
    round: u64,
    closes_at_slot: u64,
    min_number: u8,
    rule: u8,
    trim_pct: u8,
) -> Instruction {
    let registry = pda::registry(program_id).0;
    let consensus = pda::allocation_consensus(program_id, round).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new(consensus, false),
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode(
            "open_allocation_round",
            &[
                &round.to_le_bytes(),
                &closes_at_slot.to_le_bytes(),
                &[min_number],
                &[rule],
                &[trim_pct],
            ],
        ),
    }
}

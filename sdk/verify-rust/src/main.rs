//! Devnet-only transport for exercising the generated Rust client.
use base64::{engine::general_purpose::STANDARD, Engine};
use quorum_client::{accounts::*, instructions::*, types::DataFeedConfig, QUORUM_ALLOCATION_ID};
use serde_json::{json, Value};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{read_keypair_file, Signer},
    transaction::Transaction,
};
use std::{
    error::Error,
    io::{self, Read},
    str::FromStr,
    time::Duration,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const GENESIS: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .ok_or_else(|| format!("missing string: {key}").into())
}
fn number(v: &Value, key: &str) -> Result<u64> {
    if let Some(s) = v[key].as_str() {
        return Ok(s.parse()?);
    }
    v[key]
        .as_u64()
        .ok_or_else(|| format!("missing integer: {key}").into())
}
fn config(v: &Value) -> Result<DataFeedConfig> {
    Ok(DataFeedConfig {
        measurand: number(v, "measurand")?.try_into()?,
        window_slots: number(v, "window_slots")?.try_into()?,
        threshold_bps: number(v, "threshold_bps")?.try_into()?,
        min_interval_slots: number(v, "min_interval_slots")?.try_into()?,
        max_interval_slots: number(v, "max_interval_slots")?.try_into()?,
        min_number: number(v, "min_number")?.try_into()?,
        rule: number(v, "rule")?.try_into()?,
        trim_pct: number(v, "trim_pct")?.try_into()?,
    })
}
fn instruction(v: &Value) -> Result<Instruction> {
    let a = &v["accounts"];
    let p = &v["params"];
    let address = |key: &str| -> Result<_> { Ok(text(a, key)?.parse()?) };
    let operator_arg = || -> Result<_> { Ok(text(p, "operator")?.parse()?) };
    let generated = match text(v, "instruction")? {
        "init_registry" => InitRegistry {
            registry: address("registry")?,
            admin: address("admin")?,
            system_program: address("system_program")?,
            program: address("program")?,
            program_data: address("program_data")?,
        }
        .instruction(),
        "add_operator" => AddOperator {
            registry: address("registry")?,
            admin: address("admin")?,
        }
        .instruction(AddOperatorInstructionArgs {
            operator: operator_arg()?,
        }),
        "remove_operator" => RemoveOperator {
            registry: address("registry")?,
            admin: address("admin")?,
        }
        .instruction(RemoveOperatorInstructionArgs {
            operator: operator_arg()?,
        }),
        "init_data_feed" => InitDataFeed {
            registry: address("registry")?,
            data_feed: address("data_feed")?,
            admin: address("admin")?,
            system_program: address("system_program")?,
        }
        .instruction(InitDataFeedInstructionArgs {
            pool_id: number(p, "pool_id")?.try_into()?,
            data_id: number(p, "data_id")?.try_into()?,
            config: config(&p["config"])?,
        }),
        "update_thresholds" => UpdateThresholds {
            registry: address("registry")?,
            data_feed: address("data_feed")?,
            admin: address("admin")?,
        }
        .instruction(UpdateThresholdsInstructionArgs {
            config: config(&p["config"])?,
        }),
        "propose_sample" => ProposeSample {
            registry: address("registry")?,
            data_feed: address("data_feed")?,
            consensus: address("consensus")?,
            operator: address("operator")?,
            system_program: address("system_program")?,
        }
        .instruction(ProposeSampleInstructionArgs {
            window_index: number(p, "window_index")?,
            value: number(p, "value")?,
            slot_at_read: number(p, "slot_at_read")?,
        }),
        "corroborate_sample" => CorroborateSample {
            registry: address("registry")?,
            data_feed: address("data_feed")?,
            consensus: address("consensus")?,
            operator: address("operator")?,
        }
        .instruction(CorroborateSampleInstructionArgs {
            window_index: number(p, "window_index")?,
            value: number(p, "value")?,
            slot_at_read: number(p, "slot_at_read")?,
        }),
        "finalize_sample" => FinalizeSample {
            data_feed: address("data_feed")?,
            consensus: address("consensus")?,
            cranker: address("cranker")?,
        }
        .instruction(FinalizeSampleInstructionArgs {
            window_index: number(p, "window_index")?,
        }),
        "init_allocation_state" => InitAllocationState {
            registry: address("registry")?,
            allocation_state: address("allocation_state")?,
            admin: address("admin")?,
            system_program: address("system_program")?,
        }
        .instruction(),
        "open_allocation_round" => OpenAllocationRound {
            registry: address("registry")?,
            consensus: address("consensus")?,
            admin: address("admin")?,
            system_program: address("system_program")?,
        }
        .instruction(OpenAllocationRoundInstructionArgs {
            round: number(p, "round")?,
            closes_at_slot: number(p, "closes_at_slot")?,
            min_number: number(p, "min_number")?.try_into()?,
            rule: number(p, "rule")?.try_into()?,
            trim_pct: number(p, "trim_pct")?.try_into()?,
        }),
        "submit_weights" => {
            let weights: Vec<u16> = p["weights"]
                .as_array()
                .ok_or("missing weights")?
                .iter()
                .map(|n| {
                    n.as_u64()
                        .ok_or("weight must be u16")
                        .and_then(|n| u16::try_from(n).map_err(|_| "weight must be u16"))
                })
                .collect::<std::result::Result<_, _>>()?;
            SubmitWeights {
                registry: address("registry")?,
                consensus: address("consensus")?,
                operator: address("operator")?,
            }
            .instruction(SubmitWeightsInstructionArgs {
                round: number(p, "round")?,
                weights: weights.try_into().map_err(|_| "expected 16 weights")?,
            })
        }
        "finalize_allocation" => FinalizeAllocation {
            consensus: address("consensus")?,
            allocation_state: address("allocation_state")?,
            cranker: address("cranker")?,
        }
        .instruction(FinalizeAllocationInstructionArgs {
            round: number(p, "round")?,
        }),
        other => return Err(format!("unsupported instruction: {other}").into()),
    };
    // Preserve bytes and account privileges when using the existing Agave 2.x transport.
    Ok(Instruction {
        program_id: Pubkey::new_from_array(generated.program_id.to_bytes()),
        data: generated.data,
        accounts: generated
            .accounts
            .into_iter()
            .map(|a| AccountMeta {
                pubkey: Pubkey::new_from_array(a.pubkey.to_bytes()),
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            })
            .collect(),
    })
}

fn decode(kind: &str, data: &[u8]) -> Result<Value> {
    macro_rules! account {
        ($ty:ident, $disc:ident) => {{
            if data.get(..8) != Some($disc.as_slice()) {
                return Err("account discriminator mismatch".into());
            }
            $ty::from_bytes(data)?
        }};
    }
    Ok(match kind {
        "registry" => {
            let d = account!(OperatorRegistry, OPERATOR_REGISTRY_DISCRIMINATOR);
            if usize::from(d.count) > d.operators.len() {
                return Err("invalid operator count".into());
            }
            json!({"admin":d.admin.to_string(),"count":d.count,"operators":d.operators[..usize::from(d.count)].iter().map(ToString::to_string).collect::<Vec<_>>()})
        }
        "feed" => {
            let d = account!(DataFeed, DATA_FEED_DISCRIMINATOR);
            if usize::from(d.head) >= d.ring.len() {
                return Err("invalid ring head".into());
            }
            let last = &d.ring[(usize::from(d.head) + 255) % 256];
            json!({"tick":d.tick.to_string(),"last_value":d.last_value.to_string(),"last_finalized_slot":d.last_finalized_slot.to_string(),
                "pool_id":d.pool_id,"data_id":d.data_id,"window_slots":d.window_slots,"threshold_bps":d.threshold_bps,
                "latest":{"value":last.value.to_string(),"slot":last.slot.to_string(),"tick":last.tick.to_string(),"ts":last.ts.to_string()}})
        }
        "sample" => {
            let d = account!(DataFeedConsensus, DATA_FEED_CONSENSUS_DISCRIMINATOR);
            if usize::from(d.count) > d.submissions.len() {
                return Err("invalid sample count".into());
            }
            json!({"window":d.window_index.to_string(),"status":d.status,"count":d.count,"output":d.output.to_string(),
                "submissions":d.submissions[..usize::from(d.count)].iter().map(|s|json!({"operator":s.submitter.to_string(),"value":s.value.to_string()})).collect::<Vec<_>>()})
        }
        "allocation" => {
            let d = account!(AllocationState, ALLOCATION_STATE_DISCRIMINATOR);
            json!({"round":d.round.to_string(),"updated_slot":d.updated_slot.to_string(),"weights":d.weights})
        }
        "allocation_consensus" => {
            let d = account!(AllocationConsensus, ALLOCATION_CONSENSUS_DISCRIMINATOR);
            if usize::from(d.count) > d.submissions.len() {
                return Err("invalid allocation count".into());
            }
            json!({"round":d.round.to_string(),"status":d.status,"count":d.count,"output":d.output,
                "submissions":d.submissions[..usize::from(d.count)].iter().map(|s|json!({"operator":s.submitter.to_string(),"weights":s.weights})).collect::<Vec<_>>()})
        }
        _ => return Err("unsupported account type".into()),
    })
}
fn main() -> Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let v: Value = serde_json::from_str(&input)?;
    let command = text(&v, "command")?;
    let result = if command == "instruction" {
        let ix = instruction(&v)?;
        json!({"program":ix.program_id.to_string(),"data":STANDARD.encode(&ix.data),
            "accounts":ix.accounts.iter().map(|a|json!({"address":a.pubkey.to_string(),"signer":a.is_signer,"writable":a.is_writable})).collect::<Vec<_>>()})
    } else if command == "decode_bytes" {
        decode(text(&v, "kind")?, &STANDARD.decode(text(&v, "data")?)?)?
    } else {
        let rpc = RpcClient::new_with_timeout_and_commitment(
            text(&v, "rpc_url")?.to_string(),
            Duration::from_secs(60),
            CommitmentConfig::confirmed(),
        );
        if rpc.get_genesis_hash()?.to_string() != GENESIS {
            return Err("refusing non-devnet RPC".into());
        }
        match command {
            "send" => {
                let ix = instruction(&v)?;
                let key = read_keypair_file(text(&v, "keypair_file")?)?;
                let tx = Transaction::new_signed_with_payer(
                    &[ix],
                    Some(&key.pubkey()),
                    &[&key],
                    rpc.get_latest_blockhash()?,
                );
                json!({"signature":rpc.send_and_confirm_transaction(&tx)?.to_string()})
            }
            "read" => {
                let pk = Pubkey::from_str(text(&v, "address")?)?;
                let account = rpc.get_account(&pk)?;
                if account.owner.to_bytes() != QUORUM_ALLOCATION_ID.to_bytes() {
                    return Err("account owner mismatch".into());
                }
                decode(text(&v, "kind")?, &account.data)?
            }
            _ => return Err("unsupported command".into()),
        }
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

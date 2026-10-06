//! Reads public RPC accounts only. This executable cannot sign or send transactions.
use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use klend_interface::{pda, state::LendingMarket, KLEND_PROGRAM_ID};
use quorum_kamino_probe::{
    decode_reserve, total_supply_sf, utilization_bps, MARKET, MINT, RESERVE,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    account::Account,
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    clock::Clock,
    commitment_config::CommitmentConfig,
    program_pack::Pack,
    pubkey::Pubkey,
    sysvar,
};
use spl_token::state::{Account as TokenAccount, Mint};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SOURCE_REV: &str = "a08760976f51a3a58c4a0c6ea27b4a0e565bca79";
fn sha(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}
fn write_new(path: &PathBuf, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    writeln!(file, "{}", serde_json::to_string_pretty(value)?)?;
    Ok(())
}
fn metadata(key: &Pubkey, account: &Account) -> Value {
    json!({"address":key.to_string(),"owner":account.owner.to_string(),"executable":account.executable,
        "bytes":account.data.len(),"sha256":sha(&account.data)})
}
fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let mut network = None;
    let mut output = None;
    let mut fixtures = None;
    let mut release = None;
    while let Some(arg) = args.next() {
        let value = args.next().context("each option requires a value")?;
        match arg.as_str() {
            "--network" => network = Some(value),
            "--output" => output = Some(PathBuf::from(value)),
            "--fixtures" => fixtures = Some(PathBuf::from(value)),
            "--release-binary" => release = Some(PathBuf::from(value)),
            _ => bail!("unknown option: {arg}"),
        }
    }
    let network = network.context("explicit --network mainnet or devnet required")?;
    let (endpoint, genesis) = match network.as_str() {
        "mainnet" => (
            "https://api.mainnet-beta.solana.com",
            "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
        ),
        "devnet" => (
            "https://api.devnet.solana.com",
            "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
        ),
        _ => bail!("unsupported network"),
    };
    let endpoint = std::env::var("QUORUM_KAMINO_RPC_URL").unwrap_or_else(|_| endpoint.into());
    let rpc = RpcClient::new_with_timeout_and_commitment(
        endpoint,
        Duration::from_secs(60),
        CommitmentConfig::confirmed(),
    );
    ensure!(
        rpc.get_genesis_hash()?.to_string() == genesis,
        "RPC genesis does not match requested network"
    );
    let reserve_key: Pubkey = RESERVE.parse()?;
    let market_key: Pubkey = MARKET.parse()?;
    let mint_key: Pubkey = MINT.parse()?;
    let initial_keys = [KLEND_PROGRAM_ID, reserve_key, market_key, mint_key];
    let first =
        rpc.get_multiple_accounts_with_commitment(&initial_keys, CommitmentConfig::confirmed())?;
    let mut report = json!({"schema_version":1,"network":network,"genesis":genesis,"read_only":true,
        "observed_unix_seconds":SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        "source":{"repository":"https://github.com/Kamino-Finance/klend","revision":SOURCE_REV,"release":"release/v1.25.0","interface":"0.8.0"},
        "initial_context_slot":first.context.slot});
    if first.value.iter().any(Option::is_none) {
        report["status"] = json!("selected_accounts_absent");
        report["accounts"] = json!(initial_keys.iter().zip(&first.value).map(|(key,acct)|json!({
            "address":key.to_string(),"exists":acct.is_some(),"owner":acct.as_ref().map(|a|a.owner.to_string()),
            "executable":acct.as_ref().map(|a|a.executable)})).collect::<Vec<_>>());
        if let Some(path) = output {
            write_new(&path, &report)?;
        }
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }
    let initial_reserve = decode_reserve(&reserve_key, first.value[1].as_ref().unwrap())?;
    let liquidity = &initial_reserve.liquidity;
    let mut labels = vec![
        "program",
        "reserve",
        "market",
        "mint",
        "clock",
        "supply_vault",
        "fee_vault",
        "collateral_mint",
        "collateral_vault",
    ];
    let mut keys = vec![
        KLEND_PROGRAM_ID,
        reserve_key,
        market_key,
        mint_key,
        sysvar::clock::id(),
        liquidity.supply_vault,
        liquidity.fee_vault,
        initial_reserve.collateral.mint_pubkey,
        initial_reserve.collateral.supply_vault,
    ];
    let info = &initial_reserve.config.token_info;
    for (label, key) in [
        ("pyth_oracle", info.pyth_configuration.price),
        (
            "switchboard_price_oracle",
            info.switchboard_configuration.price_aggregator,
        ),
        (
            "switchboard_twap_oracle",
            info.switchboard_configuration.twap_aggregator,
        ),
        ("scope_prices", info.scope_configuration.price_feed),
    ] {
        if key != Pubkey::default() {
            labels.push(label);
            keys.push(key);
        }
    }
    let batch = rpc.get_multiple_accounts_with_commitment(&keys, CommitmentConfig::confirmed())?;
    ensure!(
        batch.context.slot >= first.context.slot,
        "RPC observation regressed"
    );
    let accounts: Vec<Account> = batch
        .value
        .into_iter()
        .enumerate()
        .map(|(i, a)| a.with_context(|| format!("missing {}", labels[i])))
        .collect::<Result<_>>()?;
    let reserve = decode_reserve(&reserve_key, &accounts[1])?;
    ensure!(
        reserve.liquidity.supply_vault == keys[5]
            && reserve.liquidity.fee_vault == keys[6]
            && reserve.collateral.mint_pubkey == keys[7]
            && reserve.collateral.supply_vault == keys[8],
        "reserve relationships changed between reads"
    );
    let current_info = &reserve.config.token_info;
    for (label, key) in [
        ("pyth_oracle", current_info.pyth_configuration.price),
        (
            "switchboard_price_oracle",
            current_info.switchboard_configuration.price_aggregator,
        ),
        (
            "switchboard_twap_oracle",
            current_info.switchboard_configuration.twap_aggregator,
        ),
        ("scope_prices", current_info.scope_configuration.price_feed),
    ] {
        ensure!(
            labels.iter().position(|l| *l == label).map(|i| keys[i])
                == (key != Pubkey::default()).then_some(key),
            "oracle configuration changed between reads"
        );
    }
    ensure!(
        accounts[0].executable && accounts[0].owner == bpf_loader_upgradeable::id(),
        "unexpected program deployment"
    );
    ensure!(
        accounts[2].owner == KLEND_PROGRAM_ID && !accounts[2].executable,
        "wrong market owner/type"
    );
    ensure!(
        accounts[2].data.len() == 8 + size_of::<LendingMarket>(),
        "unsupported market length"
    );
    let market = klend_interface::from_account_data::<LendingMarket>(&accounts[2].data)?;
    ensure!(market.version == 1, "unsupported market version");
    let (authority, bump) = pda::lending_market_authority(&KLEND_PROGRAM_ID, &market_key);
    ensure!(
        market.bump_seed == u64::from(bump),
        "wrong market authority bump"
    );
    let vault_pdas = pda::ReservePdas::derive(&KLEND_PROGRAM_ID, &reserve_key);
    // Existing reserve addresses need not follow today's init-reserve namespace.
    // Bind them to canonical reserve state and check token mint/authority below.
    report["current_init_pda_comparison"] = json!([
        (keys[5], vault_pdas.liquidity_supply_vault), (keys[6], vault_pdas.fee_vault),
        (keys[7], vault_pdas.collateral_mint), (keys[8], vault_pdas.collateral_supply_vault)
    ].iter().enumerate().map(|(i,(actual,derived))|json!({"role":labels[i+5],
        "actual":actual.to_string(),"current_init_derived":derived.to_string(),"matches":actual == derived})).collect::<Vec<_>>());
    ensure!(
        reserve.liquidity.token_program == spl_token::id(),
        "this probe supports classic SPL Token only"
    );
    for i in [3, 5, 6, 7, 8] {
        ensure!(
            accounts[i].owner == spl_token::id() && !accounts[i].executable,
            "wrong token account owner/type"
        );
    }
    let mint = Mint::unpack(&accounts[3].data)?;
    ensure!(
        mint.decimals == 6 && mint.is_initialized,
        "wrong mint decimals/state"
    );
    let collateral = Mint::unpack(&accounts[7].data)?;
    ensure!(
        collateral.mint_authority.contains(&authority),
        "wrong collateral mint authority"
    );
    report["collateral_supply_comparison"] = json!({
        "mint_supply_base_units":collateral.supply.to_string(),
        "reserve_recorded_base_units":reserve.collateral.mint_total_supply.to_string(),
        "equal":collateral.supply == reserve.collateral.mint_total_supply,
        "difference_cause":"not established by this account snapshot",
        "exchange_rate_denominator":"reserve.collateral.mint_total_supply, per upstream calculation"
    });
    ensure!(
        collateral.supply <= reserve.collateral.mint_total_supply,
        "mint supply exceeds recorded collateral supply"
    );
    for (index, expected_mint) in [(5, mint_key), (6, mint_key), (8, keys[7])] {
        let token = TokenAccount::unpack(&accounts[index].data)?;
        ensure!(
            token.mint == expected_mint && token.owner == authority,
            "wrong token mint/authority"
        );
    }
    let supply_vault = TokenAccount::unpack(&accounts[5].data)?;
    let accounted_balance = reserve
        .liquidity
        .total_available_amount
        .checked_add(reserve.liquidity.rewards_amount_available)
        .context("vault accounting overflow")?;
    ensure!(
        supply_vault.amount >= accounted_balance,
        "vault balance below accounted liquidity/rewards"
    );
    ensure!(accounts[4].owner == sysvar::id(), "wrong clock owner");
    let clock: Clock = bincode::deserialize(&accounts[4].data)?;
    ensure!(
        reserve.last_update.slot <= clock.slot && clock.slot <= batch.context.slot,
        "invalid source/clock slot ordering"
    );
    let source_age_slots = clock.slot - reserve.last_update.slot;
    let supply = total_supply_sf(&reserve)?;
    let borrowed = reserve.borrowed_amount();
    let utilization = utilization_bps(borrowed, supply)?;
    let loader_state: UpgradeableLoaderState = bincode::deserialize(&accounts[0].data)?;
    let programdata_address = match loader_state {
        UpgradeableLoaderState::Program {
            programdata_address,
        } => programdata_address,
        _ => bail!("unexpected loader program state"),
    };
    ensure!(
        programdata_address
            == Pubkey::find_program_address(
                &[KLEND_PROGRAM_ID.as_ref()],
                &bpf_loader_upgradeable::id()
            )
            .0,
        "wrong ProgramData PDA"
    );
    let programdata = rpc.get_account(&programdata_address)?;
    ensure!(
        programdata.owner == bpf_loader_upgradeable::id(),
        "wrong ProgramData owner"
    );
    let header = UpgradeableLoaderState::size_of_programdata_metadata();
    ensure!(programdata.data.len() >= header, "truncated ProgramData");
    let (deployed_slot, upgrade_authority) =
        match bincode::deserialize(&programdata.data[..header])? {
            UpgradeableLoaderState::ProgramData {
                slot,
                upgrade_authority_address,
            } => (slot, upgrade_authority_address),
            _ => bail!("unexpected ProgramData state"),
        };
    let code = &programdata.data[header..];
    let mut deployment = json!({"programdata":programdata_address.to_string(),"last_deployed_slot":deployed_slot,
        "upgrade_authority":upgrade_authority.map(|k|k.to_string()),"allocated_bytecode_bytes":code.len(),"allocated_bytecode_sha256":sha(code),
        "source_build_equivalence":"not established; a source build was not reproduced"});
    if let Some(path) = release {
        let binary = fs::read(path)?;
        ensure!(
            binary.len() == 2_431_968
                && sha(&binary)
                    == "ac5a94790923b0a8cccb981e6f20b5bbb4a67ae35490b685db3009b144771009",
            "release binary does not match the pinned official artifact"
        );
        let matches = code.starts_with(&binary)
            && code[binary.len().min(code.len())..].iter().all(|b| *b == 0);
        deployment["official_release_binary"] = json!({"bytes":binary.len(),"sha256":sha(&binary),"matches_deployed_code_with_zero_padding":matches});
    }
    report["status"] = json!("identity_and_layout_verified");
    report["context_slot"] = json!(batch.context.slot);
    report["accounts"] = json!(keys
        .iter()
        .zip(&accounts)
        .enumerate()
        .map(|(i, (key, a))| {
            let mut v = metadata(key, a);
            v["role"] = json!(labels[i]);
            v
        })
        .collect::<Vec<_>>());
    report["deployment"] = deployment;
    report["checks"] = json!([
        "network genesis",
        "executable program and loader linkage",
        "reserve address/owner/discriminator/length/version",
        "market address/owner/discriminator/length/version",
        "USDC mint and decimals",
        "market authority bump",
        "vault/mint addresses from canonical reserve state",
        "token account owners/mints/authorities",
        "collateral mint authority and supply upper bound",
        "vault liquidity/reward coverage",
        "source/clock slot ordering",
        "checked net supply and utilization math"
    ]);
    report["reserve_state"] = json!({"version":reserve.version,"status":reserve.config.status,
        "reserve_emergency_mode":reserve.config.emergency_mode,"market_emergency_mode":market.emergency_mode,
        "interest_rate_basis":reserve.config.interest_rate_basis,"last_update_slot":reserve.last_update.slot,
        "last_update_timestamp":reserve.last_update.timestamp,"stale_flag":reserve.last_update.stale,"price_status":reserve.last_update.price_status,
        "source_age_slots":source_age_slots,"clock_slot":clock.slot,"clock_unix_timestamp":clock.unix_timestamp,
        "mint_decimals":mint.decimals,"total_available_base_units":reserve.liquidity.total_available_amount.to_string(),
        "supply_vault_base_units":supply_vault.amount.to_string(),"rewards_available_base_units":reserve.liquidity.rewards_amount_available.to_string(),
        "borrowed_amount_sf":borrowed.to_string(),"net_supply_sf":supply.to_string(),"fraction_scale":"1152921504606846976",
        "protocol_fees_sf":reserve.accumulated_protocol_fees().to_string(),"referrer_fees_sf":reserve.accumulated_referrer_fees().to_string(),
        "pending_referrer_fees_sf":u128::from(reserve.liquidity.pending_referrer_fees_sf).to_string(),"utilization_bps_floor":utilization,
        "deposit_limit_base_units":reserve.config.deposit_limit.to_string(),"borrow_limit_base_units":reserve.config.borrow_limit.to_string(),
        "queued_collateral_base_units":reserve.withdraw_queue.queued_collateral_amount.to_string(),
        "base_metric_freshness_gate_passes":reserve.last_update.stale == 0 && source_age_slots == 0,
        "publication":"none; diagnostic stored-state calculation only"});
    if let Some(path) = fixtures {
        write_new(
            &path,
            &json!({"network":network,"genesis":genesis,"context_slot":batch.context.slot,
            "source_revision":SOURCE_REV,"accounts":keys.iter().zip(&accounts).enumerate().map(|(i,(key,acct))|json!({
                "role":labels[i],"address":key.to_string(),"owner":acct.owner.to_string(),"executable":acct.executable,
                "lamports":acct.lamports,"data_base64":STANDARD.encode(&acct.data),"sha256":sha(&acct.data)})).collect::<Vec<_>>() }),
        )?;
    }
    if let Some(path) = output {
        write_new(&path, &report)?;
    }
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
fn main() -> Result<()> {
    run()
}

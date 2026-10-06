//! Research-only parsing and checked arithmetic. No signing or transaction submission.
//! The reference dependency has its own Business Source License; see ../../README.md.
use anyhow::{ensure, Context, Result};
use klend_interface::{state::Reserve, FRACTION_ONE_SCALED, KLEND_PROGRAM_ID};
use solana_sdk::{account::Account, pubkey::Pubkey};

pub const MARKET: &str = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
pub const RESERVE: &str = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
pub const MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

pub fn decode_reserve(address: &Pubkey, account: &Account) -> Result<Reserve> {
    ensure!(address.to_string() == RESERVE, "unexpected reserve address");
    ensure!(account.owner == KLEND_PROGRAM_ID, "wrong reserve owner");
    ensure!(!account.executable, "reserve must not be executable");
    ensure!(
        account.data.len() == 8 + size_of::<Reserve>(),
        "unsupported reserve length"
    );
    let reserve = *klend_interface::from_account_data::<Reserve>(&account.data)?;
    ensure!(reserve.version == 1, "unsupported reserve version");
    ensure!(
        reserve.lending_market.to_string() == MARKET,
        "wrong lending market"
    );
    ensure!(
        reserve.liquidity.mint_pubkey.to_string() == MINT,
        "wrong liquidity mint"
    );
    ensure!(
        reserve.liquidity.mint_decimals == 6,
        "unexpected mint decimals"
    );
    ensure!(reserve.last_update.stale <= 1, "invalid stale flag");
    ensure!(reserve.config.status <= 2, "unknown reserve status");
    ensure!(
        reserve.config.interest_rate_basis <= 1,
        "unknown interest rate basis"
    );
    Ok(reserve)
}

/// Mirrors the reference total_supply definition, including all three fee fields.
pub fn total_supply_sf(reserve: &Reserve) -> Result<u128> {
    let l = &reserve.liquidity;
    let gross = u128::from(l.total_available_amount)
        .checked_mul(FRACTION_ONE_SCALED)
        .and_then(|n| n.checked_add(u128::from(l.borrowed_amount_sf)))
        .context("total supply overflow")?;
    let mut total = gross;
    for fee in [
        l.accumulated_protocol_fees_sf,
        l.accumulated_referrer_fees_sf,
        l.pending_referrer_fees_sf,
    ] {
        total = total
            .checked_sub(u128::from(fee))
            .context("fees exceed gross supply")?;
    }
    Ok(total)
}

/// floor(borrowed * 10_000 / net_supply), without overflowing a u128 numerator.
/// This diagnostic rejects utilization above 100%; zero/zero follows upstream's zero convention.
pub fn utilization_bps(borrowed: u128, supply: u128) -> Result<u64> {
    if supply == 0 {
        ensure!(borrowed == 0, "borrowed amount with zero supply");
        return Ok(0);
    }
    ensure!(
        borrowed <= supply,
        "utilization exceeds 100%; policy required"
    );
    let mut remainder = borrowed % supply;
    let mut quotient = borrowed / supply;
    // Four decimal places, multiplying a remainder by ten through modular addition.
    for _ in 0..4 {
        let previous = remainder;
        remainder = 0;
        let mut digit = 0;
        for _ in 0..10 {
            if remainder >= supply - previous {
                remainder -= supply - previous;
                digit += 1;
            } else {
                remainder += previous;
            }
        }
        quotient = quotient * 10 + digit;
    }
    Ok(quotient.try_into()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytemuck::Zeroable;
    use klend_interface::state::SplDiscriminate;

    fn fixture() -> (Pubkey, Account) {
        let mut reserve = Reserve::zeroed();
        reserve.version = 1;
        reserve.lending_market = MARKET.parse().unwrap();
        reserve.liquidity.mint_pubkey = MINT.parse().unwrap();
        reserve.liquidity.mint_decimals = 6;
        let mut data = Reserve::SPL_DISCRIMINATOR_SLICE.to_vec();
        data.extend_from_slice(bytemuck::bytes_of(&reserve));
        (
            RESERVE.parse().unwrap(),
            Account {
                data,
                owner: KLEND_PROGRAM_ID,
                ..Account::default()
            },
        )
    }

    #[test]
    fn identity_and_layout_rejections() {
        let (key, account) = fixture();
        assert!(decode_reserve(&key, &account).is_ok());
        assert!(decode_reserve(&Pubkey::new_unique(), &account).is_err());
        let mut bad = account.clone();
        bad.owner = Pubkey::new_unique();
        assert!(decode_reserve(&key, &bad).is_err());
        let mut bad = account.clone();
        bad.data[0] ^= 1;
        assert!(decode_reserve(&key, &bad).is_err());
        let mut bad = account.clone();
        bad.data.pop();
        assert!(decode_reserve(&key, &bad).is_err());
        let mut bad = account.clone();
        bad.data.push(0);
        assert!(decode_reserve(&key, &bad).is_err());
        let mut bad = account.clone();
        bad.data[8] = 2;
        assert!(decode_reserve(&key, &bad).is_err());
        let mut bad = account.clone();
        bad.data[32] ^= 1;
        assert!(decode_reserve(&key, &bad).is_err());
        let mut bad = account;
        bad.data[128] ^= 1;
        assert!(decode_reserve(&key, &bad).is_err());
    }

    #[test]
    fn fees_change_utilization_and_invalid_supply_fails() {
        let mut r = Reserve::zeroed();
        r.liquidity.total_available_amount = 60;
        r.liquidity.borrowed_amount_sf = (40 * FRACTION_ONE_SCALED).into();
        r.liquidity.accumulated_protocol_fees_sf = (2 * FRACTION_ONE_SCALED).into();
        r.liquidity.accumulated_referrer_fees_sf = (3 * FRACTION_ONE_SCALED).into();
        r.liquidity.pending_referrer_fees_sf = (5 * FRACTION_ONE_SCALED).into();
        assert_eq!(total_supply_sf(&r).unwrap(), 90 * FRACTION_ONE_SCALED);
        assert_eq!(
            utilization_bps(r.borrowed_amount(), total_supply_sf(&r).unwrap()).unwrap(),
            4444
        );
        r.liquidity.pending_referrer_fees_sf = u128::MAX.into();
        assert!(total_supply_sf(&r).is_err());
        r.liquidity.borrowed_amount_sf = u128::MAX.into();
        assert!(total_supply_sf(&r).is_err());
    }

    #[test]
    fn captured_mainnet_reserve_replays_exactly() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let snapshot: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/mainnet-2026-10-06.json")).unwrap();
        let row = snapshot["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["role"] == "reserve")
            .unwrap();
        let account = Account {
            owner: row["owner"].as_str().unwrap().parse().unwrap(),
            data: STANDARD
                .decode(row["data_base64"].as_str().unwrap())
                .unwrap(),
            ..Account::default()
        };
        let reserve = decode_reserve(&RESERVE.parse().unwrap(), &account).unwrap();
        assert_eq!(snapshot["context_slot"], 453902424u64);
        assert_eq!(account.data.len(), 8624);
        assert_eq!(reserve.available_liquidity(), 10591501905817);
        assert_eq!(reserve.config.interest_rate_basis, 1);
        assert_eq!(reserve.last_update.slot, 453902416);
        assert_eq!(
            total_supply_sf(&reserve).unwrap(),
            140049682205715988099002813990970
        );
        assert_eq!(
            utilization_bps(
                reserve.borrowed_amount(),
                total_supply_sf(&reserve).unwrap()
            )
            .unwrap(),
            9147
        );
    }

    #[test]
    fn exact_integer_ratio_handles_u128_limits_and_empty_reserves() {
        assert_eq!(utilization_bps(0, 0).unwrap(), 0);
        assert_eq!(utilization_bps(1, 3).unwrap(), 3333);
        assert_eq!(utilization_bps(u128::MAX, u128::MAX).unwrap(), 10000);
        assert_eq!(utilization_bps(u128::MAX / 2, u128::MAX).unwrap(), 4999);
        assert!(utilization_bps(1, 0).is_err());
        assert!(utilization_bps(2, 1).is_err());
        for supply in 1..1000 {
            for borrowed in [0, supply / 3, supply / 2, supply] {
                assert_eq!(
                    u128::from(utilization_bps(borrowed, supply).unwrap()),
                    borrowed * 10000 / supply
                );
            }
        }
    }
}

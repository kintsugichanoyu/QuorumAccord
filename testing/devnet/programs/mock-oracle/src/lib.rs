//! TEST ONLY. Mock oracle — a deliberately tiny program whose only purpose is **devnet
//! end-to-end testing** of `reflect-allocation`.
//!
//! On devnet there is no venue account whose value we control and can predict, so
//! producers (which read on-chain accounts only, via `OffsetU64Driver`) have
//! nothing to sample. This program creates `MockData` PDAs into which the e2e
//! harness writes exact `u64` values; a producer then reads one with
//! `TARGET_ACCOUNT = mock_pda`, `OFFSET = 8` (skip the Anchor discriminator),
//! `SCALE_NUM = SCALE_DEN = 1`, so the stored basis-point value is sampled
//! verbatim. This keeps the real minimum-context-slot read path under test while
//! making aggregates deterministic and assertable.
//!
//! `data` is the first field so the value lives at a stable account offset of 8.

use anchor_lang::prelude::*;

declare_id!("3fqre3GKxrkcMvszvtc3vsemgjoKE7mDWz9UQtHtv78N");

/// PDA seed prefix; an account is `[MOCK_SEED, &[id]]`.
pub const MOCK_SEED: &[u8] = b"mock";
/// Writable payload width in bytes.
pub const MOCK_DATA_LEN: usize = 64;

#[program]
pub mod mock_oracle {
    use super::*;

    /// Create a mock account for `id`, owned/writable by `admin`.
    pub fn init_mock(ctx: Context<InitMock>, _id: u8) -> Result<()> {
        let m = &mut ctx.accounts.mock;
        m.data = [0u8; MOCK_DATA_LEN];
        m.authority = ctx.accounts.admin.key();
        m.bump = ctx.bumps.mock;
        Ok(())
    }

    /// Write a little-endian `u64` at `offset` within the payload. Only the
    /// account's `authority` may write.
    pub fn write_u64(ctx: Context<WriteMock>, _id: u8, offset: u8, value: u64) -> Result<()> {
        let off = offset as usize;
        require!(off + 8 <= MOCK_DATA_LEN, MockError::OffsetOutOfBounds);
        ctx.accounts.mock.data[off..off + 8].copy_from_slice(&value.to_le_bytes());
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct InitMock<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + MockData::INIT_SPACE,
        seeds = [MOCK_SEED, &[id]],
        bump
    )]
    pub mock: Account<'info, MockData>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct WriteMock<'info> {
    #[account(mut, seeds = [MOCK_SEED, &[id]], bump = mock.bump, has_one = authority)]
    pub mock: Account<'info, MockData>,
    pub authority: Signer<'info>,
}

/// `data` first so the sampled `u64` sits at account offset `8 + write-offset`.
#[account]
#[derive(InitSpace)]
pub struct MockData {
    pub data: [u8; MOCK_DATA_LEN],
    pub authority: Pubkey,
    pub bump: u8,
}

#[error_code]
pub enum MockError {
    #[msg("write offset out of bounds")]
    OffsetOutOfBounds,
}

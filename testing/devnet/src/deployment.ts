import assert from 'node:assert/strict';

export function deploymentCapacity(elfSize: number, bufferDataSize = 0): number {
  assert(Number.isSafeInteger(elfSize) && elfSize > 0);
  assert(Number.isSafeInteger(bufferDataSize) && bufferDataSize >= 0);
  return Math.ceil(Math.max(elfSize, bufferDataSize) / 65536) * 65536;
}
export class FundingBlocked extends Error {}
export async function fundWallet(
  network: 'localnet' | 'devnet', address: string, target: number,
  balance: () => Promise<number>, request: () => Promise<unknown>,
) {
  const starting = await balance();
  if (starting >= target) return { starting_lamports: starting, airdrop: 'not needed' };
  const attempt = await request();
  const after = await balance();
  if (after < target) {
    const message = `${network} funding unavailable: ${address} has ${after / 1e9} SOL; target ${target / 1e9} test SOL. ${JSON.stringify(attempt)}`;
    if (network === 'devnet') throw new FundingBlocked(`${message}; use https://faucet.solana.com/ and rerun`);
    throw new Error(message);
  }
  return { starting_lamports: starting, balance_lamports: after, airdrop: attempt };
}

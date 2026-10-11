// Real mainnet reads, devnet publication. SDK versions are pinned in package-lock.json.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';

export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const BINDINGS = [
  { name: 'Marginfi', pool_id: 80, venue: 0, account: '2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB',
    owner: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', market: '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8', sdk: '@0dotxyz/p0-ts-sdk@2.10.0' },
  { name: 'Save', pool_id: 81, venue: 1, account: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
    owner: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', market: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY', sdk: '@solendprotocol/solend-sdk@0.14.27' },
  { name: 'Kamino', pool_id: 82, venue: 2, account: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
    owner: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', market: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF', sdk: '@kamino-finance/klend-sdk@13.0.2' },
];
export function toBps(apy) {
  const n = new Decimal(String(apy));
  assert(n.isFinite() && n.gte(0) && n.lte(100), 'invalid supply APY');
  return BigInt(n.mul(10000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}
export async function readSources(url = process.env.SOURCE_RPC_URL ?? 'https://api.mainnet-beta.solana.com', venue) {
  const connection = new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  assert.equal(await connection.getGenesisHash(), '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'source RPC must be mainnet');
  // Each producer fetches only its assigned protocol; the all-venue mode is for setup verification.
  assert(venue === undefined || Number.isInteger(venue) && venue >= 0 && venue < 3, 'invalid venue');
  const selected = venue === undefined ? BINDINGS : [BINDINGS[venue]];
  const hasKamino = selected.some(b => b.venue === 2);
  const keys = selected.map(b => new PublicKey(b.account));
  if (hasKamino) keys.push(new PublicKey(BINDINGS[2].market));
  const response = await connection.getMultipleAccountsInfoAndContext(keys);
  const slot = response.context.slot;
  const blockTime = await connection.getBlockTime(slot);
  assert(blockTime !== null, 'missing mainnet block time');
  const marketAccount = hasKamino ? response.value[selected.length] : undefined;
  if (hasKamino) assert(marketAccount?.owner.toBase58() === BINDINGS[2].owner, 'Kamino market owner mismatch');
  const market = marketAccount ? (await import('@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/LendingMarket.js')).LendingMarket.decode(marketAccount.data) : undefined;
  const samples = await Promise.all(selected.map(async (binding, position) => {
    const i = binding.venue, account = response.value[position];
    assert(account && account.owner.toBase58() === binding.owner, `${binding.name} account owner mismatch`);
    let apy;
    if (i === 0) {
      const {Bank,MARGINFI_IDL,computeBankSupplyApy}=await import('@0dotxyz/p0-ts-sdk');
      const {Program}=await import('@coral-xyz/anchor');
      const idl = new Program({ ...MARGINFI_IDL, address: binding.owner }, { connection }).idl;
      const bank = Bank.fromBuffer(new PublicKey(binding.account), account.data, idl);
      assert.equal(bank.mint.toBase58(), USDC); assert.equal(bank.group.toBase58(), binding.market);
      assert.equal(bank.mintDecimals, 6); assert.equal(bank.config.assetTag, 0, 'select a native Marginfi bank');
      apy = computeBankSupplyApy(bank);
    } else if (i === 1) {
      const {parseReserve}=await import('@solendprotocol/solend-sdk/state/reserve.js');
      const {calculateSupplyInterest}=await import('@solendprotocol/solend-sdk/core/utils/rates.js');
      const parsed = parseReserve(new PublicKey(binding.account), account);
      assert(parsed, 'unsupported Save reserve');
      const state = parsed.info;
      assert.equal(state.liquidity.mintPubkey.toBase58(), USDC); assert.equal(state.lendingMarket.toBase58(), binding.market);
      assert.equal(state.liquidity.mintDecimals, 6); assert.equal(state.version, 1, 'unsupported Save version');
      apy = calculateSupplyInterest(state, true).toString();
    } else {
      const {Reserve}=await import('@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve.js');
      const {KaminoReserve}=await import('@kamino-finance/klend-sdk/dist/classes/reserve.js');
      const state = Reserve.decode(account.data);
      assert.equal(String(state.liquidity.mintPubkey), USDC); assert.equal(String(state.lendingMarket), binding.market);
      assert.equal(state.liquidity.mintDecimals.toNumber(), 6);
      // APY only depends on reserve rates/liquidity, not token USD price. No oracle price is invented.
      const reserve = new KaminoReserve(state, binding.account, undefined, undefined, 500, market.reserveRewardsMaxAprBps);
      apy = reserve.totalSupplyAPY({ slot: BigInt(slot), blockTime: BigInt(blockTime) });
    }
    return { ...binding, mint: USDC, source_slot: String(slot), source_block_time: blockTime,
      apy_fraction: String(apy), apy_bps: toBps(apy).toString(), raw_base64: account.data.toString('base64') };
  }));
  return { observed_at: new Date().toISOString(), network: 'mainnet', rpc: url, context_slot: String(slot),
    convention: 'SDK base supply interest APY; excludes token incentives. Kamino legacy slot duration uses the SDK nominal 500ms convention.',
    kamino_market_base64: marketAccount?.data.toString('base64'), samples };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sources = await readSources();
  console.log(JSON.stringify({ ...sources, kamino_market_base64: undefined, samples: sources.samples.map(({raw_base64, ...s}) => s) }, null, 2));
}

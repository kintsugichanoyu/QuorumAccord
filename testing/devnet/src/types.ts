import assert from 'node:assert/strict';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const PROTOCOLS = ['atlas', 'boreal', 'cygnus'] as const;
export type Protocol = typeof PROTOCOLS[number];
export const PHASES = ['baseline', 'outlier', 'updated', 'unavailable'] as const;
export type Phase = typeof PHASES[number];
export const PRICES = { SOL: 198_250_000n, BTC: 64_000_000_000n, ETH: 3_200_000_000n };
export type Symbol = keyof typeof PRICES;
export interface Asset {
  symbol: Symbol;
  pool_id: number;
  data_id: number;
  base_price_micro_usd: string;
}
export interface Config {
  network: 'localnet' | 'devnet';
  rpc_url: string;
  program_id: string;
  mock_program_id: string;
  backend_url: string;
  admin_keypair: string;
  operator_keypairs: string[];
  outsider_keypair: string;
  window_slots: number;
  assets: Asset[];
}
export interface Quote {
  test_only: boolean;
  protocol: Protocol;
  symbol: Symbol;
  price_micro_usd: string;
  decimals: number;
  phase: Phase;
  observed_at_ms: number;
}
export interface BackendState { phase: Phase; requests: Record<Protocol, number> }

export function json(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2);
}

export function uint64(value: unknown): bigint {
  assert(typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)),
    'u64 must be a bigint or canonical decimal string');
  const integer = BigInt(value);
  assert(integer >= 0n && integer <= 0xffff_ffff_ffff_ffffn, 'u64 out of range');
  return integer;
}

export function loopback(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    && !parsed.username && !parsed.password;
}

export function validateConfig(config: Config): void {
  assert(['localnet', 'devnet'].includes(config.network), 'only localnet/devnet allowed');
  assert(loopback(config.backend_url), 'test backend must be loopback');
  if (config.network === 'localnet') assert(loopback(config.rpc_url), 'localnet RPC must be loopback');
  assert(Number.isInteger(config.window_slots) && config.window_slots >= 30 && config.window_slots <= 600);
  assert.equal(config.operator_keypairs.length, 3, 'three operator wallets required');
  assert(config.assets.length > 0);
  const keys = new Set<string>();
  for (const asset of config.assets) {
    assert(Object.hasOwn(PRICES, asset.symbol), 'unknown asset');
    for (const id of [asset.pool_id, asset.data_id]) assert(Number.isInteger(id) && id >= 0 && id <= 255);
    const key = `${asset.pool_id}:${asset.data_id}`;
    assert(!keys.has(key), 'duplicate asset feed');
    keys.add(key);
    assert(uint64(asset.base_price_micro_usd) > 0n);
  }
}

export function validateQuote(quote: Quote, protocol: Protocol, symbol: Symbol, now = Date.now()): bigint {
  assert.equal(quote.test_only, true, 'backend must identify test data');
  assert.equal(quote.protocol, protocol, 'wrong quote protocol');
  assert.equal(quote.symbol, symbol, 'wrong quote symbol');
  assert.equal(quote.decimals, 6, 'wrong quote units');
  assert(PHASES.includes(quote.phase), 'unknown quote phase');
  assert(Number.isSafeInteger(quote.observed_at_ms) && quote.observed_at_ms <= now + 1000
    && now - quote.observed_at_ms <= 30_000, 'stale/future backend quote');
  const value = uint64(quote.price_micro_usd);
  assert(value > 0n, 'zero price');
  return value;
}

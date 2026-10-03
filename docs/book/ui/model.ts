/** Browser-only read model for the dedicated test deployment. No signing API. */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const PROGRAM = 'DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz';
export const ALLOCATION = 'Fxm3c6cfmHb3taPdqVcka6USRAHkytZn3zyBUAwPbS8S';
export const FEEDS = [
  { symbol: 'SOL', pool: 160, data: 240, address: '878XKJFyNadaYQgZ2nfG7nT9pMkvmpbLgAagvFghsegd' },
  { symbol: 'BTC', pool: 161, data: 240, address: '4FBYi1Bh4V6HudsJCScF9n9FrEEDwDFCB1CmVkQQdLDo' },
  { symbol: 'ETH', pool: 162, data: 240, address: '6Gs6U15Fgn6gDK8SNUqq1RTnEuVDCoiAJp6MvjonEeLN' },
] as const;
export const DISCRIMINATORS = {
  DataFeed: [146, 11, 109, 236, 192, 89, 172, 164],
  AllocationState: [140, 47, 50, 0, 216, 164, 210, 13],
};
export interface Account { owner: string; data: [string, string] }
export interface Feed { price: bigint; tick: bigint; finalized: bigint; width: number; status: 'fresh' | 'stale' | 'future' | 'unset' }
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function bytes(account: Account, type: keyof typeof DISCRIMINATORS, minimum: number): DataView {
  require(account.owner === PROGRAM, 'Unexpected account owner');
  require(Array.isArray(account.data) && account.data[1] === 'base64', 'Expected base64 account data');
  const raw = Uint8Array.from(atob(account.data[0]), c => c.charCodeAt(0));
  require(raw.length >= minimum, 'Truncated account');
  require(DISCRIMINATORS[type].every((n, i) => raw[i] === n), 'Unexpected account discriminator');
  return new DataView(raw.buffer);
}
export function decodeFeed(account: Account, expected: { pool: number; data: number }, context: bigint): Feed {
  const view = bytes(account, 'DataFeed', 8248);
  require(view.getUint8(48) === expected.pool && view.getUint8(49) === expected.data, 'Unexpected feed identity');
  const head = view.getUint16(46, true);
  require(head < 256, 'Invalid ring head');
  const width = view.getUint32(32, true);
  require(width > 0, 'Invalid feed window');
  const tick = view.getBigUint64(8, true);
  const finalized = view.getBigUint64(16, true);
  const price = tick === 0n ? 0n : view.getBigUint64(56 + ((head + 255) % 256) * 32, true);
  require(tick === 0n || (price > 0n && price === view.getBigUint64(24, true)), 'Ring/header price mismatch');
  const status = tick === 0n || finalized === 0n ? 'unset' : finalized > context ? 'future'
    : context - finalized > BigInt(width) * 4n ? 'stale' : 'fresh';
  return { price, tick, finalized, width, status };
}
export function decodeAllocation(account: Account) {
  const view = bytes(account, 'AllocationState', 57);
  const round = view.getBigUint64(8, true);
  const updated = view.getBigUint64(16, true);
  const weights = Array.from({ length: 16 }, (_, i) => view.getUint16(24 + i * 2, true));
  require(weights.every(w => w <= 10_000), 'Invalid allocation weight');
  require(round === 0n || weights.reduce((a, b) => a + b, 0) === 10_000, 'Allocation does not sum to 10,000 bps');
  return { round, updated, weights };
}
export function usd(value: bigint): string {
  require(value >= 0n, 'Negative USD value');
  const whole = (value / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `$${whole}${fraction ? '.' + fraction : ''}`;
}
export async function rpcRead<T>(endpoint: string, method: string, params: unknown[], fetcher: typeof fetch = fetch): Promise<T> {
  require(['getGenesisHash', 'getSlot', 'getMultipleAccounts'].includes(method), 'Only read-only RPC methods are allowed');
  const url = new URL(endpoint);
  require(url.protocol === 'https:' && !url.username && !url.password, 'Use an HTTPS RPC without embedded credentials');
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  require(response.ok, `RPC HTTP ${response.status}; wait before refreshing or use a dedicated devnet RPC`);
  const data = await response.json() as { result?: T; error?: { message?: string } };
  require(!data.error && data.result !== undefined, data.error?.message ?? 'RPC response has no result');
  return data.result;
}
export async function readDevnet(endpoint: string, fetcher: typeof fetch = fetch) {
  require(await rpcRead<string>(endpoint, 'getGenesisHash', [], fetcher) === DEVNET_GENESIS, 'RPC is not Solana devnet');
  const slot = await rpcRead<number>(endpoint, 'getSlot', [{ commitment: 'confirmed' }], fetcher);
  require(Number.isSafeInteger(slot) && slot > 0, 'Invalid RPC slot');
  const result = await rpcRead<{ context: { slot: number }; value: (Account | null)[] }>(endpoint, 'getMultipleAccounts',
    [[...FEEDS.map(f => f.address), ALLOCATION], { commitment: 'confirmed', encoding: 'base64', minContextSlot: slot }], fetcher);
  require(Number.isSafeInteger(result.context.slot) && result.context.slot >= slot && result.value.length === 4, 'Invalid RPC account context');
  const context = BigInt(result.context.slot);
  return { context, prices: FEEDS.map((feed, i) => ({ symbol: feed.symbol, address: feed.address,
    view: result.value[i] ? decodeFeed(result.value[i]!, feed, context) : null })),
    allocation: result.value[3] ? decodeAllocation(result.value[3]) : null };
}

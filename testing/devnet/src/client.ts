import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from '@solana/web3.js';
import { decodeFeed, Instructions } from './codec.js';
import { DEVNET_GENESIS, type Asset, type Config, validateConfig } from './types.js';

export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function loadConfig(): Promise<Config> {
  assert(process.env.LAB_CONFIG, 'set LAB_CONFIG to testing/devnet/.state/<network>/config.json');
  const config = JSON.parse(await readFile(process.env.LAB_CONFIG, 'utf8')) as Config;
  validateConfig(config);
  return config;
}
export async function wallet(path: string): Promise<Keypair> {
  const values: unknown = JSON.parse(await readFile(path, 'utf8'));
  assert(Array.isArray(values) && values.length === 64 && values.every(v => Number.isInteger(v) && v >= 0 && v <= 255), 'invalid test wallet file');
  return Keypair.fromSecretKey(Uint8Array.from(values));
}

export class ChainClient {
  readonly connection: Connection;
  readonly ix: Instructions;
  readonly signatures: string[] = [];
  constructor(readonly config: Config) {
    validateConfig(config);
    this.connection = new Connection(config.rpc_url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
    this.ix = new Instructions(new PublicKey(config.program_id));
  }
  async verifyNetwork() {
    const genesis = await this.connection.getGenesisHash();
    if (this.config.network === 'devnet') assert.equal(genesis, DEVNET_GENESIS, 'refusing non-devnet RPC');
    return genesis;
  }
  async send(payer: Keypair, instruction: TransactionInstruction): Promise<string> {
    const signature = await sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [payer],
      { commitment: 'confirmed', preflightCommitment: 'confirmed', maxRetries: 3 });
    this.signatures.push(signature);
    return signature;
  }
  async reject(payer: Keypair, instruction: TransactionInstruction, code: number): Promise<void> {
    const blockhash = await this.connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: payer.publicKey, ...blockhash }).add(instruction);
    transaction.sign(payer);
    const response = await this.connection.simulateTransaction(transaction);
    assert.deepEqual(response.value.err, { InstructionError: [0, { Custom: code }] },
      `expected custom error ${code}, got ${JSON.stringify(response.value.err)}; ${response.value.logs?.join('\n')}`);
  }
  async account(key: PublicKey) {
    const response = await this.connection.getAccountInfoAndContext(key, { commitment: 'confirmed' });
    assert(response.value, `account missing: ${key.toBase58()}`);
    assert(response.value.owner.equals(this.ix.program), 'account owner mismatch');
    return { data: response.value.data, context: BigInt(response.context.slot) };
  }
  async exists(key: PublicKey): Promise<boolean> { return (await this.connection.getAccountInfo(key, 'confirmed')) !== null; }
  async feed(asset: Asset) { return decodeFeed((await this.account(this.ix.feed(asset.pool_id, asset.data_id))).data); }
  async slot(): Promise<bigint> { return BigInt(await this.connection.getSlot('confirmed')); }
  async waitSlot(target: bigint): Promise<void> {
    const deadline = Date.now() + 360_000;
    while (await this.slot() < target) {
      assert(Date.now() < deadline, `timed out waiting for slot ${target}`);
      await pause(300);
    }
  }
  async nextWindow(width = this.config.window_slots, remaining = Math.ceil(width * 0.75)) {
    const slots = BigInt(width);
    const current = await this.slot();
    const index = current / slots + ((current / slots + 1n) * slots - current < BigInt(remaining) ? 1n : 0n);
    await this.waitSlot(index * slots);
    return { window: index, closes: (index + 1n) * slots };
  }
  async fund(admin: Keypair, recipients: Keypair[], target = 300_000_000) {
    for (const recipient of recipients) {
      const balance = await this.connection.getBalance(recipient.publicKey, 'confirmed');
      if (balance < target) await this.send(admin, SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: recipient.publicKey, lamports: target - balance }));
    }
  }
}

export class SigningClient extends ChainClient {
  private constructor(config: Config, readonly admin: Keypair, readonly operators: Keypair[], readonly outsider: Keypair) { super(config); }
  static async load(config: Config): Promise<SigningClient> {
    const operators = await Promise.all(config.operator_keypairs.map(wallet));
    const admin = await wallet(config.admin_keypair);
    const outsider = await wallet(config.outsider_keypair);
    assert.equal(new Set([admin, outsider, ...operators].map(k => k.publicKey.toBase58())).size, 5, 'all test signer keys must be distinct');
    const client = new SigningClient(config, admin, operators, outsider);
    await client.verifyNetwork();
    return client;
  }
}

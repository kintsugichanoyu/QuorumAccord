/** TypeScript build/fund/deploy runner. Child services and keys are test-owned. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, openSync, closeSync } from 'node:fs';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname, delimiter } from 'node:path';
import { parseArgs } from 'node:util';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createBackend } from './backend.js';
import { pause, wallet } from './client.js';
import { deploymentCapacity, FundingBlocked, fundWallet } from './deployment.js';
import { command } from './process.js';
import { DEVNET_GENESIS, DEVNET_RPC, PRICES, json, validateConfig, type Config, type Symbol } from './types.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const LAB = join(ROOT, 'testing/devnet');
const STATE = join(LAB, '.state');
const { values } = parseArgs({ options: {
  network: { type: 'string', default: 'devnet' }, 'skip-build': { type: 'boolean' }, 'skip-deploy': { type: 'boolean' },
  'prices-only': { type: 'boolean' }, 'allocation': { type: 'boolean' }, 'legacy-allocation': { type: 'boolean' },
  'window-slots': { type: 'string', default: '120' }, 'backend-port': { type: 'string', default: '18787' },
  'local-ledger': { type: 'string' }, 'sbf-arch': { type: 'string', default: 'v3' },
} });
assert(values.network === 'devnet' || values.network === 'localnet', 'only devnet/localnet supported');
assert(['v0', 'v1', 'v2', 'v3'].includes(values['sbf-arch']!));
const network = values.network;
const withAllocation = !values['prices-only'];
const networkState = join(STATE, network);
process.umask(0o077);
const env = { ...process.env };
for (const path of [join(homedir(), '.local/share/solana/install/active_release/bin'), join(homedir(), '.local/share/reflect-toolchains/solana-release/bin')]) {
  if (existsSync(join(path, 'solana'))) { env.PATH = `${path}${delimiter}${env.PATH ?? ''}`; break; }
}
const children: ChildProcess[] = [];
const fds: number[] = [];
const backend = createBackend();
const report: Record<string, unknown> = { schema_version: 2, language: 'typescript', status: 'started', network, started_at: new Date().toISOString() };
function logFile(name: string) { const fd = openSync(join(networkState, name), 'w', 0o600); fds.push(fd); return fd; }
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await pause(100);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
async function cleanup() {
  for (const child of [...children].reverse()) await stop(child);
  if (backend.listening) {
    backend.closeAllConnections();
    await new Promise<void>((done) => backend.close(() => done()));
  }
  for (const fd of fds.splice(0)) closeSync(fd);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
async function run(binary: string, args: string[]) {
  console.error('+', binary, ...args);
  const result = await command(binary, args, { cwd: ROOT, env, timeout: 20 * 60_000 });
  if (result.code !== 0) throw new Error(`${binary} failed (${result.code}): ${result.stderr || result.stdout}`);
  return result;
}
async function syncIds(program: string, mock: string) {
  for (const [path, id] of [[join(ROOT, 'programs/reflect-allocation/src/lib.rs'), program], [join(LAB, 'programs/mock-oracle/src/lib.rs'), mock]]) {
    const text = await readFile(path!, 'utf8');
    const updated = text.replace(/declare_id!\("[^"]+"\);/, `declare_id!("${id}");`);
    if (text !== updated) await writeFile(path!, updated);
  }
  const path = join(ROOT, 'Anchor.toml');
  const text = await readFile(path, 'utf8');
  const updated = text.replace(/reflect_allocation = "[^"]+"/g, `reflect_allocation = "${program}"`)
    .replace(/mock_oracle = "[^"]+"/g, `mock_oracle = "${mock}"`);
  if (text !== updated) await writeFile(path, updated);
}

try {
  await mkdir(networkState, { recursive: true });
  const keys: Record<string, string> = {};
  await mkdir(join(STATE, 'keys'), { recursive: true, mode: 0o700 });
  for (const name of ['admin', 'op1', 'op2', 'op3', 'outsider', 'program', 'mock-program', 'program-buffer', 'mock-buffer']) {
    const path = join(STATE, 'keys', `${name}.json`);
    if (!existsSync(path)) await writeFile(path, json([...Keypair.generate().secretKey]) + '\n', { mode: 0o600, flag: 'wx' });
    await chmod(path, 0o600);
    keys[name] = path;
  }
  const program = (await wallet(keys.program!)).publicKey.toBase58();
  const mock = (await wallet(keys['mock-program']!)).publicKey.toBase58();
  const admin = (await wallet(keys.admin!)).publicKey.toBase58();
  const rpc = network === 'devnet' ? DEVNET_RPC : 'http://127.0.0.1:8899';
  const connection = new Connection(rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  const config: Config = { network, rpc_url: rpc, program_id: program, mock_program_id: mock,
    backend_url: `http://127.0.0.1:${values['backend-port']}`, admin_keypair: keys.admin!, outsider_keypair: keys.outsider!,
    operator_keypairs: [keys.op1!, keys.op2!, keys.op3!], window_slots: Number(values['window-slots']),
    assets: (Object.entries(PRICES) as [Symbol, bigint][]).map(([symbol, price], i) => ({ symbol, pool_id: 160 + i, data_id: 240, base_price_micro_usd: price.toString() })) };
  validateConfig(config);
  assert(Number.isInteger(Number(values['backend-port'])) && Number(values['backend-port']) > 0 && Number(values['backend-port']) <= 65535);
  const configPath = join(networkState, 'config.json');
  await writeFile(configPath, json(config) + '\n', { mode: 0o600 });
  Object.assign(report, { program, mock_program: mock, admin, rpc, window_slots: config.window_slots, sbf_arch: values['sbf-arch'] });
  if (!values['skip-build']) {
    await syncIds(program, mock);
    await run('cargo-build-sbf', ['--arch', values['sbf-arch']!, '--manifest-path', join(ROOT, 'programs/reflect-allocation/Cargo.toml')]);
    if (withAllocation) await run('cargo-build-sbf', ['--arch', values['sbf-arch']!, '--manifest-path', join(LAB, 'programs/mock-oracle/Cargo.toml')]);
  } else {
    const source = await readFile(join(ROOT, 'programs/reflect-allocation/src/lib.rs'), 'utf8');
    assert(source.includes(`declare_id!("${program}")`), 'skip-build requires artifacts matching current test keys');
  }
  if (network === 'localnet') {
    try { await connection.getVersion(); }
    catch {
      const ledger = values['local-ledger'] ? resolve(ROOT, values['local-ledger']) : join(networkState, 'ledger-typescript');
      await mkdir(dirname(ledger), { recursive: true });
      const validator = spawn('solana-test-validator', ['--quiet', '--ledger', ledger,
        '--rpc-port', '8899', '--faucet-port', '9900'], { cwd: ROOT, env, stdio: ['ignore', logFile('validator-typescript.log'), logFile('validator-typescript.stderr.log')] });
      children.push(validator);
      validator.on('error', error => console.error(error.message));
      const deadline = Date.now() + 90_000;
      let starting: number | undefined;
      while (true) {
        assert(Date.now() < deadline && validator.exitCode === null && validator.signalCode === null, 'validator did not become ready');
        try {
          const current = await connection.getSlot('confirmed');
          starting ??= current;
          if (current >= starting + 32 && await connection.getSlot('finalized') > 0) break;
        } catch { /* RPC is not ready yet. */ }
        await pause(500);
      }
    }
  }
  const genesis = await connection.getGenesisHash();
  if (network === 'devnet') assert.equal(genesis, DEVNET_GENESIS, 'refusing non-devnet RPC');
  report.genesis = genesis;
  report.funding = await fundWallet(network, admin, (withAllocation ? 8 : 5) * 1e9,
    () => connection.getBalance(new PublicKey(admin), 'confirmed'),
    () => command('solana', ['airdrop', network === 'localnet' ? '10' : '2', '--url', rpc, '--commitment', 'confirmed', '--keypair', keys.admin!], { env, timeout: 90_000 }));
  if (!values['skip-deploy']) {
    for (const [name, binary, bufferName] of [['program', 'reflect_allocation.so', 'program-buffer'], ...(withAllocation ? [['mock-program', 'mock_oracle.so', 'mock-buffer']] : [])]) {
      const path = join(ROOT, 'target/deploy', binary!);
      const buffer = (await wallet(keys[bufferName!]!)).publicKey;
      const account = await connection.getAccountInfo(buffer, 'confirmed');
      const capacity = deploymentCapacity((await stat(path)).size, account ? account.data.length - 37 : 0);
      const deployed = await run('solana', ['program', 'deploy', path, '--url', rpc, '--keypair', keys.admin!, '--program-id', keys[name!]!, '--buffer', keys[bufferName!]!,
        '--max-len', String(capacity), '--use-rpc', '--commitment', 'confirmed', '--output', 'json']);
      report[name === 'program' ? 'deployment' : 'mock_deployment'] = JSON.parse(deployed.stdout);
    }
  }
  await new Promise<void>((done, reject) => { backend.once('error', reject); backend.listen(Number(values['backend-port']), '127.0.0.1', done); });
  const suitePath = join(networkState, 'suite-typescript.json');
  const test = spawn(process.execPath, ['--test', '--test-concurrency=1', join(LAB, 'dist/tests/integration.test.js')], {
    cwd: ROOT, env: { ...env, LAB_CONFIG: configPath, LAB_REPORT: suitePath, LAB_ALLOCATION: withAllocation ? '1' : '0' },
    stdio: ['ignore', logFile('integration-typescript.tap'), logFile('integration-typescript.stderr.log')],
  });
  children.push(test);
  const code = await new Promise<number | null>((done, reject) => { test.once('error', reject); test.once('exit', done); });
  if (code !== 0) throw new Error(`TypeScript integration failed; inspect ${join(networkState, 'integration-typescript.tap')}`);
  const suite = JSON.parse(await readFile(suitePath, 'utf8')) as { status: string };
  assert.equal(suite.status, 'passed');
  report.suite = suite;
  report.ending_balance_lamports = await connection.getBalance(new PublicKey(admin), 'confirmed');
  report.status = 'passed';
} catch (error) {
  report.status = error instanceof FundingBlocked ? 'blocked' : 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 2;
} finally {
  report.completed_at = new Date().toISOString();
  await mkdir(networkState, { recursive: true });
  await writeFile(join(networkState, 'result-typescript.json'), json(report) + '\n', { mode: 0o600 });
  await cleanup();
  console.log(json({ status: report.status, network, admin: report.admin, error: report.error, evidence: join(networkState, 'result-typescript.json') }));
}

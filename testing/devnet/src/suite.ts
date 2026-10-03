/** All integration assertions are TypeScript; no Rust/Python test executables. */
import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SigningClient } from './client.js';
import { decodeAllocation, decodeFeed, decodeMock, decodeRegistry, decodeSample, Instructions, type FeedConfig } from './codec.js';
import { command } from './process.js';
import { PROTOCOLS, type Asset, type BackendState, type Phase, json, uint64 } from './types.js';
import { allocationGolden, invariantCases } from './allocation.js';

export type Check = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
interface ProviderReport { protocol: string; operator: string; reports: { symbol: string; price_micro_usd: string; signature: string }[] }
interface ConsumerReport { prices: { symbol: string; price_micro_usd: string; tick: string }[] }

export function feedConfig(width: number, quorum = 3, overrides: Partial<FeedConfig> = {}): FeedConfig {
  return { measurand: 0, window_slots: width, threshold_bps: 50, min_interval_slots: 0,
    max_interval_slots: width, min_number: quorum, rule: 1, trim_pct: 0, ...overrides };
}

export class Suite {
  readonly client: SigningClient;
  readonly report: Record<string, unknown>;
  constructor(client: SigningClient) {
    this.client = client;
    this.report = { schema_version: 2, language: 'typescript', status: 'started', network: client.config.network,
      program: client.config.program_id, operators: client.operators.map(k => k.publicKey.toBase58()), started_at: new Date().toISOString() };
  }
  async backendState(): Promise<BackendState> {
    const response = await fetch(`${this.client.config.backend_url}/control/state`, { signal: AbortSignal.timeout(10_000) });
    assert(response.ok);
    return await response.json() as BackendState;
  }
  async setup() {
    const c = this.client;
    await c.fund(c.admin, [...c.operators, c.outsider]);
    const fresh = !await c.exists(c.ix.registry());
    if (fresh) {
      await c.reject(c.outsider, c.ix.initRegistry(c.outsider.publicKey), 6000);
      assert.equal(await c.exists(c.ix.registry()), false);
      await c.send(c.admin, c.ix.initRegistry(c.admin.publicKey));
    }
    for (const operator of c.operators) {
      if (!decodeRegistry((await c.account(c.ix.registry())).data).includes(operator.publicKey.toBase58()))
        await c.send(c.admin, c.ix.addOperator(c.admin.publicKey, operator.publicKey));
    }
    for (const asset of c.config.assets) {
      if (!await c.exists(c.ix.feed(asset.pool_id, asset.data_id)))
        await c.send(c.admin, c.ix.initFeed(c.admin.publicKey, asset.pool_id, asset.data_id, feedConfig(c.config.window_slots)));
      assert.equal((await c.feed(asset)).window_slots, c.config.window_slots, 'incompatible pre-existing feed');
    }
    for (const [pool, quorum] of [[190, 0], [191, 65]] as const)
      await c.reject(c.admin, c.ix.initFeed(c.admin.publicKey, pool, 250, feedConfig(c.config.window_slots, quorum)), 6005);
    return { bootstrap_authority_checked: fresh, invalid_quorums_rejected: [0, 65] };
  }
  async window(phase: Phase, participants: number[], advance: boolean, beforeClose = false, deferred = false) {
    const c = this.client;
    await c.fund(c.admin, c.operators);
    const response = await fetch(`${c.config.backend_url}/control/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: json({ phase }), signal: AbortSignal.timeout(10_000) });
    assert(response.ok);
    const before = await Promise.all(c.config.assets.map(a => c.feed(a)));
    const { window, closes } = await c.nextWindow();
    console.error(`[${phase}] providers=${participants.join(',')}; window=${window}; closes=${closes}`);
    const providers = await Promise.all(participants.map(async index => {
      const result = await command(process.execPath, [cli, 'provide', String(index), window.toString()]);
      if (phase === 'unavailable' && index === 2) {
        assert.notEqual(result.code, 0, 'outage provider unexpectedly succeeded');
        assert.match(result.stderr, /backend HTTP 503/, 'failure must be injected HTTP outage');
        return { protocol: PROTOCOLS[index]!, expected_error: result.stderr.trim() };
      }
      assert.equal(result.code, 0, `provider ${index} failed: ${result.stderr}`);
      const report = JSON.parse(result.stdout) as ProviderReport;
      assert.equal(report.reports.length, c.config.assets.length);
      c.signatures.push(...report.reports.map(r => r.signature));
      return report;
    }));
    if (beforeClose) {
      const asset = c.config.assets[0]!;
      const slot = await c.slot();
      assert(slot < closes, 'providers exhausted submission window');
      const args = [asset.pool_id, asset.data_id, window, uint64(asset.base_price_micro_usd), slot] as const;
      await c.reject(c.operators[0]!, c.ix.sample('corroborate_sample', c.operators[0]!.publicKey, ...args), 6013);
      await c.reject(c.outsider, c.ix.sample('corroborate_sample', c.outsider.publicKey, ...args), 6001);
      await c.reject(c.admin, c.ix.finalizeSample(c.admin.publicKey, asset.pool_id, asset.data_id, window), 6011);
    }
    await c.waitSlot(closes + 2n);
    const backend = await this.backendState();
    for (const index of participants) assert.equal(backend.requests[PROTOCOLS[index]!], phase === 'unavailable' && index === 2 ? 1 : c.config.assets.length);
    if (deferred) return { phase, window, closes, providers, backend, advanced: false, consumer: undefined, finalization_deferred: true };
    for (const [index, asset] of c.config.assets.entries()) {
      const previous = before[index]!;
      await c.send(c.admin, c.ix.finalizeSample(c.admin.publicKey, asset.pool_id, asset.data_id, window));
      const after = await c.feed(asset);
      assert.equal(after.tick, previous.tick + (advance ? 1n : 0n));
      if (advance) {
        const expected = uint64(asset.base_price_micro_usd) * (phase === 'updated' ? 11n : 10n) / 10n;
        assert.equal(after.last_value, expected);
        assert.equal(after.last_finalized_slot, closes);
      } else {
        assert.equal(after.last_value, previous.last_value);
        assert.equal(after.last_finalized_slot, previous.last_finalized_slot);
      }
      assert.equal(decodeSample((await c.account(c.ix.samplePda(asset.pool_id, asset.data_id, window))).data).status, advance ? 2 : 1);
    }
    const output = await command(process.execPath, [cli, 'consume']);
    assert.equal(output.code, 0, `consumer failed: ${output.stderr}`);
    const consumer = JSON.parse(output.stdout) as ConsumerReport;
    assert.equal(consumer.prices.length, c.config.assets.length);
    for (const [index, asset] of c.config.assets.entries()) {
      assert.equal(consumer.prices[index]!.symbol, asset.symbol);
      assert.equal(uint64(consumer.prices[index]!.price_micro_usd), (await c.feed(asset)).last_value);
    }
    assert.deepEqual(await this.backendState(), backend, 'consumer must not call backend');
    return { phase, window, closes, providers, backend, advanced: advance, consumer, finalization_deferred: false };
  }
  async ordering() {
    const older = await this.window('baseline', [0, 1, 2], false, false, true);
    const newer = await this.window('baseline', [0, 1, 2], true);
    for (const asset of this.client.config.assets) {
      const before = await this.client.feed(asset);
      await this.client.reject(this.client.admin, this.client.ix.finalizeSample(this.client.admin.publicKey, asset.pool_id, asset.data_id, older.window), 6018);
      assert.deepEqual(await this.client.feed(asset), before);
    }
    return { older, newer, error_code: 6018 };
  }
  async readOnlyConsumer() {
    const directory = await mkdtemp(join(tmpdir(), 'reflect-ts-consumer-'));
    const path = join(directory, 'config.json');
    try {
      const config = { ...this.client.config, admin_keypair: join(directory, 'absent-admin.json'),
        outsider_keypair: join(directory, 'absent-outsider.json'),
        operator_keypairs: [0, 1, 2].map(i => join(directory, `absent-operator-${i}.json`)) };
      await writeFile(path, json(config), { mode: 0o600 });
      const before = await this.backendState();
      const output = await command(process.execPath, [cli, 'consume'], { env: { ...process.env, LAB_CONFIG: path } });
      assert.equal(output.code, 0, output.stderr);
      const prices = JSON.parse(output.stdout) as ConsumerReport;
      assert.equal(prices.prices.length, config.assets.length);
      assert.deepEqual(await this.backendState(), before);
      return { no_signing_files_required: true, backend_request_counts_unchanged: true, consumer: prices };
    } finally {
      await unlink(path);
      await rmdir(directory);
    }
  }
  async allocation() {
    const c = this.client;
    if (!await c.exists(c.ix.allocationState())) await c.send(c.admin, c.ix.initAllocation(c.admin.publicKey));
    const round = await c.slot();
    const closes = round + BigInt(c.config.window_slots);
    for (const quorum of [0, 65]) await c.reject(c.admin, c.ix.openAllocation(c.admin.publicKey, round + 100n + BigInt(quorum), closes, quorum), 6005);
    for (const index of [round, round + 1n]) {
      await c.send(c.admin, c.ix.openAllocation(c.admin.publicKey, index, closes));
      for (let i = 0; i < 2; i++) await c.send(c.operators[i]!, c.ix.submitWeights(c.operators[i]!.publicKey, index,
        [i === 0 ? 5001 : 5000, i === 0 ? 4999 : 5000, ...Array<number>(14).fill(0)]));
    }
    await c.waitSlot(closes + 2n);
    await c.send(c.admin, c.ix.finalizeAllocation(c.admin.publicKey, round + 1n));
    await c.reject(c.admin, c.ix.finalizeAllocation(c.admin.publicKey, round), 6018);
    const result = decodeAllocation((await c.account(c.ix.allocationState())).data);
    assert.equal(result.round, round + 1n);
    assert.deepEqual(result.weights, [5000, 5000, ...Array<number>(14).fill(0)]);
    return { ...result, older_rejected: round, invalid_quorums_rejected: [0, 65] };
  }
  async staleConsumer() {
    const c = this.client;
    const view = await c.feed(c.config.assets[0]!);
    await c.waitSlot(view.last_finalized_slot + BigInt(c.config.window_slots * 4) + 2n);
    const before = await this.backendState();
    const output = await command(process.execPath, [cli, 'consume']);
    assert.notEqual(output.code, 0);
    assert.match(output.stderr, /stale\/future price/);
    assert.deepEqual(await this.backendState(), before);
    return { rejected: true, error: output.stderr.trim(), backend_request_counts_unchanged: true };
  }
  async run(check: Check, withAllocation: boolean, reportPath?: string) {
    try {
      this.report.setup = await check('bootstrap authorization and quorum bounds', () => this.setup());
      const scenarios = [];
      for (const [name, phase, participants, advance, early] of [
        ['three HTTP providers publish baseline prices', 'baseline', [0, 1, 2], true, true],
        ['missing quorum preserves prior prices', 'baseline', [0, 1], false, false],
        ['10x dishonest outlier is rejected by median', 'outlier', [0, 1, 2], true, false],
        ['10 percent price update advances feeds and consumer', 'updated', [0, 1, 2], true, false],
        ['HTTP 503 prevents provider submission and quorum', 'unavailable', [0, 1, 2], false, false],
      ] as const) scenarios.push(await check(name, () => this.window(phase, [...participants], advance, early)));
      this.report.scenarios = scenarios;
      this.report.read_only_consumer = await check('price consumer works without any signing key files', () => this.readOnlyConsumer());
      this.report.sample_ordering = await check('older samples cannot overwrite newer windows', () => this.ordering());
      this.report.allocation = await check('allocation rounding preserves zeros and rejects older rounds', () => this.allocation());
      if (withAllocation) {
        this.report.allocation_golden = await check('mock protocol accounts produce the allocation golden vector', () => allocationGolden(this.client));
        const invariants: Record<string, unknown> = {};
        for (const [name, run] of invariantCases(this.client)) invariants[name] = await check(name, run);
        this.report.invariants = invariants;
        this.report.stale_consumer = await check('read-only consumer rejects stale prices without backend calls', () => this.staleConsumer());
      }
      this.report.status = 'passed';
    } catch (error) {
      this.report.status = 'failed';
      this.report.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.report.completed_at = new Date().toISOString();
      this.report.signatures = [...new Set(this.client.signatures)];
      this.report.limitations = ['invented test data', 'one centralized fixture backend', 'no real lending protocol integration'];
      if (reportPath) await writeFile(reportPath, json(this.report) + '\n', { mode: 0o600 });
    }
  }
}

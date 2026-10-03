import test from 'node:test';
import { SigningClient, loadConfig } from '../src/client.js';
import { Suite, type Check } from '../src/suite.js';

test('production SBF program: TypeScript multi-provider integration', { timeout: 40 * 60_000 }, async t => {
  const client = await SigningClient.load(await loadConfig());
  const suite = new Suite(client);
  const check: Check = async <T>(name: string, fn: () => Promise<T>) => {
    let result: T | undefined;
    let failure: unknown;
    await t.test(name, async () => {
      try { result = await fn(); }
      catch (error) { failure = error; throw error; }
    });
    if (failure !== undefined) throw failure;
    return result as T;
  };
  await suite.run(check, process.env.LAB_ALLOCATION === '1', process.env.LAB_REPORT);
});

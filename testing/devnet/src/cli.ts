import assert from 'node:assert/strict';
import { ChainClient, SigningClient, loadConfig, pause } from './client.js';
import { consumePrices } from './consumer.js';
import { provide } from './provider.js';
import { json, uint64 } from './types.js';

try {
  const config = await loadConfig();
  const command = process.argv[2] ?? 'consume';
  if (command === 'consume' || command === 'watch') {
    const client = new ChainClient(config);
    do {
      console.log(json(await consumePrices(client)));
      if (command === 'consume') break;
      await pause(2000);
    } while (true);
  } else {
    assert.equal(command, 'provide', 'use consume/watch/provide <operator index> <window>');
    console.log(json(await provide(await SigningClient.load(config), Number(process.argv[3]), uint64(process.argv[4]))));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

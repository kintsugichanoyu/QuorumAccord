import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentCapacity, deploymentTransport, FundingBlocked, fundWallet } from '../../src/deployment.js';

test('deployment transport selects explicit RPC or TPU CLI flags', () => {
  assert.equal(deploymentTransport('rpc'), '--use-rpc');
  assert.equal(deploymentTransport('tpu'), '--use-tpu-client');
});
test('unknown deployment transports are rejected before deployment', () => {
  assert.throws(() => deploymentTransport('udp'), /must be rpc or tpu/);
});
test('deployment capacity covers a larger resumed buffer', () => assert.equal(deploymentCapacity(322920, 344472), 393216));
test('deployment capacity rounds up a fresh program', () => assert.equal(deploymentCapacity(128168), 131072));
test('funded wallets do not make unnecessary airdrop requests', async () => {
  let calls = 0;
  const result = await fundWallet('devnet', 'address', 5e9, async () => 6e9, async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(result.airdrop, 'not needed');
});
test('faucet refusal produces an explicit devnet blockage, not a test pass', async () => {
  await assert.rejects(fundWallet('devnet', 'address', 5e9, async () => 0, async () => ({ code: 1 })), FundingBlocked);
});
test('airdrop success is checked against the actual post-request balance', async () => {
  let calls = 0;
  const result = await fundWallet('localnet', 'address', 5e9, async () => calls++ ? 10e9 : 0, async () => ({ code: 0 }));
  assert.equal(result.balance_lamports, 10e9);
});

/** Live devnet contract checks for both generated clients. No mainnet or deployment path. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  address,
  createNoopSigner,
  isSignerRole,
  isWritableRole,
  type Instruction,
} from "@solana/kit";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as sdk from "../ts/index.js";
import { callRustSdk } from "./rust-transport.js";
import { verifyCodecs } from "./verify-codecs.js";

const root = resolve(import.meta.dirname, "../../..");
const { values } = parseArgs({
  options: {
    network: { type: "string" },
    rpc: { type: "string", default: "https://api.devnet.solana.com" },
  },
});
assert.equal(values.network, "devnet", "explicit --network devnet is required");
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const program = sdk.QUORUM_ALLOCATION_PROGRAM_ADDRESS;
const runId = new Date().toISOString().replaceAll(":", "-");
const state = resolve(root, "testing/devnet/.state/sdk", runId);
await mkdir(state, { recursive: true, mode: 0o700 });
process.umask(0o077);
const adminFile =
  process.env.SDK_ADMIN_KEYPAIR ??
  resolve(root, "testing/devnet/.state/keys/admin.json");
const readKey = async (path: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(path, "utf8")) as number[]),
  );
const admin = await readKey(adminFile);
const ops = [Keypair.generate(), Keypair.generate()];
const outsider = Keypair.generate();
const operatorFiles = ops.map((_, i) => resolve(state, `operator-${i}.json`));
await Promise.all(
  ops.map((op, i) =>
    writeFile(operatorFiles[i]!, JSON.stringify([...op.secretKey]) + "\n", {
      mode: 0o600,
      flag: "wx",
    }),
  ),
);
const rustBinary =
  process.env.SDK_RUST_VERIFY_BIN ??
  resolve(root, "workers/target/debug/quorum-sdk-verify");
const report: Record<string, unknown> = {
  schema_version: 1,
  started_at: new Date().toISOString(),
  network: "devnet",
  program,
  source_model: "existing operator-submission MVP; invented SDK fixtures",
  status: "started",
  admin: admin.publicKey.toBase58(),
  operators: ops.map((op) => op.publicKey.toBase58()),
  transactions: [],
  checks: [],
};
const transactions = report.transactions as Record<string, unknown>[];
const checks = report.checks as string[];
const { startRpcGateway } = await import(
  resolve(root, "testing/devnet/dist/src/rpc-gateway.js")
);
const gateway = await startRpcGateway(values.rpc!);
const connection = new Connection(gateway.url, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
});
const registered = new Set<number>();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const signer = (key: Keypair) =>
  createNoopSigner(address(key.publicKey.toBase58()));
const pk = (s: string) => new PublicKey(s);
const registry = await sdk.getRegistryAddress();
const allocationState = await sdk.getAllocationStateAddress();
const system = SystemProgram.programId.toBase58();
const a = (s: string) => address(s);
const config = {
  measurand: 0,
  window_slots: 256,
  threshold_bps: 1,
  min_interval_slots: 1,
  max_interval_slots: 512,
  min_number: 2,
  rule: 0,
  trim_pct: 0,
};
const kitConfig = {
  measurand: config.measurand,
  windowSlots: config.window_slots,
  thresholdBps: config.threshold_bps,
  minIntervalSlots: config.min_interval_slots,
  maxIntervalSlots: config.max_interval_slots,
  minNumber: config.min_number,
  rule: 0,
  trimPct: 0,
};

const rust = (request: Record<string, unknown>) =>
  callRustSdk(rustBinary, request);

function transport(ix: Instruction): TransactionInstruction {
  assert.equal(ix.programAddress, program);
  return new TransactionInstruction({
    programId: pk(program),
    data: Buffer.from(ix.data!),
    keys: ix.accounts!.map((meta) => ({
      pubkey: pk(meta.address),
      isSigner: isSignerRole(meta.role),
      isWritable: isWritableRole(meta.role),
    })),
  });
}

async function confirm(signature: string, label: string, language: string) {
  const deadline = Date.now() + 120_000;
  while (true) {
    const status = (await connection.getSignatureStatuses([signature]))
      .value[0];
    if (status?.err)
      throw new Error(
        `${label} transaction failed: ${JSON.stringify(status.err)}`,
      );
    if (
      status &&
      ["confirmed", "finalized"].includes(status.confirmationStatus ?? "")
    ) {
      transactions.push({
        label,
        client: language,
        signature,
        slot: status.slot,
        status: status.confirmationStatus,
      });
      console.log(`${language} ${label}: ${signature}`);
      return signature;
    }
    assert(Date.now() < deadline, `${label} confirmation timeout`);
    await sleep(500);
  }
}
async function sendTs(label: string, ix: Instruction, payer: Keypair) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, ...latest }).add(
    transport(ix),
  );
  tx.sign(payer);
  return confirm(
    await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
      maxRetries: 3,
    }),
    label,
    "typescript",
  );
}
async function sendRust(
  label: string,
  name: string,
  accounts: Record<string, string>,
  params: Record<string, unknown>,
  keypairFile: string,
) {
  const result = await rust({
    command: "send",
    instruction: name,
    accounts,
    params,
    rpc_url: gateway.url,
    keypair_file: keypairFile,
  });
  return confirm(result.signature, label, "rust");
}
async function snapshot(
  kind: string,
  key: string,
  decoder: { decode: (data: Uint8Array) => any },
) {
  const result = await connection.getAccountInfoAndContext(
    pk(key),
    "confirmed",
  );
  assert(result.value, `${kind} exists`);
  assert.equal(result.value.owner.toBase58(), program, `${kind} owner`);
  const rustValue = await rust({
    command: "read",
    rpc_url: gateway.url,
    address: key,
    kind,
  });
  await writeFile(
    resolve(state, `${kind}-${key}.json`),
    JSON.stringify({
      address: key,
      owner: program,
      context_slot: result.context.slot,
      data: result.value.data.toString("base64"),
    }) + "\n",
    { mode: 0o600 },
  );
  return {
    ts: decoder.decode(result.value.data),
    rust: rustValue,
    data: result.value.data,
  };
}
async function reject(
  label: string,
  ix: Instruction,
  key: Keypair,
  code: number,
) {
  const latest = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: admin.publicKey, ...latest }).add(
    transport(ix),
  );
  tx.sign(...(key.publicKey.equals(admin.publicKey) ? [admin] : [admin, key]));
  const result = await connection.simulateTransaction(tx);
  assert.deepEqual(
    result.value.err,
    { InstructionError: [0, { Custom: code }] },
    `${label}: ${result.value.logs?.join("\n")}`,
  );
  checks.push(`${label}: expected program error ${code}`);
}

try {
  assert.equal(
    await connection.getGenesisHash(),
    GENESIS,
    "refusing non-devnet RPC",
  );
  report.genesis = GENESIS;
  const programAccount = await connection.getAccountInfo(pk(program));
  assert(programAccount?.executable, "program must be deployed");
  const startingBalance = await connection.getBalance(admin.publicKey);
  assert(
    startingBalance >= 600_000_000,
    "need 0.6 devnet SOL for bounded SDK fixtures",
  );
  report.starting_admin_lamports = startingBalance;
  const before = await snapshot(
    "registry",
    registry,
    sdk.getOperatorRegistryDecoder(),
  );
  assert.equal(
    before.ts.admin,
    admin.publicKey.toBase58(),
    "configured key must be existing registry admin",
  );
  assert(before.ts.count <= 62, "two temporary registry slots required");
  const originalOperators = (before.ts.operators as string[])
    .slice(0, before.ts.count)
    .sort();
  report.original_operators = originalOperators;
  let pool = 200 + (Date.now() % 40);
  let metric = 230;
  while (
    (await connection.getAccountInfo(
      pk(await sdk.getDataFeedAddress(pool, metric)),
    )) ||
    (await connection.getAccountInfo(
      pk(await sdk.getDataFeedAddress(pool, metric + 1)),
    ))
  ) {
    metric += 2;
    if (metric > 252) {
      metric = 230;
      pool = ((pool + 1) % 40) + 200;
    }
  }
  const feeds = await Promise.all(
    [0, 1].map((i) => sdk.getDataFeedAddress(pool, metric + i)),
  );
  report.feeds = feeds.map((feed, i) => ({
    address: feed,
    pool_id: pool,
    data_id: metric + i,
  }));
  const values = [9_007_199_254_740_993n, 9_007_199_254_740_995n];
  const adminAddress = admin.publicKey.toBase58();
  const common = { registry, admin: adminAddress, system_program: system };
  checks.push(...(await verifyCodecs(rustBinary)));
  console.log(
    "All 12 generated instruction encodings and account privileges agree",
  );
  for (let i = 0; i < 2; i++) {
    const transfer = new Transaction({
      feePayer: admin.publicKey,
      ...(await connection.getLatestBlockhash()),
    }).add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: ops[i]!.publicKey,
        lamports: 80_000_000,
      }),
    );
    transfer.sign(admin);
    await confirm(
      await connection.sendRawTransaction(transfer.serialize()),
      `fund test operator ${i}`,
      "support",
    );
    if (i === 0)
      await sendTs(
        "add_operator",
        sdk.getAddOperatorInstruction({
          registry,
          admin: signer(admin),
          operator: a(ops[i]!.publicKey.toBase58()),
        }),
        admin,
      );
    else
      await sendRust(
        "add_operator",
        "add_operator",
        common,
        { operator: ops[i]!.publicKey.toBase58() },
        adminFile,
      );
    registered.add(i);
  }
  for (let i = 0; i < 2; i++) {
    if (i === 0)
      await sendTs(
        "init_data_feed",
        sdk.getInitDataFeedInstruction({
          registry,
          dataFeed: feeds[i]!,
          admin: signer(admin),
          poolId: pool,
          dataId: metric + i,
          config: kitConfig,
        }),
        admin,
      );
    else
      await sendRust(
        "init_data_feed",
        "init_data_feed",
        { ...common, data_feed: feeds[i]! },
        { pool_id: pool, data_id: metric + i, config },
        adminFile,
      );
  }
  await sendTs(
    "update_thresholds",
    sdk.getUpdateThresholdsInstruction({
      registry,
      dataFeed: feeds[0]!,
      admin: signer(admin),
      config: { ...kitConfig, thresholdBps: 2 },
    }),
    admin,
  );
  await sendRust(
    "update_thresholds",
    "update_thresholds",
    { ...common, data_feed: feeds[1]! },
    { config: { ...config, threshold_bps: 3 } },
    adminFile,
  );
  const oldAllocation = await snapshot(
    "allocation",
    allocationState,
    sdk.getAllocationStateDecoder(),
  );
  const preservedWeights = oldAllocation.ts.weights as number[];
  assert.equal(
    preservedWeights.reduce((sum, n) => sum + n, 0),
    10000,
    "existing allocation must be valid",
  );
  let slot = BigInt(await connection.getSlot("confirmed"));
  const width = BigInt(config.window_slots);
  if ((slot / width + 1n) * width - slot < 160n) {
    const target = (slot / width + 1n) * width;
    while (slot < target) {
      await sleep(750);
      slot = BigInt(await connection.getSlot("confirmed"));
    }
  }
  const window = slot / width;
  const closes = (window + 1n) * width;
  const round =
    slot > BigInt(oldAllocation.ts.round)
      ? slot
      : BigInt(oldAllocation.ts.round) + 1n;
  const consensus = await sdk.getAllocationConsensusAddress(round);
  await sendTs(
    "open_allocation_round",
    sdk.getOpenAllocationRoundInstruction({
      registry,
      consensus,
      admin: signer(admin),
      round,
      closesAtSlot: closes,
      minNumber: 2,
      rule: 0,
      trimPct: 0,
    }),
    admin,
  );
  for (let i = 0; i < 2; i++) {
    const sampleAccount = await sdk.getSampleConsensusAddress(
      pool,
      metric + i,
      window,
    );
    const params = {
      window_index: window.toString(),
      value: values[i]!.toString(),
      slot_at_read: slot.toString(),
    };
    const accounts = {
      registry,
      data_feed: feeds[i]!,
      consensus: sampleAccount,
      operator: ops[i]!.publicKey.toBase58(),
      system_program: system,
    };
    if (i === 0)
      await sendTs(
        "propose_sample",
        sdk.getProposeSampleInstruction({
          registry,
          dataFeed: feeds[i]!,
          consensus: sampleAccount,
          operator: signer(ops[i]!),
          windowIndex: window,
          value: values[i]!,
          slotAtRead: slot,
        }),
        ops[i]!,
      );
    else
      await sendRust(
        "propose_sample",
        "propose_sample",
        accounts,
        params,
        operatorFiles[i]!,
      );
    const other = 1 - i;
    if (i === 0)
      await sendRust(
        "corroborate_sample",
        "corroborate_sample",
        { ...accounts, operator: ops[other]!.publicKey.toBase58() },
        params,
        operatorFiles[other]!,
      );
    else
      await sendTs(
        "corroborate_sample",
        sdk.getCorroborateSampleInstruction({
          registry,
          dataFeed: feeds[i]!,
          consensus: sampleAccount,
          operator: signer(ops[other]!),
          windowIndex: window,
          value: values[i]!,
          slotAtRead: slot,
        }),
        ops[other]!,
      );
    const decoded = await snapshot(
      "sample",
      sampleAccount,
      sdk.getDataFeedConsensusDecoder(),
    );
    assert.equal(decoded.ts.count, 2);
    assert.equal(decoded.rust.count, 2);
    assert.deepEqual(
      decoded.rust.submissions.map((s: any) => s.value),
      [values[i]!.toString(), values[i]!.toString()],
    );
    assert.deepEqual(
      decoded.ts.submissions.slice(0, 2).map((s: any) => s.value),
      [values[i], values[i]],
    );
    checks.push(`both SDKs decode live DataFeedConsensus ${i}`);
    if (i === 0) {
      await reject(
        "unregistered operator rejected",
        sdk.getCorroborateSampleInstruction({
          registry,
          dataFeed: feeds[i]!,
          consensus: sampleAccount,
          operator: signer(outsider),
          windowIndex: window,
          value: 1n,
          slotAtRead: slot,
        }),
        outsider,
        6001,
      );
      await reject(
        "duplicate vote rejected",
        sdk.getCorroborateSampleInstruction({
          registry,
          dataFeed: feeds[i]!,
          consensus: sampleAccount,
          operator: signer(ops[i]!),
          windowIndex: window,
          value: values[i]!,
          slotAtRead: slot,
        }),
        ops[i]!,
        6013,
      );
      await reject(
        "early finalization rejected",
        sdk.getFinalizeSampleInstruction({
          dataFeed: feeds[i]!,
          consensus: sampleAccount,
          cranker: signer(admin),
          windowIndex: window,
        }),
        admin,
        6011,
      );
    }
  }
  await sendRust(
    "submit_weights",
    "submit_weights",
    { registry, consensus, operator: ops[1]!.publicKey.toBase58() },
    { round: round.toString(), weights: preservedWeights },
    operatorFiles[1]!,
  );
  await sendTs(
    "submit_weights",
    sdk.getSubmitWeightsInstruction({
      registry,
      consensus,
      operator: signer(ops[0]!),
      round,
      weights: preservedWeights,
    }),
    ops[0]!,
  );
  const allocationRound = await snapshot(
    "allocation_consensus",
    consensus,
    sdk.getAllocationConsensusDecoder(),
  );
  assert.equal(allocationRound.ts.count, 2);
  assert.equal(allocationRound.rust.count, 2);
  assert.deepEqual(allocationRound.ts.submissions[0].weights, preservedWeights);
  assert.deepEqual(
    allocationRound.rust.submissions[0].weights,
    preservedWeights,
  );
  checks.push("both SDKs decode live AllocationConsensus");
  while (BigInt(await connection.getSlot("confirmed")) < closes)
    await sleep(1000);
  for (let i = 0; i < 2; i++) {
    const sampleAccount = await sdk.getSampleConsensusAddress(
      pool,
      metric + i,
      window,
    );
    if (i === 0)
      await sendTs(
        "finalize_sample",
        sdk.getFinalizeSampleInstruction({
          dataFeed: feeds[i]!,
          consensus: sampleAccount,
          cranker: signer(admin),
          windowIndex: window,
        }),
        admin,
      );
    else
      await sendRust(
        "finalize_sample",
        "finalize_sample",
        {
          data_feed: feeds[i]!,
          consensus: sampleAccount,
          cranker: adminAddress,
        },
        { window_index: window.toString() },
        adminFile,
      );
    const decoded = await snapshot("feed", feeds[i]!, sdk.getDataFeedDecoder());
    assert.equal(decoded.ts.tick, 1n);
    assert.equal(decoded.ts.lastValue, values[i]);
    assert.equal(decoded.rust.tick, "1");
    assert.equal(decoded.rust.last_value, values[i]!.toString());
    assert.equal(decoded.ts.ring[0].value, values[i]);
    assert.equal(decoded.rust.latest.value, values[i]!.toString());
    assert.equal(decoded.ts.lastFinalizedSlot, closes);
    assert.equal(decoded.rust.last_finalized_slot, closes.toString());
    checks.push(`both SDKs decode live DataFeed ${i}, exact u64 above 2^53`);
  }
  await sendRust(
    "finalize_allocation",
    "finalize_allocation",
    { consensus, allocation_state: allocationState, cranker: adminAddress },
    { round: round.toString() },
    adminFile,
  );
  const finalAllocation = await snapshot(
    "allocation",
    allocationState,
    sdk.getAllocationStateDecoder(),
  );
  assert.equal(finalAllocation.ts.round, round);
  assert.equal(finalAllocation.rust.round, round.toString());
  assert.deepEqual(finalAllocation.ts.weights, preservedWeights);
  assert.deepEqual(finalAllocation.rust.weights, preservedWeights);
  checks.push(
    "both SDKs decode live AllocationState; existing weights preserved",
  );
  report.allocation = {
    round: round.toString(),
    address: allocationState,
    consensus,
    weights: preservedWeights,
  };
  report.values = values.map(String);
  report.window = window.toString();
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  try {
    // A transaction may land even if its confirmation request fails.
    if (report.original_operators) {
      const current = await snapshot(
        "registry",
        registry,
        sdk.getOperatorRegistryDecoder(),
      );
      const active = current.ts.operators.slice(
        0,
        current.ts.count,
      ) as string[];
      ops.forEach((op, i) => {
        if (active.includes(op.publicKey.toBase58())) registered.add(i);
      });
    }
    for (const i of [...registered].reverse()) {
      const accounts = { registry, admin: admin.publicKey.toBase58() };
      const operator = ops[i]!.publicKey.toBase58();
      if (i === 1)
        await sendRust(
          "remove_operator",
          "remove_operator",
          accounts,
          { operator },
          adminFile,
        );
      else
        await sendTs(
          "remove_operator",
          sdk.getRemoveOperatorInstruction({
            registry,
            admin: signer(admin),
            operator: a(operator),
          }),
          admin,
        );
      registered.delete(i);
    }
    if (report.original_operators) {
      const restored = await snapshot(
        "registry",
        registry,
        sdk.getOperatorRegistryDecoder(),
      );
      const active = restored.ts.operators.slice(0, restored.ts.count).sort();
      assert.deepEqual(active, report.original_operators);
      assert.deepEqual(
        restored.rust.operators.slice().sort(),
        report.original_operators,
      );
      checks.push(
        "both SDKs decode OperatorRegistry; original membership restored",
      );
    }
    report.ending_admin_lamports = await connection.getBalance(admin.publicKey);
    report.cleanup =
      "temporary operators removed; feed/consensus accounts retained as devnet fixtures";
  } catch (error) {
    report.status = "failed";
    report.cleanup_error = String(error);
  }
  report.completed_at = new Date().toISOString();
  report.rpc_gateway = gateway.stats;
  report.idl_sha256 = createHash("sha256")
    .update(await readFile(resolve(root, "sdk/idl/quorum_allocation.json")))
    .digest("hex");
  await writeFile(
    resolve(state, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  const publicReport = resolve(
    root,
    "testing/devnet/evidence",
    `sdk-devnet-${runId}.json`,
  );
  await writeFile(publicReport, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  await chmod(publicReport, 0o644);
  await gateway.close();
  console.log(
    `SDK verification ${report.status}: ${checks.length} checks, ${transactions.length} confirmed transactions`,
  );
  console.log(`Public report: ${publicReport}`);
  if (report.status !== "passed") process.exitCode = 1;
}

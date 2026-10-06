/** Offline ABI parity for every generated instruction; no RPC or signing files. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createNoopSigner,
  isSignerRole,
  isWritableRole,
  type Instruction,
} from "@solana/kit";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import * as sdk from "../ts/index.js";
import { callRustSdk } from "./rust-transport.js";

export async function verifyCodecs(rustBinary: string): Promise<string[]> {
  const rust = (request: Record<string, unknown>) =>
    callRustSdk(rustBinary, request);
  const program = sdk.QUORUM_ALLOCATION_PROGRAM_ADDRESS;
  const checks: string[] = [];
  const admin = Keypair.generate();
  const ops = [Keypair.generate()];
  const signer = (key: Keypair) =>
    createNoopSigner(address(key.publicKey.toBase58()));
  const pk = (value: string) => new PublicKey(value);
  const a = (value: string) => address(value);
  const registry = await sdk.getRegistryAddress();
  const allocationState = await sdk.getAllocationStateAddress();
  const system = SystemProgram.programId.toBase58();
  const pool = 200;
  const metric = 230;
  const feeds = [await sdk.getDataFeedAddress(pool, metric)];
  const values = [9_007_199_254_740_993n];
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
  async function parity(
    name: string,
    ix: Instruction,
    accounts: Record<string, string>,
    params: Record<string, unknown> = {},
  ) {
    const result = await rust({
      command: "instruction",
      instruction: name,
      accounts,
      params,
    });
    const native = transport(ix);
    assert.equal(result.program, program);
    assert.equal(result.data, native.data.toString("base64"), `${name} bytes`);
    assert.deepEqual(
      result.accounts,
      native.keys.map((m) => ({
        address: m.pubkey.toBase58(),
        signer: m.isSigner,
        writable: m.isWritable,
      })),
      `${name} account privileges`,
    );
    checks.push(`Rust/TypeScript instruction parity: ${name}`);
  }
  const adminAddress = admin.publicKey.toBase58();
  const opAddress = ops[0]!.publicKey.toBase58();
  const common = { registry, admin: adminAddress, system_program: system };
  const dummyWindow = 9_007_199_254_740_993n;
  const sample = await sdk.getSampleConsensusAddress(pool, metric, dummyWindow);
  const roundAccount = await sdk.getAllocationConsensusAddress(dummyWindow);
  const programData = PublicKey.findProgramAddressSync(
    [pk(program).toBuffer()],
    pk("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0].toBase58();
  const weights = Array.from({ length: 16 }, (_, i) =>
    i === 0 ? 6000 : i === 1 ? 4000 : 0,
  );
  await parity(
    "init_registry",
    sdk.getInitRegistryInstruction({
      registry,
      admin: signer(admin),
      program: a(program),
      programData: a(programData),
    }),
    { ...common, program, program_data: programData },
  );
  await parity(
    "add_operator",
    sdk.getAddOperatorInstruction({
      registry,
      admin: signer(admin),
      operator: a(opAddress),
    }),
    common,
    { operator: opAddress },
  );
  await parity(
    "remove_operator",
    sdk.getRemoveOperatorInstruction({
      registry,
      admin: signer(admin),
      operator: a(opAddress),
    }),
    common,
    { operator: opAddress },
  );
  await parity(
    "init_data_feed",
    sdk.getInitDataFeedInstruction({
      registry,
      dataFeed: feeds[0]!,
      admin: signer(admin),
      poolId: pool,
      dataId: metric,
      config: kitConfig,
    }),
    { ...common, data_feed: feeds[0]! },
    { pool_id: pool, data_id: metric, config },
  );
  await parity(
    "update_thresholds",
    sdk.getUpdateThresholdsInstruction({
      registry,
      dataFeed: feeds[0]!,
      admin: signer(admin),
      config: kitConfig,
    }),
    { ...common, data_feed: feeds[0]! },
    { config },
  );
  await parity(
    "propose_sample",
    sdk.getProposeSampleInstruction({
      registry,
      dataFeed: feeds[0]!,
      consensus: sample,
      operator: signer(ops[0]!),
      windowIndex: dummyWindow,
      value: 18_446_744_073_709_551_615n,
      slotAtRead: dummyWindow,
    }),
    {
      registry,
      data_feed: feeds[0]!,
      consensus: sample,
      operator: opAddress,
      system_program: system,
    },
    {
      window_index: dummyWindow.toString(),
      value: "18446744073709551615",
      slot_at_read: dummyWindow.toString(),
    },
  );
  await parity(
    "corroborate_sample",
    sdk.getCorroborateSampleInstruction({
      registry,
      dataFeed: feeds[0]!,
      consensus: sample,
      operator: signer(ops[0]!),
      windowIndex: dummyWindow,
      value: values[0]!,
      slotAtRead: dummyWindow,
    }),
    { registry, data_feed: feeds[0]!, consensus: sample, operator: opAddress },
    {
      window_index: dummyWindow.toString(),
      value: values[0]!.toString(),
      slot_at_read: dummyWindow.toString(),
    },
  );
  await parity(
    "finalize_sample",
    sdk.getFinalizeSampleInstruction({
      dataFeed: feeds[0]!,
      consensus: sample,
      cranker: signer(admin),
      windowIndex: dummyWindow,
    }),
    { data_feed: feeds[0]!, consensus: sample, cranker: adminAddress },
    { window_index: dummyWindow.toString() },
  );
  await parity(
    "init_allocation_state",
    sdk.getInitAllocationStateInstruction({
      registry,
      allocationState,
      admin: signer(admin),
    }),
    { ...common, allocation_state: allocationState },
  );
  await parity(
    "open_allocation_round",
    sdk.getOpenAllocationRoundInstruction({
      registry,
      consensus: roundAccount,
      admin: signer(admin),
      round: dummyWindow,
      closesAtSlot: dummyWindow + 256n,
      minNumber: 2,
      rule: 0,
      trimPct: 0,
    }),
    { ...common, consensus: roundAccount },
    {
      round: dummyWindow.toString(),
      closes_at_slot: (dummyWindow + 256n).toString(),
      min_number: 2,
      rule: 0,
      trim_pct: 0,
    },
  );
  await parity(
    "submit_weights",
    sdk.getSubmitWeightsInstruction({
      registry,
      consensus: roundAccount,
      operator: signer(ops[0]!),
      round: dummyWindow,
      weights,
    }),
    { registry, consensus: roundAccount, operator: opAddress },
    { round: dummyWindow.toString(), weights },
  );
  await parity(
    "finalize_allocation",
    sdk.getFinalizeAllocationInstruction({
      consensus: roundAccount,
      allocationState,
      cranker: signer(admin),
      round: dummyWindow,
    }),
    {
      consensus: roundAccount,
      allocation_state: allocationState,
      cranker: adminAddress,
    },
    { round: dummyWindow.toString() },
  );
  return checks;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(import.meta.dirname, "../../..");
  const binary =
    process.env.SDK_RUST_VERIFY_BIN ??
    resolve(root, "workers/target/debug/quorum-sdk-verify");
  const checks = await verifyCodecs(binary);
  console.log(
    `Offline SDK verification passed: ${checks.length} instruction byte/account-privilege checks`,
  );
}

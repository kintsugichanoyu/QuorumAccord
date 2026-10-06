import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const result = spawnSync(
  "cargo",
  [
    "run",
    "--locked",
    "--manifest-path",
    resolve(root, "sdk/idl-builder/Cargo.toml"),
    "--",
    resolve(root, "programs/quorum-allocation"),
    resolve(root, "sdk/idl/quorum_allocation.json"),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? "1.96.0",
      CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? resolve(root, "target"),
    },
  },
);
assert.equal(result.status, 0, "IDL compilation failed");

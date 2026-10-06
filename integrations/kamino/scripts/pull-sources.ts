/** Fetch and verify the exact public research sources. No signing state is read. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const lock = JSON.parse(
  await readFile(resolve(root, "integrations/kamino/source-lock.json"), "utf8"),
);
const state = resolve(root, "testing/devnet/.state/integrations/kamino");
await mkdir(state, { recursive: true });
function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
for (const repo of lock.repositories) {
  const directory = resolve(state, repo.name);
  try {
    await readFile(resolve(directory, ".git/HEAD"));
  } catch {
    await mkdir(directory, { recursive: true });
    git(directory, ["init"]);
    git(directory, ["remote", "add", "origin", repo.repository]);
    git(directory, ["fetch", "--depth", "1", "origin", repo.revision]);
    git(directory, ["checkout", "--detach", "FETCH_HEAD"]);
  }
  assert.equal(
    git(directory, ["rev-parse", "HEAD"]),
    repo.revision,
    "existing checkout has a different revision",
  );
  for (const file of repo.files) {
    const data = await readFile(resolve(directory, file.path));
    assert.equal(
      createHash("sha256").update(data).digest("hex"),
      file.sha256,
      file.path,
    );
  }
  console.log(
    `Verified ${repo.name} ${repo.revision}: ${repo.files.length} source hashes`,
  );
}
const response = await fetch(lock.official_release.binary_url);
assert(response.ok, `release download: HTTP ${response.status}`);
const binary = Buffer.from(await response.arrayBuffer());
assert.equal(binary.length, lock.official_release.bytes);
assert.equal(
  createHash("sha256").update(binary).digest("hex"),
  lock.official_release.sha256,
);
const binaryPath = resolve(state, "kamino_lending-v1.25.0.so");
await writeFile(binaryPath, binary);
console.log(`Verified official release ELF: ${lock.official_release.sha256}`);
console.log(`Sources and binary retained in ${state}`);

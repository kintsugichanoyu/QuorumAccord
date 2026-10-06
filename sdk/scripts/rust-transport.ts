import { spawn } from "node:child_process";

export async function callRustSdk(
  rustBinary: string,
  request: Record<string, unknown>,
): Promise<Record<string, any>> {
  return new Promise((done, reject) => {
    const child = spawn(rustBinary, [], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (errors += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0)
        reject(new Error(`Rust SDK verification failed: ${errors}`));
      else {
        try {
          done(JSON.parse(output));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

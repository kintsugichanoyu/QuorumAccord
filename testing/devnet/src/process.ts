import { execFile, type ExecFileOptions } from 'node:child_process';

export interface CommandResult { code: number; stdout: string; stderr: string }
export function command(binary: string, args: string[], options: ExecFileOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(binary, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 180_000, ...options }, (error, stdout, stderr) => {
      resolve({ code: error ? typeof error.code === 'number' ? error.code : 1 : 0,
        stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

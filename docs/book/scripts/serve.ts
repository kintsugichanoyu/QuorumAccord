import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const local = join(homedir(), '.local/share/reflect-toolchains/mdbook-v0.5.4/mdbook');
const binary = process.env.MDBOOK_BIN ?? (existsSync(local) ? local : 'mdbook');
const child = spawn(binary, ['serve', resolve(import.meta.dirname, '..'), '--hostname', '127.0.0.1', '--port', '4100'], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));

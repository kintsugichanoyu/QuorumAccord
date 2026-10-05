import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mdbook } from './mdbook.ts';

const child = spawn(mdbook, ['serve', resolve(import.meta.dirname, '..'), '--hostname', '127.0.0.1', '--port', '4100'], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));

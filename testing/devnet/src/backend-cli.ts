import { parseArgs } from 'node:util';
import { createBackend } from './backend.js';

const { values } = parseArgs({ options: { port: { type: 'string', default: '18787' } } });
const backend = createBackend(console.error);
backend.listen(Number(values.port), '127.0.0.1', () => console.error('TEST ONLY backend listening', backend.address()));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => backend.close());

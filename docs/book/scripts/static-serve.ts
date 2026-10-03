/** Loopback-only static server used by TypeScript browser tests. */
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../build');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const target = await realpath(resolve(root, `.${path === '/' ? '/index.html' : path}`));
    if (!target.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' }).end(await readFile(target));
  } catch { response.writeHead(404).end(); }
});
server.listen(4171, '127.0.0.1', () => console.log('Book test server: http://127.0.0.1:4171'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));

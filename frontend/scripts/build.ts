import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';

const frontend = resolve(import.meta.dirname, '..');
const output = join(frontend, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(frontend, 'public'), output, { recursive: true });
await cp(resolve(frontend, '../docs/book/build'), join(output, 'book'), { recursive: true });
await build({ entryPoints: [join(frontend, 'ui/main.ts')], outfile: join(output, 'app.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true });

// Make broken handbook entry points a build failure.
const html = await readFile(join(output, 'index.html'), 'utf8');
for (const match of html.matchAll(/href="(book\/[^"]+)"/g)) {
  await readFile(join(output, match[1]!.split('#')[0]!));
}
assert(html.includes('Quorum'), 'Missing Quorum branding');
console.log('Built Quorum frontend and handbook: frontend/dist/');

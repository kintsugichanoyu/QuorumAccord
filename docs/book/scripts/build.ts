import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { PROGRAM } from '../ui/model.ts';
import { mdbook } from './mdbook.ts';

const root = resolve(import.meta.dirname, '../../..');
const book = join(root, 'docs/book');
const version = spawnSync(mdbook, ['--version'], { encoding: 'utf8' });
assert(version.status === 0 && version.stdout.trim() === 'mdbook v0.5.4', 'Install mdBook 0.5.4 or set MDBOOK_BIN to that binary');
await mkdir(join(book, '.generated'), { recursive: true });
await build({ entryPoints: [join(book, 'ui/inspector.ts')], outfile: join(book, '.generated/inspector.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true });
const evidence = join(root, 'testing/devnet/evidence');
const reports = await Promise.all((await readdir(evidence)).filter(n => /^typescript-devnet.*\.json$/.test(n))
  .map(async name => ({ name, report: JSON.parse(await readFile(join(evidence, name), 'utf8')) as { completed_at?: string; program?: string } })));
reports.sort((a, b) => Date.parse(b.report.completed_at ?? '') - Date.parse(a.report.completed_at ?? ''));
assert(reports.length > 0, 'No committed public devnet evidence');
assert.equal(reports[0]!.report.program, PROGRAM, 'Update the pinned browser deployment before publishing evidence for a different program');
await mkdir(join(book, 'src/evidence'), { recursive: true });
await copyFile(join(evidence, reports[0]!.name), join(book, 'src/evidence/latest-devnet.json'));
const sdkReports = await Promise.all((await readdir(evidence)).filter(n => /^sdk-devnet.*\.json$/.test(n))
  .map(async name => ({ name, report: JSON.parse(await readFile(join(evidence, name), 'utf8')) as
    { completed_at?: string; program?: string; status?: string; network?: string } })));
const verifiedSdkReports = sdkReports.filter(({ report }) => report.status === 'passed' && report.network === 'devnet');
verifiedSdkReports.sort((a, b) => Date.parse(b.report.completed_at ?? '') - Date.parse(a.report.completed_at ?? ''));
assert(verifiedSdkReports.length > 0, 'No committed successful SDK devnet evidence');
assert.equal(verifiedSdkReports[0]!.report.program, PROGRAM, 'SDK evidence must match the documented deployment');
await copyFile(join(evidence, verifiedSdkReports[0]!.name), join(book, 'src/evidence/latest-sdk-devnet.json'));
await chmod(join(book, 'src/evidence/latest-sdk-devnet.json'), 0o644);
for (const name of ['kamino-mainnet-2026-10-06.json', 'kamino-devnet-2026-10-06.json']) {
  const source = join(root, 'integrations/evidence', name);
  const report = JSON.parse(await readFile(source, 'utf8')) as {
    read_only?: boolean; accounts?: { address: string }[];
  };
  assert.equal(report.read_only, true, 'Only read-only Kamino research evidence is bundled');
  assert(report.accounts?.some(a => a.address === 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
    'Kamino evidence must identify the documented lending program');
  await copyFile(source, join(book, 'src/evidence', name));
  await chmod(join(book, 'src/evidence', name), 0o644);
}
await writeFile(join(book, 'src/evidence/source.json'), JSON.stringify({ source: `testing/devnet/evidence/${reports[0]!.name}`, mdbook: '0.5.4' }, null, 2) + '\n');
const result = spawnSync(mdbook, ['build', book], { stdio: 'inherit' });
assert.equal(result.status, 0, 'mdBook build failed');
console.log('Built mdBook frontend: docs/book/build (public evidence only; no .state files)');

import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const args = process.argv.slice(2);
const outArg = args.indexOf('--output');
const out = path.resolve(outArg < 0 ? 'tests/module1-lcy/results' : args[outArg + 1]);
const bugsOnly = args.includes('--bugs-only');
const selected = /M1-049|M1-059|M1-060|M1-061/;
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync('tests/module1-lcy/generated', { recursive: true });
for (const name of ['unit.json', 'browser.json', 'summary.json']) fs.rmSync(path.join(out, name), { force: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [
  ['unit', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tests/module1-lcy/vitest.config.ts', '--reporter=default', '--reporter=json', `--outputFile=${out}/unit.json`, ...(bugsOnly ? ['-t', selected.source] : [])]],
  ['chrome-build', npm, ['run', 'build:chrome']],
  ['client-build', process.execPath, ['tests/module1-lcy/build-client.mjs']],
  ['browser', process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/module1-lcy/playwright.config.ts', ...(bugsOnly ? ['--grep', selected.source] : [])]],
];
const execution = [];
for (const [name, command, commandArgs] of steps) {
  if (name === 'browser' && execution.some(s => s.name.endsWith('build') && s.exitCode !== 0)) { execution.push({ name, exitCode: null, reason: 'build failed' }); continue; }
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', env: { ...process.env, LCY_RESULTS: out }, maxBuffer: 20 * 1024 * 1024 });
  const output = (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? '');
  fs.writeFileSync(path.join(out, `${name}.log`), output); process.stdout.write(output);
  execution.push({ name, command: [command, ...commandArgs], startedAt, exitCode: result.status });
}
const observed = new Map(); const duplicates = [];
function record(title, status, durationMs, errors) { const id = title.match(/M1-\d{3}/)?.[0]; if (!id) return; if (observed.has(id)) duplicates.push(id); observed.set(id, { status, durationMs, errors }); }
if (fs.existsSync(path.join(out, 'unit.json'))) {
  for (const f of JSON.parse(fs.readFileSync(path.join(out, 'unit.json'))).testResults ?? []) for (const a of f.assertionResults ?? []) record(a.fullName, a.status === 'pending' ? 'skipped' : a.status, a.duration, a.failureMessages);
}
function visit(suites) { for (const suite of suites ?? []) { for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) { const r = t.results?.at(-1); record(spec.title, r?.status ?? 'not-run', r?.duration, r?.errors ?? []); } visit(suite.suites); } }
if (fs.existsSync(path.join(out, 'browser.json'))) visit(JSON.parse(fs.readFileSync(path.join(out, 'browser.json'))).suites);
const design = JSON.parse(fs.readFileSync('tests/module1-lcy/cases.json', 'utf8'));
const cases = design.filter(c => !bugsOnly || selected.test(c.id)).map(c => ({ ...c, ...(observed.get(c.id) ?? { status: 'not-run' }) }));
let commit = 'unavailable', workingTree = '';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); workingTree = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }); } catch {}
const files = ['apps/extension/src/realtime-client.ts', 'packages/shared/src/protocol.ts', 'apps/extension/src/content.ts', 'apps/gateway/src/server.ts'];
const hashes = Object.fromEntries(files.map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const summary = { executedAt: new Date().toISOString(), owner: '李承远', class: '软工2602班', commit, workingTree, hashes, environment: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, memoryGiB: Math.round(os.totalmem()/2**30), vitest: JSON.parse(fs.readFileSync('node_modules/vitest/package.json')).version, playwright: JSON.parse(fs.readFileSync('node_modules/@playwright/test/package.json')).version }, execution, designed: design.length, total: cases.length, passed: cases.filter(c => c.status === 'passed').length, failed: cases.filter(c => ['failed','timedOut','interrupted'].includes(c.status)).length, skipped: cases.filter(c => c.status === 'skipped').length, notRun: cases.filter(c => c.status === 'not-run').length, duplicates, cases };
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`LCY module1: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.notRun} not-run`);
process.exitCode = execution.some(s => s.exitCode !== 0) || summary.passed !== summary.total || duplicates.length ? 1 : 0;

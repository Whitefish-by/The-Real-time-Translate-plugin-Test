import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const out = path.join(root, 'tests/module1/results');
fs.mkdirSync(out, { recursive: true });
for (const f of ['unit.json', 'browser.json', 'summary.json'])
    fs.rmSync(path.join(out, f), { force: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [['unit', [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'tests/module1/vitest.config.ts', '--reporter=default', '--reporter=json', `--outputFile=${out}/unit.json`]], ['build', [npm, 'run', 'build:chrome']], ['browser', [process.execPath, 'node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/module1/playwright.config.ts']]];
const execution = [];
let failed = false;
for (const [name, [cmd, ...args]] of steps) {
    if (name === 'browser' && execution.find(s => s.name === 'build')?.exitCode !== 0) {
        execution.push({ name, exitCode: null, reason: 'build failed' });
        failed = true;
        continue;
    }
    const startedAt = new Date().toISOString();
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    const log = (r.stdout ?? '') + (r.stderr ?? '') + (r.error?.message ?? '');
    process.stdout.write(log);
    fs.writeFileSync(path.join(out, `${name}.log`), log);
    execution.push({ name, startedAt, exitCode: r.status });
    if (r.status !== 0)
        failed = true;
}
const observed = new Map();
if (fs.existsSync(`${out}/unit.json`)) {
    const j = JSON.parse(fs.readFileSync(`${out}/unit.json`));
    for (const f of j.testResults)
        for (const a of f.assertionResults) {
            const id = a.fullName.match(/M1-\d{3}/)?.[0];
            if (id)
                observed.set(id, { status: a.status, durationMs: a.duration, errors: a.failureMessages });
        }
}
function visit(suites) { for (const s of suites ?? []) {
    for (const spec of s.specs ?? [])
        for (const t of spec.tests ?? []) {
            const id = spec.title.match(/M1-\d{3}/)?.[0];
            const result = t.results.at(-1);
            if (id)
                observed.set(id, { status: result?.status ?? 'not-run', durationMs: result?.duration, errors: result?.errors ?? [] });
        }
    visit(s.suites);
} }
if (fs.existsSync(`${out}/browser.json`))
    visit(JSON.parse(fs.readFileSync(`${out}/browser.json`)).suites);
const cases = JSON.parse(fs.readFileSync('tests/module1/cases.json')).map(c => ({ ...c, ...(observed.get(c.id) ?? { status: 'not-run' }) }));
if (cases.some(c => c.status !== 'passed'))
    failed = true;
let commit = 'unavailable';
try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
catch { }
const summary = { executedAt: new Date().toISOString(), commit, workingTree: 'includes module1 tests and fixes; see source hashes', environment: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, memoryGiB: Math.round(os.totalmem() / 2 ** 30) }, execution, total: cases.length, passed: cases.filter(c => c.status === 'passed').length, failed: cases.filter(c => ['failed', 'timedOut', 'interrupted'].includes(c.status)).length, notPassed: cases.filter(c => c.status !== 'passed').length, cases };
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
console.log(`Module 1: ${summary.passed}/${summary.total} passed; ${summary.notPassed} not passed. Results: tests/module1/results/summary.json`);
process.exitCode = failed ? 1 : 0;

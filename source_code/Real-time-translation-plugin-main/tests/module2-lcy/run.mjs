import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = resolve(root, 'tests/module2-lcy');
const out = resolve(dir, 'results'); mkdirSync(out, { recursive: true });
const cases = JSON.parse(readFileSync(resolve(dir, 'cases.json'), 'utf8'));
rmSync(resolve(out, 'unit.json'), { force: true });
rmSync(resolve(out, 'summary.json'), { force: true });
const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tests/module2-lcy/vitest.config.ts', '--reporter=default', '--reporter=json', '--outputFile.json=tests/module2-lcy/results/unit.json'], { cwd: root, encoding: 'utf8' });
const log = (run.stdout ?? '') + (run.stderr ?? ''); writeFileSync(resolve(out, 'unit.log'), log); process.stdout.write(log);
let rows = [], issues = [];
try {
 const report = JSON.parse(readFileSync(resolve(out, 'unit.json'), 'utf8'));
 rows = report.testResults.flatMap(t => t.assertionResults).map(t => ({ id: t.title.match(/M2-LCY-\d{3}/)?.[0], status: t.status, title: t.title }));
 const ids = rows.map(r => r.id), expected = cases.map(c => c.id);
 if (new Set(expected).size !== expected.length || expected.length < 20) issues.push('用例清单编号重复或不足20条');
 if (rows.length !== expected.length || new Set(ids).size !== ids.length || ids.some(id => !expected.includes(id)) || expected.some(id => !ids.includes(id))) issues.push('执行编号缺失、重复或不在清单中');
 if (report.numFailedTestSuites > 0) issues.push('测试套件执行失败');
} catch (e) { issues.push(String(e)); }
const status = rows.filter(r => r.status === 'passed').length;
const source = readFileSync(resolve(root, 'apps/gateway/src/providers/azure.ts'));
let baseCommit = null;
try { baseCommit = execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch { /* An exported source archive need not contain Git metadata. */ }
const summary = { executedAt: new Date().toISOString(), baseCommit, environment: {node:process.version,os:os.platform(),release:os.release(),arch:os.arch(),vitest:JSON.parse(readFileSync(resolve(root,'node_modules/vitest/package.json'))).version,speechSdk:JSON.parse(readFileSync(resolve(root,'node_modules/microsoft-cognitiveservices-speech-sdk/package.json'))).version},sourceSha256:createHash('sha256').update(source).digest('hex'), total:cases.length, executed:rows.length,passed:status,failed:rows.filter(r=>r.status==='failed').length,skipped:rows.filter(r=>!['passed','failed'].includes(r.status)).length, methods:Object.fromEntries([...new Set(cases.map(c=>c.method))].map(m=>[m,cases.filter(c=>c.method===m).length])), issues, cases:rows };
writeFileSync(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(`M2-LCY: ${status}/${cases.length} passed; integrity issues: ${issues.length}`);
process.exitCode = run.status === 0 && issues.length === 0 && status === cases.length ? 0 : 1;

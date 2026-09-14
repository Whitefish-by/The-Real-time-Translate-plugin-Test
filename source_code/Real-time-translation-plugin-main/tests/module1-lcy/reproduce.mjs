import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'module1-lcy-reproduce-'));
const output = path.resolve(root, process.argv[2] ?? 'tests/module1-lcy/reproduce-results');
try {
  const excluded = new Set(['node_modules', 'dist', 'dist-safari', 'results', 'reproduce-results', 'generated', 'test-results', 'playwright-report', '.git']);
  fs.cpSync(root, temp, { recursive: true, filter: source => !path.relative(root, source).split(path.sep).some(p => excluded.has(p) || (p.startsWith('.env') && p !== '.env.example')) });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const snapshots = JSON.parse(fs.readFileSync(path.join(root, 'tests/module1-lcy/original-sources.json'), 'utf8'));
  for (const [relative, content] of Object.entries(snapshots)) fs.writeFileSync(path.join(temp, relative), content);
  const result = spawnSync(process.execPath, ['tests/module1-lcy/run.mjs', '--bugs-only', '--output', output], { cwd: temp, stdio: 'inherit', env: process.env });
  // Keep the failure exit code. A reproduction failure is not a passing regression run.
  process.exitCode = result.status ?? 1;
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const selected = process.argv[2] ?? 'all';
const pattern = selected === 'BUG-M1-001' ? 'M1-025' : selected === 'BUG-M1-002' ? 'M1-027' : selected === 'all' ? 'M1-025|M1-027' : null;
if (!pattern)
    throw Error('Expected all, BUG-M1-001 or BUG-M1-002');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'module1-original-'));
try {
    for (const name of ['packages', 'apps', 'tests', 'package.json', 'tsconfig.base.json'])
        fs.cpSync(path.join(root, name), path.join(tmp, name), { recursive: true, filter: src => !['node_modules', 'results', 'dist', 'dist-safari', '.env'].includes(path.basename(src)) });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const originals = JSON.parse(fs.readFileSync(path.join(root, 'tests/module1/original-sources.json')));
    for (const [name, text] of Object.entries(originals))
        fs.writeFileSync(path.join(tmp, name), text);
    const r = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'tests/module1/vitest.config.ts', '-t', pattern], { cwd: tmp, stdio: 'inherit' });
    console.log('原版缺陷复现预期返回非零；当前源码未修改。');
    process.exitCode = r.status ?? 1;
}
finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

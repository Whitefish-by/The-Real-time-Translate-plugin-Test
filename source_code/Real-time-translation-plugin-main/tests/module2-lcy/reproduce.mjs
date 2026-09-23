import { mkdtempSync, cpSync, copyFileSync, symlinkSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'module2-lcy-reproduce-'));
const out = resolve(root,'tests/module2-lcy/results'); mkdirSync(out,{recursive:true});
try {
 for(const name of ['apps','packages','tests/module2-lcy']) cpSync(resolve(root,name),join(folder,name),{recursive:true,filter:p=>!/(node_modules|\/dist(?:\/|$)|\/results(?:\/|$))/.test(p)});
 for(const name of ['package.json','tsconfig.base.json']) copyFileSync(resolve(root,name),join(folder,name));
 symlinkSync(resolve(root,'node_modules'),join(folder,'node_modules'),'dir');
 copyFileSync(resolve(root,'tests/module2-lcy/baseline/azure.ts.txt'),join(folder,'apps/gateway/src/providers/azure.ts'));
 const run = spawnSync(process.execPath,[resolve(root,'node_modules/vitest/vitest.mjs'),'run','--config','tests/module2-lcy/vitest.config.ts','--reporter=default','--reporter=json',`--outputFile.json=${join(out,'baseline-unit.json')}`],{cwd:folder,encoding:'utf8'});
 const log=(run.stdout??'')+(run.stderr??''); writeFileSync(join(out,'baseline.log'),log);process.stdout.write(log);
 // Red tests are the expected evidence; preserve Vitest's nonzero exit status.
 process.exitCode=run.status??1;
} finally { rmSync(folder,{recursive:true,force:true}); }

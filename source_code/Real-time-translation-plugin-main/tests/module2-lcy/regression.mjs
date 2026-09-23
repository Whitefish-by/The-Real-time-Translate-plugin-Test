import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=root+'/tests/module2-lcy/results';
fs.mkdirSync(out,{recursive:true});
const checks=[
 ...['packages/shared','apps/gateway','apps/extension'].map(p=>[p+'-types',['node_modules/typescript/bin/tsc','-p',p+'/tsconfig.json','--noEmit']]),
 ['lcy-types',['node_modules/typescript/bin/tsc','-p','tests/module2-lcy/tsconfig.json','--noEmit']],
 ['product',['node_modules/vitest/vitest.mjs','run','packages/shared/src','apps/gateway/src','apps/extension/src','--reporter=json','--outputFile='+out+'/product.json']],
 ...['module1','module1-lcy','module2-ai'].map(p=>[p,['node_modules/vitest/vitest.mjs','run','--config','tests/'+p+'/vitest.config.ts','--reporter=json','--outputFile='+out+'/'+p+'.json']])
];
const rows=[];
for(const [name,args] of checks){const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...process.env,PATH:process.execPath.slice(0,process.execPath.lastIndexOf('/'))+':'+process.env.PATH}});fs.writeFileSync(out+'/'+name.replaceAll('/','-')+'.log',(r.stdout??'')+(r.stderr??''));rows.push({name,status:r.status});console.log(name,r.status);}
fs.writeFileSync(out+'/regression.json',JSON.stringify(rows,null,2));process.exitCode=rows.some(r=>r.status!==0)?1:0;

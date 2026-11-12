import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-exports-http-')),path=join(dir,'db.sqlite'),d=new DatabaseSync(path),base='http://127.0.0.1:3127',origin='https://crm.test',password='synthetic-exports-only',require=createRequire(import.meta.url);
let server,logs='';
try{
 d.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)d.exec(sql);
 const hash=await hashPassword(password);
 for(const [id,role,department] of [['a','admin',''],['b','admin',''],['h','department_head','1'],['o','operator','1']]){d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role,department}));d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);}
 d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c','79991111111',JSON.stringify({id:'c',name:'Synthetic',phone:'79991111111',baseType:'M',owner:'o',sheet:'П'}));
 d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 d.prepare("INSERT INTO settings VALUES('premium-ledger',?)").run(JSON.stringify({revision:'test',activePeriod:'2026-11-1',initialPeriod:'2026-11-1',periods:{'2026-11-1':{status:'open',signatures:{}}}}));
 await build({entryPoints:['scripts/sync-exports.mjs'],bundle:true,platform:'node',format:'esm',plugins:[{name:'exceljs',setup(b){b.onResolve({filter:/^exceljs$/},()=>({path:pathToFileURL(require.resolve('exceljs')).href,external:true}));}}],outfile:join(dir,'worker.mjs'),logLevel:'silent'});
 const env={...process.env,CRM_DATABASE_PATH:path,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_EXPORT_DIRECTORY:join(dir,'files')};
 const worker=async()=>{const p=spawn(process.execPath,[join(dir,'worker.mjs')],{env,stdio:['ignore','ignore','pipe']});p.stderr.on('data',x=>logs+=x);const [code]=await once(p,'exit');assert.equal(code,0,logs);};
 async function start(enabled){server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...env,CRM_EXPORT_WORKER:enabled?'1':'0',HOSTNAME:'127.0.0.1',PORT:'3127'},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);for(let i=0;i<200;i++){try{await fetch(base+'/login');return;}catch{await new Promise(r=>setTimeout(r,100));}}throw Error(logs);}
 await start(true);
 const cookies={};for(const login of ['a','b','h','o']){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(r.status,200,await r.text());cookies[login]=r.headers.get('set-cookie').split(';')[0];}
 const post=(who,body,from=origin)=>fetch(base+'/api/exports',{method:'POST',headers:{cookie:cookies[who],Origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const get=(who,q)=>fetch(base+'/api/exports?'+q,{headers:{cookie:cookies[who]}});
 const request={kind:'base',parameter:'M',requestKey:'same-request'};
 assert.equal((await fetch(base+'/api/exports?id=missing')).status,401);
 assert.equal((await post('o',request)).status,403);assert.equal((await post('h',request)).status,403);
 assert.equal((await post('a',request,'https://evil.test')).status,403);
 assert.equal((await post('a',request)).status,503,'no silent foreground fallback when worker is unavailable');
 await worker();
 let r=await post('a',request);assert.equal(r.status,202,await r.clone().text());const job=await r.json();
 assert.equal((await (await post('a',request)).json()).id,job.id);
 assert.equal((await get('b','id='+job.id)).status,404);assert.equal((await get('a','id='+job.id+'&download=1')).status,409);
 await worker();r=await get('a','id='+job.id+'&download=1');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/spreadsheetml/);assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0,2).toString(),'PK');
 const premium=await (await post('h',{kind:'premium',parameter:'2026-11-1',requestKey:'premium'})).json();await worker();assert.equal((await get('h','id='+premium.id+'&download=1')).status,200);
 d.prepare("UPDATE employees SET data=json_set(data,'$.department','2') WHERE id='h'").run();assert.equal((await get('h','id='+premium.id)).status,404);
 d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='a'").run();assert.equal((await get('a','id='+job.id+'&download=1')).status,401);
 server.kill();await once(server,'exit');await start(false);
 r=await post('b',request);assert.equal(r.status,409);assert.equal((await r.json()).backgroundDisabled,true);
 r=await fetch(base+'/api/base/export',{headers:{cookie:cookies.b}});assert.equal(r.status,400);
 r=await fetch(base+'/api/base/export?base=M',{headers:{cookie:cookies.b}});assert.equal(r.status,200);assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0,2).toString(),'PK');
 console.log('Exports HTTP: authentication, CSRF, owner/scope revocation, queue retry, worker outage, XLSX download and disabled legacy fallback passed');
}catch(error){console.error(logs);throw error;}finally{if(server&&server.exitCode===null){server.kill();await once(server,'exit');}d.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-exports-http-'));rmSync(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-merge-')),file=join(dir,'db.sqlite'),db=new DatabaseSync(file),port='3395',origin='https://crm.test',base='http://127.0.0.1:'+port;
let server,logs='';
try{
 db.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));for(const sql of authSchema)db.exec(sql);
 const password='SyntheticMergePassword123',hash=await hashPassword(password);
 for(const [id,role] of [['admin','admin'],['head','department_head'],['one','operator'],['two','operator'],['chief','chief_logistic']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,role,name:id,login:id,department:'1',salary:0,bonus:0,version:1}));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 for(const [id,phone,owner] of [['c1','+79990000001','one'],['c2','+79990000002','two']])db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(id,phone,JSON.stringify({id,name:'Тестовый клиент',phone,owner,city:'Москва',address:'Адрес',sheet:'К',baseType:'M',source:'test',assignedUntil:'2026-12-10',createdAt:'2026-11-01',version:1}));
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 async function login(login){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
 async function call(cookie,body,validOrigin=origin){const r=await fetch(base+'/api/client-merge',{method:'POST',headers:{cookie,Origin:validOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 const cookie=await login('admin');await fetch(base+'/api/base-search?q=Тест&actorId=admin',{headers:{cookie}});
 for(const role of ['head','one','chief'])assert.equal((await call(await login(role),{action:'preview',ids:['c1','c2']})).status,403);
 assert.equal((await call(cookie,{action:'preview',ids:['c1','c2']},'https://evil.test')).status,403);
 const p=await call(cookie,{action:'preview',ids:['c1','c2']});assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.data.owners.length,2);assert.equal(db.prepare('SELECT count(*) n FROM clients').get().n,2);
 const body={action:'merge',ids:['c1','c2'],ownerClientId:'c1',phone:'+79990000002',revision:p.data.revision};
 assert.equal((await call(cookie,{...body,revision:'stale'})).status,409);
 const result=await call(cookie,body);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.client.owner,'one');assert.equal(db.prepare('SELECT count(*) n FROM clients').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM client_phone_index').get().n,2);
 assert.equal((await call(cookie,body)).status,409);assert.equal(db.prepare('SELECT count(*) n FROM client_merge_audit').get().n,1);
 console.log('client merge HTTP: admin-only, origin, preview, stale/retry guards, merge and phones passed');
}catch(e){console.error(logs);throw e;}finally{if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

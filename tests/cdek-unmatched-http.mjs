import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'cdek-unmatched-http-')),path=join(dir,'db.sqlite'),d=new DatabaseSync(path),base='http://127.0.0.1:3139',origin='https://crm.test',password='synthetic-registry-only';let server,logs='';
try{
 d.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)d.exec(sql);
 const hash=await hashPassword(password);
 for(const [id,role] of [['a','admin'],['o','operator'],['h','department_head'],['l','logistic']]){d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role,department:'5'}));d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);}
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_DATABASE_PATH:path,CRM_ORIGIN:origin,HOSTNAME:'127.0.0.1',PORT:'3139'},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);for(let i=0;i<200;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const cookies={};for(const login of ['a','o','h','l']){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(r.status,200,await r.clone().text());cookies[login]=r.headers.get('set-cookie').split(';')[0];}
 const url=base+'/api/cdek/unmatched-remittances',get=(who,q='')=>fetch(url+q,{headers:{cookie:cookies[who]}});
 assert.equal((await fetch(url)).status,401);for(const who of ['o','h','l'])assert.equal((await get(who)).status,403);
 const empty=await get('a');assert.equal(empty.status,200,await empty.clone().text());assert.deepEqual(await empty.json(),{total:0,rows:[]});
 for(let i=0;i<51;i++){const receipt={slot:1,registry:'r'+i,tracking:'t'+i,paymentDate:'2026-11-10',amountCents:9000,collectedCents:10000};d.prepare('INSERT INTO cdek_unmatched_remittances VALUES(?,?,?,?,?)').run(JSON.stringify(receipt),1,receipt.tracking,receipt.paymentDate,new Date().toISOString());}

 for(const date of ['2026-02-16','2026-09-30','2026-10-01']){const receipt={slot:1,registry:date,tracking:date,paymentDate:date,amountCents:9000,collectedCents:10000};d.prepare('INSERT INTO cdek_unmatched_remittances VALUES(?,?,?,?,?)').run(JSON.stringify(receipt),1,date,date,new Date().toISOString());}
 assert.equal(d.prepare('SELECT COUNT(*) n FROM cdek_unmatched_remittances').get().n,54);
 let result=await (await get('a')).json();assert.equal(result.total,52);assert.equal(result.rows.length,50);assert.equal((await (await get('a','?page=1')).json()).rows.length,2);
 assert.ok(result.rows.every(r=>r.paymentDate>='2026-10-01'));assert.equal((await (await get('a','?page=1')).json()).rows.at(-1).paymentDate,'2026-10-01');
 for(const page of ['-1','NaN','1.5','100001'])assert.equal((await get('a','?page='+page)).status,400);
 assert.equal((await get('h','?actorId=a')).status,403);
 assert.equal((await fetch(url,{method:'POST',headers:{cookie:cookies.a,Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,405);
 console.log('Unmatched receipts API: admin-only, pagination, validation and read-only access passed');
}finally{if(server){server.kill();await once(server,'exit');}d.close();rmSync(dir,{recursive:true,force:true});}

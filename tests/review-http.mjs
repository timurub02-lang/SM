import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-review-')),file=join(dir,'db.sqlite'),raceFile=join(dir,'race.json');
const db=new DatabaseSync(file),port='3109',origin='https://crm.test',base='http://127.0.0.1:'+port;
let server,logs='';
try{
 db.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));
 for(const sql of authSchema)db.exec(sql);
 const password='SyntheticReviewPassword123',hash=await hashPassword(password);
 for(const [id,role] of [['admin','admin'],['head','department_head'],['one','operator']]){
  const e={id,name:id,login:id,alias:'',skLogin:'',role,department:'1',salary:0,bonus:0,version:1};
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify(e));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 const client={id:'c',name:'Synthetic client',phone:'+79990000001',owner:'one',address:'',city:'',source:'test',createdAt:new Date().toISOString(),sheet:'К',version:1};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c',client.phone,JSON.stringify(client));
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 server=spawn(process.execPath,['--require',resolve('tests/fixtures/sqlite-race.cjs'),resolve('.next/standalone/server.js')],{env:{...process.env,CRM_TEST_RACE_FILE:raceFile,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:'admin',password})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
 assert.equal((await call('/api/crm')).status,200);
 assert.equal((await call('/api/cash')).status,200);
 db.exec("UPDATE auth_accounts SET enabled=0 WHERE employee_id='head'");
 assert.equal((await call('/api/cash')).data.recipients.some(e=>e.id==='head'),false);
 db.exec("UPDATE auth_accounts SET enabled=1 WHERE employee_id='head'");
 // A busy other department must not push this department's incidents out of the page.
 assert.equal((await call('/api/activity')).status,200);
 const headLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:'head',password})});
 assert.equal(headLogin.status,200);
 db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run('other',JSON.stringify({id:'other',name:'Other',role:'operator',department:'2'}));
 db.prepare('INSERT INTO activity_incidents VALUES(?,?,?,?,?,?)').run('own','one','2026-01-01','2026-01-01',null,'fixture');
 for(let i=0;i<501;i++)db.prepare('INSERT INTO activity_incidents VALUES(?,?,?,?,?,?)').run('foreign-'+i,'other','2026-01-02','2026-01-02',null,'fixture');
 const activity=await fetch(base+'/api/activity',{headers:{cookie:headLogin.headers.get('set-cookie').split(';')[0]}});
 assert.equal(activity.status,200);assert.deepEqual((await activity.json()).incidents.map(i=>i.id),['own']);
 const inject=plan=>writeFileSync(raceFile,JSON.stringify(plan));
 const used=()=>assert.equal(existsSync(raceFile),false,'Fault injection must actually execute');
 // A completed cash operation lands after the zero-balance precheck.
 inject({match:'AS balance,EXISTS(SELECT 1 FROM cash_operations',method:'get',when:'after',sql:"INSERT INTO cash_operations(id,kind,recipient,amount,purpose,date,created_at,accepted_at,actor,sender_name,recipient_name) VALUES('race','add','head',100,'fixture','2026-01-01','2026-01-01','2026-01-01','head','','head')"});
 const removed=await call('/api/crm',{action:'deleteEmployee',id:'head',version:1,mode:'release'});used();
 assert.equal(removed.status,400,JSON.stringify(removed));assert.ok(db.prepare("SELECT id FROM employees WHERE id='head'").get());
 assert.equal(db.prepare("SELECT balance FROM cash_balances WHERE employee='head'").get().balance,100);
 db.exec("DELETE FROM cash_operations WHERE id='race'");
 // Payroll was frozen after the deletion snapshot: its signer must remain available.
 const payroll=JSON.stringify({periods:{fixture:{status:'frozen',signers:[{id:'head'}],rows:[]}}});
 inject({match:'INSERT INTO settings(id,data) SELECT ?,? WHERE (SELECT json_group_array',method:'run',when:'before',sql:"INSERT INTO settings(id,data) VALUES('premium-ledger','"+payroll+"')"});
 const payrollRemoval=await call('/api/crm',{action:'deleteEmployee',id:'head',version:1,mode:'release'});used();
 assert.equal(payrollRemoval.status,400,JSON.stringify(payrollRemoval));assert.ok(db.prepare("SELECT id FROM employees WHERE id='head'").get());
 db.exec("DELETE FROM settings WHERE id='premium-ledger'");
 // The recipient disappears after validation, before the money write.
 inject({match:'INSERT INTO cash_operations(id,kind,sender,recipient',method:'run',when:'before',sql:"DELETE FROM auth_accounts WHERE employee_id='head'; DELETE FROM employees WHERE id='head'"});
 const transferId=crypto.randomUUID();
 const transfer=await call('/api/cash',{action:'create',operation:{id:transferId,kind:'transfer',amount:1,date:'2026-01-01',purpose:'Перевод другому сотруднику',recipient:'head'}});used();
 assert.equal(transfer.status,400,JSON.stringify(transfer));assert.equal(db.prepare('SELECT id FROM cash_operations WHERE id=?').get(transferId),undefined);
 // A competing client edit invalidates order creation: no ghost event or order.
 inject({match:'INSERT INTO orders(id,client_id,data) SELECT',method:'run',when:'before',sql:"UPDATE clients SET version=version+1 WHERE id='c'"});
 const events=db.prepare('SELECT COUNT(*) n FROM events').get().n;
 const created=await call('/api/crm',{action:'createOrder',clientId:'c',items:[],addressConfirmed:true});used();
 assert.equal(created.status,400,JSON.stringify(created));assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,events);
 // A failed history insert must roll back assignment of an existing free client.
 db.exec("UPDATE clients SET data=json_set(data,'$.owner','','$.sheet','Т1') WHERE id='c'; CREATE TRIGGER fail_history BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'synthetic history failure'); END");
 const assigned=await call('/api/crm',{action:'createClient',baseType:'M',client:{...client,owner:'one'}});
 assert.equal(assigned.status,400,JSON.stringify(assigned));assert.equal(JSON.parse(db.prepare("SELECT data FROM clients WHERE id='c'").get().data).owner,'');
 db.exec('DROP TRIGGER fail_history');
 // Unassigned imported clients are included in explicit address normalization.
 db.exec("UPDATE clients SET data=json_set(data,'$.source','fixture.xlsx · Sheet','$.address','Synthetic address') WHERE id='c'");
 assert.equal((await call('/api/crm',{action:'normalizeImportedAddresses'})).status,200);
 const normalized=JSON.parse(db.prepare("SELECT data FROM clients WHERE id='c'").get().data);
 assert.equal(normalized.addressProcessed,true);assert.equal(normalized.addressProcessingError,true,'Missing credentials preserve the address for review without external calls');
 assert.equal(normalized.address,'Synthetic address');
 // SQL version is authoritative; JSON version can lag after any CRM/background write.
 db.prepare('INSERT INTO orders(id,client_id,data,version) VALUES(?,?,?,5)').run('postal','c',JSON.stringify({id:'postal',clientId:'c',manager:'one',status:'packing',delivery:'russian_post',address:'123456 Москва, дом 1',items:[],version:1}));
 db.prepare('INSERT INTO settings VALUES(?,?)').run('postal-form',JSON.stringify({sender:{name:'Sender',address:'Москва, дом 2',postalCode:'123456',phone:'+79990000002'},revision:'fixture'}));
 assert.equal((await call('/api/postal-form?orderId=postal&version=5')).status,200);
 assert.equal((await call('/api/postal-form?orderId=postal&version=1')).status,409);
 console.log('Review regressions: cash/delete races, no ghost orders/history, assignment rollback passed. No external services used.');
}catch(e){console.error(logs);throw e;}finally{
 if(server){server.kill();await once(server,'exit');}
 db.close();rmSync(dir,{recursive:true,force:true});
}

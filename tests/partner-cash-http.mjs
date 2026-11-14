// Synthetic database only: no production balances or signatures are changed.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'partner-cash-')),db=new DatabaseSync(join(dir,'db.sqlite'));
const origin='https://crm.test',port=process.env.AUTH_TEST_PORT||'3197',base=`http://127.0.0.1:${port}`,password='fixture-password-only-123';
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password);
 for(const [id,role] of [['admin','admin'],['A_Emil','department_head'],['head','department_head'],['operator','operator']]){
  const e={id,login:id,name:id,role,department:'5',salary:0,bonus:5,sz:false,version:1,...(id==='head'?{cashDisabled:true,leaderPremium:{model:'salary_bonus',fixedPerPeriod:0,links:[]}}:{})};
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 const period='2026-11-1',next='2026-11-2';
 const input={salary:0,vacation:0,official:0,debt:0,penalty:0,extra:0,sz:false,firstHalfBonus:null};
 const row={id:'operator',employeeId:'operator',login:'operator',name:'operator',department:'5',role:'operator',rate:5,volume:11300,commission:500,salary:0,input,result:500,payout:500};
 const member={id:'LV-1',externalId:'1',employeeId:'operator',login:'operator',department:'5',amount:11300};
 const receipt={slot:1,registry:'1',tracking:'100',paymentDate:'2026-11-09',collectedCents:1130000,amountCents:767670};
 const order={id:'LV-1',clientId:'c',manager:'operator',status:'redeemed',delivery:'cdek_pickup',items:[{name:'Product',quantity:2,price:5650}],cdekRemittances:[receipt,{...receipt,registry:'2'}],createdAt:'2026-10-25T12:00:00Z',version:1};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c','79990000001',JSON.stringify({id:'c',name:'Fixture',phone:'79990000001'}));
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(order.id,'c',JSON.stringify(order));
 const ledger={revision:'initial',initialPeriod:period,activePeriod:period,historyReconciled:true,periods:{[period]:{status:'frozen',orders:[member],rows:[row],signers:[{id:'head',name:'head',department:'5'}],signatures:{head:{by:'head',at:'2026-11-10T12:00:00Z'}}}}};
 db.prepare('INSERT INTO settings VALUES(?,?)').run('premium-ledger',JSON.stringify(ledger));
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'db.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready,logs);
 async function call(path,cookie,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers};}
 const cookies={};for(const id of ['admin','A_Emil','head','operator']){const r=await call('/api/auth/login',null,{login:id,password});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 const path='/api/partner-cash?period='+period;
 assert.equal((await call(path)).status,401);
 for(const id of ['head','operator'])assert.equal((await call(path,cookies[id])).status,403);
 const before=await call(path,cookies.admin);assert.equal(before.status,200);assert.equal(before.data.remaining,null);
 const form={revision:'',taxRate:7,communication:100,bank:50};
 assert.equal((await call(path,cookies.A_Emil,form)).status,403);
 assert.equal((await call(path,cookies.admin,{...form,taxRate:101})).status,400);
 const saved=await call(path,cookies.admin,form);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.receipts.length,1);assert.equal(saved.data.accountRemaining,563570);
 assert.equal((await call(path,cookies.admin,form)).status,409);
 assert.equal((await call(path,cookies.A_Emil)).data.editable,false);
 assert.equal((await call('/api/cash',cookies.A_Emil,{action:'create'})).status,403);
 assert(!(await call('/api/cash',cookies.admin)).data.recipients.some(e=>e.id==='A_Emil'));
 const paid=await call('/api/premium/lifecycle',cookies.admin,{period,revision:'initial',action:'pay'});assert.equal(paid.status,200,JSON.stringify(paid.data));
 const snapshot=JSON.parse(db.prepare('SELECT data FROM settings WHERE id=?').get('partner-cash-closed:'+period).data);assert.equal(snapshot.remaining,563570);
 assert.equal((await call(path,cookies.admin,{...form,revision:saved.data.settings.revision})).status,409);
 db.prepare("UPDATE orders SET data=json_set(data,'$.items[0].quantity',99)").run();
 assert.equal((await call(path,cookies.admin)).data.goods,60000,'Closed goods remain frozen');
 const future=await call('/api/partner-cash?period='+next,cookies.admin);assert.equal(future.status,200,JSON.stringify(future.data));assert.equal(future.data.opening,563570);assert.equal(future.data.settings.taxRate,7);
 const loss=await call('/api/partner-cash?period='+next,cookies.admin,{revision:'',taxRate:7,communication:10000,bank:0});assert.equal(loss.status,200);assert.equal(loss.data.accountRemaining,-436430);
 assert.equal(db.prepare("SELECT count(*) AS n FROM cash_operations WHERE sender='A_Emil' OR recipient='A_Emil'").get().n,0,'Preview does not post duplicate cash movements');
 console.log('Partner HTTP: access, validation, revision, duplicate receipt, frozen close, carry and negative balance passed');
}catch(e){console.error(logs);throw e;}finally{if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

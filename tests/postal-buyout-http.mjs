// Isolated application/API test: no real customer, payment or carrier access.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-post-buyout-')),db=new DatabaseSync(join(dir,'test.sqlite')),origin='https://crm.test',port='3117',base='http://127.0.0.1:'+port,password='synthetic-test-password';
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password),cookies={};
 for(const [id,role,department] of [['op','operator','1'],['foreign','operator','2'],['head','department_head','1'],['other-head','department_head','2'],['log','logistic',''],['second','chief_logistic','']]){
 const e={id,login:id,name:id,alias:'',role,department,salary:0,bonus:0,version:1};db.prepare('INSERT INTO employees VALUES(?,?,1)').run(id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 const now=new Date().toISOString(),client={id:'c',name:'Synthetic Client',phone:'+79990000001',owner:'op',source:'test',city:'Москва',address:'Москва, д1',baseType:'M',sheet:'К',createdAt:now,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:now};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c',client.phone,JSON.stringify(client));
 const initial={id:'post',clientId:'c',manager:'op',logistic:'log',status:'shipping',delivery:'russian_post',items:[{name:'Product',quantity:1,price:10000}],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now,shippedAt:now};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run('post','c',JSON.stringify(initial));
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_SPLIT_READS:'1',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,logs);
 async function call(actor,path,body,expected=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookies[actor]?{cookie:cookies[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return {data,headers:r.headers};}
 for(const actor of ['op','foreign','head','other-head','log','second']){const r=await call(actor,'/api/auth/login',{login:actor,password});cookies[actor]=r.headers.get('set-cookie').split(';')[0];}
 const order=()=>{const row=db.prepare("SELECT data,version FROM orders WHERE id='post'").get();return {...JSON.parse(row.data),version:row.version};};
 const act=(actor,action,extra={},expected=200)=>call(actor,'/api/crm',{action,id:'post',version:order().version,responseMode:'entity-patch',...extra},expected);
 const tasks=async actor=>(await call(actor,'/api/crm')).data.tasks.filter(t=>t.orderId==='post'&&t.id.includes('postal-buyout:'));
 await act('foreign','reportPostalBuyout',{},403);await act('other-head','reportPostalBuyout',{},403);await act('log','reportPostalBuyout',{},400);
 const first=await act('op','reportPostalBuyout');assert.ok(first.data.entityPatch);assert.equal(order().status,'shipping');assert.equal(order().postalBuyoutReport.status,'pending');
 await act('head','reportPostalBuyout',{},400);
 for(const actor of ['log','second'])assert.equal((await tasks(actor)).length,1);
 await act('op','keepPostalSent',{},400);
 const stale=order().version;await act('log','keepPostalSent');assert.equal(order().status,'shipping');assert.equal(order().postalBuyoutReport.status,'sent');for(const actor of ['log','second'])assert.equal((await tasks(actor)).length,0);
 await act('second','keepPostalSent',{version:stale},400);
 await act('head','reportPostalBuyout');await act('second','transition',{to:'redeemed'});assert.equal(order().status,'redeemed');assert.equal(order().postalBuyoutReport.status,'paid');assert.ok(order().redeemedAt);assert.equal(order().paymentReceivedAt,undefined);assert.equal((await tasks('log')).length,0);
 const cash=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cash_operations'").get();if(cash)assert.equal(db.prepare('SELECT count(*) AS n FROM cash_operations').get().n,0);
 const events=db.prepare("SELECT data FROM events WHERE order_id='post'").all().map(r=>JSON.parse(r.data));assert.ok(events.some(e=>e.text.includes('сообщил')));assert.ok(events.some(e=>e.text.includes('оставлен в отправленных')));
 console.log('Postal API: own/head/foreign roles, entity patches, shared bell tasks, keep sent, stale write, confirm paid without cash, audit passed');
}catch(error){console.error(logs);throw error;}finally{if(server&&server.exitCode===null){const exit=once(server,'exit');server.kill('SIGTERM');await exit;}db.close();rmSync(dir,{recursive:true,force:true});}

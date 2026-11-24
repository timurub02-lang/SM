import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'sk-pending-')),file=join(dir,'test.sqlite'),db=new DatabaseSync(file);
const base='http://127.0.0.1:3397',origin='https://crm.test';let server,logs='';
async function request(path,cookie,body){return fetch(base+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});}
try{
 db.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword('synthetic-pending-only');
 for(const [id,role] of [['admin','admin'],['op','operator'],['other','operator'],['head','department_head'],['E-74ee9a8f-99d','department_head']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,skLogin:id,role,department:id==='other'?'2':'1',version:1}));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{PATH:process.env.PATH,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:'3397'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<150;i++){try{if((await request('/login')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const cookies={};for(const id of ['admin','op','other','head','E-74ee9a8f-99d']){const r=await request('/api/auth/login',null,{login:id,password:'synthetic-pending-only'});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 assert.equal((await request('/api/sk-orders')).status,401);
 assert.equal((await request('/api/sk-orders',cookies.head)).status,200);
 assert.equal((await request('/api/sk-orders',cookies.op)).status,200);
 for(const [id,userName,state] of [['1','op','pending'],['2','other','pending'],['3','op','imported'],['4','op','rejected'],['5','op','duplicate']])db.prepare('INSERT INTO sk_order_transfers(id,data,state,reason,created_at) VALUES(?,?,?,?,?)').run(id,JSON.stringify({callId:id,projectId:null,email:'private@example.invalid',userName,userNameUnique:true,name:'Имя '+id,phone:'+79990000001'}),state,'Секретная причина','2026-11-17T09:00:00Z');
 const artemRows=await (await request('/api/sk-orders',cookies['E-74ee9a8f-99d'])).json();
 assert.deepEqual(artemRows.rows.map(r=>r.id).sort(),['1','2']);
 assert.ok(artemRows.rows.every(r=>r.canDecide&&r.phone==='+79990000001'&&r.reasons.includes('Создан не из Проекта')));
 const r=await request('/api/sk-orders',cookies.op),data=await r.json();assert.equal(r.status,200);
 assert.deepEqual(data.rows.map(r=>r.id),['1']);assert.equal(data.rows[0].canDecide,false);
 assert.ok(!JSON.stringify(data).includes('Секретная причина'));assert.ok(!JSON.stringify(data).includes('79990000001'));assert.ok(!('clientId' in data.rows[0]));
 const headData=await (await request('/api/sk-orders',cookies.head)).json();assert.deepEqual(headData.rows,data.rows);
 for(const action of ['approve','reject'])assert.equal((await request('/api/sk-orders',cookies.head,{id:'1',action})).status,403);
 assert.equal((await request('/api/sk-orders?actorId=other',cookies.op)).status,403);
 assert.equal((await request('/api/sk-orders',cookies.op,{id:'1',action:'approve'})).status,403);
 assert.equal((await request('/api/sk-orders',cookies.op,{id:'1',action:'reject'})).status,403);
 assert.equal((await request('/api/sk-orders',cookies['E-74ee9a8f-99d'],{id:'1',action:'reject'})).status,200);
 assert.deepEqual((await (await request('/api/sk-orders',cookies.op)).json()).rows,[]);
 assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);
 // End-to-end: an RK handoff of a free client follows the new owner when SK import succeeds.
 assert.equal((await request('/api/crm',cookies.admin)).status,200);
 const free={id:'owner-sync-client',name:'Synthetic free client',phone:'+79990000777',owner:'',source:'Test',baseType:'M',sheet:'П',createdAt:new Date().toISOString(),version:1};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(free.id,free.phone,JSON.stringify(free));
 db.prepare('INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,shared_queue,at,phone,called_number) VALUES(?,?,NULL,?,1,?,?,?)').run('owner-sync-incoming',free.id,'',free.createdAt,free.phone,'');
 let sync=await request('/api/crm',cookies.head,{action:'transferIncoming',incomingId:'owner-sync-incoming',operatorId:'op',comment:'Client waiting for a callback'});assert.equal(sync.status,200,await sync.text());
 let handoff=JSON.parse(db.prepare("SELECT handoff FROM incoming_calls WHERE id='owner-sync-incoming'").get().handoff);assert.equal(handoff.freeClient,true);
 assert.equal((await request('/api/crm',cookies.op,{action:'missIncoming',incomingId:'owner-sync-incoming'})).status,200);
 const importedAt=new Date(Date.now()+100).toISOString();
 db.prepare('INSERT INTO sk_order_transfers(id,data,state,reason,created_at) VALUES(?,?,?,?,?)').run('991',JSON.stringify({callId:'991',leadId:'992',projectId:null,dispatchVerified:true,email:'other@test.invalid',userName:'other',userNameUnique:true,name:free.name,phone:free.phone,city:'',address:'',comment:''}),'pending','',importedAt);
 sync=await request('/api/sk-orders',cookies['E-74ee9a8f-99d'],{action:'approve',id:'991'});const imported=await sync.json();assert.equal(sync.status,200,JSON.stringify(imported));assert.equal(imported.state,'imported');assert.equal(db.prepare("SELECT decided_by FROM sk_order_transfers WHERE id='991'").get().decided_by,'E-74ee9a8f-99d');
 const synced=db.prepare("SELECT * FROM incoming_calls WHERE id='owner-sync-incoming'").get();assert.equal(synced.assignee_id,'other');assert.equal(synced.missed_until,'');assert.equal(synced.closed_at,null);
 handoff=JSON.parse(synced.handoff);assert.equal(handoff.comment,'Client waiting for a callback');assert.equal(handoff.ownerSync.from,'op');assert.equal(handoff.ownerSync.to,'other');
 const oldState=await (await request('/api/crm',cookies.op)).json(),newState=await (await request('/api/crm',cookies.other)).json();
 assert.ok(!oldState.incoming.some(i=>i.id===synced.id));assert.ok(newState.incoming.some(i=>i.id===synced.id&&!i.missedUntil&&i.orderIds.includes(imported.orderId)));
 assert.ok(oldState.reminders.some(r=>r.kind==='incoming-owner'),'Former handler receives the notification after losing client access');
 const noticeCount=db.prepare("SELECT count(*) n FROM reminders WHERE json_extract(data,'$.kind')='incoming-owner'").get().n;
 assert.equal((await request('/api/crm',cookies.other)).status,200);assert.equal(db.prepare("SELECT count(*) n FROM reminders WHERE json_extract(data,'$.kind')='incoming-owner'").get().n,noticeCount);
 console.log('PASS: free-client handoff → ND → new SK owner → immediate incoming reassignment, cleared ND, preserved comments, former-handler notice and idempotent reconciliation');
 console.log('PASS: pending transfers are sender-only, read-only, contain no review details and disappear after admin decision');
}catch(e){console.error(logs);throw e;}finally{if(server&&server.exitCode===null){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

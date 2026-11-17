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
 for(const [id,role] of [['admin','admin'],['op','operator'],['other','operator'],['head','department_head']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,skLogin:id,role,department:'1',version:1}));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{PATH:process.env.PATH,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:'3397'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<150;i++){try{if((await request('/login')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const cookies={};for(const id of ['admin','op','other','head']){const r=await request('/api/auth/login',null,{login:id,password:'synthetic-pending-only'});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 assert.equal((await request('/api/sk-orders')).status,401);
 assert.equal((await request('/api/sk-orders',cookies.head)).status,403);
 assert.equal((await request('/api/sk-orders',cookies.op)).status,200);
 for(const [id,userName,state] of [['1','op','pending'],['2','other','pending'],['3','op','imported'],['4','op','rejected'],['5','op','duplicate']])db.prepare('INSERT INTO sk_order_transfers(id,data,state,reason,created_at) VALUES(?,?,?,?,?)').run(id,JSON.stringify({callId:id,email:'private@example.invalid',userName,userNameUnique:true,name:'Имя '+id,phone:'+79990000001'}),state,'Секретная причина','2026-11-17T09:00:00Z');
 const r=await request('/api/sk-orders',cookies.op),data=await r.json();assert.equal(r.status,200);
 assert.deepEqual(data.rows.map(r=>r.id),['1']);assert.equal(data.rows[0].canDecide,false);
 assert.ok(!JSON.stringify(data).includes('Секретная причина'));assert.ok(!JSON.stringify(data).includes('79990000001'));assert.ok(!('clientId' in data.rows[0]));
 assert.equal((await request('/api/sk-orders?actorId=other',cookies.op)).status,403);
 assert.equal((await request('/api/sk-orders',cookies.op,{id:'1',action:'approve'})).status,403);
 assert.equal((await request('/api/sk-orders',cookies.op,{id:'1',action:'reject'})).status,403);
 assert.equal((await request('/api/sk-orders',cookies.admin,{id:'1',action:'reject'})).status,200);
 assert.deepEqual((await (await request('/api/sk-orders',cookies.op)).json()).rows,[]);
 assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);
 console.log('PASS: pending transfers are sender-only, read-only, contain no review details and disappear after admin decision');
}catch(e){console.error(logs);throw e;}finally{if(server&&server.exitCode===null){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

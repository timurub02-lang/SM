// Real HTTP streams against a temporary synthetic SQLite database; no external integrations.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-events-')),file=join(dir,'test.sqlite'),database=new DatabaseSync(file);
const origin='https://crm.test',port=process.env.EVENTS_TEST_PORT||'3108',base=`http://127.0.0.1:${port}`,password='synthetic-events-only-123';
let server,logs='';const streams=[];
try{
 database.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)database.exec(sql);
 const hash=await hashPassword(password);
 for(const id of ['one','two']){
  database.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role:'operator',department:'1',salary:0,bonus:0,version:1}));
  database.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 database.prepare('INSERT INTO settings VALUES(?,?)').run('main','{"retentionDays":30}');
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.equal((await fetch(base+'/api/crm/changes')).status,401);
 const cookies=[];
 for(const login of ['one','two']){
  const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login,password})});
  assert.equal(r.status,200);cookies.push(r.headers.get('set-cookie').split(';')[0]);
 }
 async function connect(cookie,cursor=''){
  const controller=new AbortController();streams.push(controller);
  const r=await fetch(base+'/api/crm/changes',{headers:{cookie,...(cursor?{'Last-Event-ID':cursor}:{})},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
  assert.equal(r.status,200);assert.equal(r.headers.get('x-accel-buffering'),'no');
  const reader=r.body.getReader();let buffer='';
  return {controller,async next(){for(;;){const packet=await reader.read();if(packet.done)return null;buffer+=new TextDecoder().decode(packet.value);const cut=buffer.indexOf('\n\n');if(cut<0)continue;const frame=buffer.slice(0,cut);buffer=buffer.slice(cut+2);if(frame.includes('event: change'))return frame;}}};
 }
 const one=await connect(cookies[0]),two=await connect(cookies[1]);
 const first=await one.next();assert.equal(await two.next(),first);
 assert.match(first,/data: \{\}/);assert.ok(!first.includes('order')&&!first.includes('client'));
 const cursor=/id: (.+)/.exec(first)[1];one.controller.abort();
 // Simulates an external importer using another SQLite connection, during disconnection.
 database.prepare("UPDATE settings SET data=? WHERE id='main'").run('{"retentionDays":31}');
 const recovered=await connect(cookies[0],cursor);
 const event=await recovered.next();assert.notEqual(event,first);assert.equal(await two.next(),event);
 database.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='two'").run();
 database.prepare("UPDATE settings SET data=? WHERE id='main'").run('{"retentionDays":32}');
 assert.equal(await two.next(),null,'revoked sessions receive no further events');
 assert.equal((await fetch(base+'/api/crm/changes',{headers:{cookie:cookies[1]}})).status,401);
 console.log('HTTP events: two sessions, importer writes, reconnect recovery, no record data, revocation and anonymous rejection passed');
}catch(error){console.error(logs);throw error;}finally{
 streams.forEach(s=>s.abort());if(server){server.kill();await once(server,'exit');}database.close();rmSync(dir,{recursive:true,force:true});
}

// Run after the Miran standalone build. Uses only a temporary, synthetic database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-auth-')), db=new DatabaseSync(join(dir,'test.sqlite'));
const password='test-password-only-123',pbxKey='fixture-pbx-result-key-not-a-real-secret';
const origin='https://crm.test',port=process.env.AUTH_TEST_PORT||'3098',base=`http://127.0.0.1:${port}`;
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password);
 const staff=[['admin','admin','1'],['one','operator','1'],['two','operator','2'],['head','department_head','1']].map(([id,role,department])=>({id,login:id,name:'Test '+id,alias:'',skLogin:'',role,department,salary:100,bonus:1,version:1}));
 for(const e of staff){db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(e.id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(e.id,hash);}
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 for(const id of ['one','two']){
  const c={id:'c-'+id,name:'Client '+id,phone:id==='one'?'+79990000001':'+79990000002',city:'',address:'',source:'Test',owner:id,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:new Date().toISOString(),createdAt:new Date().toISOString(),version:1};
  db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
  const o={id:'o-'+id,clientId:c.id,manager:id,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:c.createdAt,updatedAt:c.createdAt,version:1};
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_PHONE_RESULT_KEY:pbxKey,CRM_PHONE_RECORDINGS_DIR:join(dir,'recordings'),CRM_PHONE_USER:'pilot-test',CRM_PHONE_PASSWORD:'fixture-secret',CRM_PHONE_TEST_NUMBER:'79990000001',CRM_PHONE_CALLER_ID:'79000000000',CRM_PHONE_EMPLOYEE:'admin',CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,'Server failed to start');
 async function call(path,{cookie,body,headers={},method}={}){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,headers:r.headers,text};}
 async function login(name,pw=password){return call('/api/auth/login',{body:{login:name,password:pw}});}
 const cookies={};for(const id of ['admin','one','two','head']){const r=await login(id);assert.equal(r.status,200,r.text);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 assert.equal((await call('/api/telephony')).status,401);
 for(const id of ['one','head'])for(const body of [undefined,{mode:'test'}])assert.equal((await call('/api/telephony',{cookie:cookies[id],body})).status,403);
 const status=await call('/api/telephony',{cookie:cookies.admin});assert.equal(status.data.configured,true);assert.ok(!status.text.includes('fixture-secret'));assert.ok(!status.text.includes('pilot-test'));assert.equal(status.headers.get('cache-control'),'no-store');
 const dial=body=>call('/api/telephony',{cookie:cookies.admin,body});
 for(const body of [{mode:'test'},{mode:'echo'},{mode:'client',clientId:'c-one'},{mode:'order',orderId:'o-one'}]){
  const r=await dial(body);assert.equal(r.status,200,r.text);assert.equal(r.data.destination,body.mode==='echo'?'echo':'test');assert.equal(r.headers.get('cache-control'),'no-store');
 }
 for(const body of [{mode:'client',clientId:'c-two'},{mode:'order',orderId:'o-two'},{mode:'client',clientId:'missing'},{mode:'number',phone:'79990000001'}])assert.equal((await dial(body)).status,400);
 assert.equal((await dial({mode:'order',orderId:'missing'})).status,403);
 assert.equal((await dial({mode:'test',phone:'79999999999',destination:'arbitrary'})).data.destination,'test');
 assert.equal((await dial({mode:'test',actorId:'one'})).status,403);
 assert.equal((await call('/api/telephony',{cookie:cookies.admin,body:{mode:'test'},headers:{Origin:'https://evil.test'}})).status,403);
 db.prepare('UPDATE clients SET phone=? WHERE id=?').run('8 (999) 000-00-01','c-one');
 assert.equal((await dial({mode:'client',clientId:'c-one'})).status,200);

 const api=(path,body,cookie=cookies.admin,method)=>call(path,{cookie,body,method});
 const pbx=(method,id,body,key=pbxKey)=>call('/api/telephony/pbx'+(id?'?callId='+id:''),{method,body,headers:{'X-CRM-PBX-Key':key}});
 const attempt=await dial({mode:'order',orderId:'o-one'}),callId=attempt.data.callId;assert.match(callId,/^[a-f0-9]{32}$/);
 assert.equal((await api('/api/call-history?orderId=o-one')).data.calls[0].id,callId);
 assert.equal((await call('/api/call-history?orderId=o-one')).status,401);
 assert.equal((await api('/api/call-history?orderId=o-one',undefined,cookies.two)).status,403);
 assert.equal((await api('/api/call-history?clientId=c-one',undefined,cookies.two)).status,403);
 for(const id of ['admin','one','head'])assert.equal((await api('/api/call-history?clientId=c-one',undefined,cookies[id])).status,200);
 assert.equal((await pbx('GET',callId,undefined,'wrong-key')).status,403);
 assert.equal((await pbx('GET',callId)).status,200);
 assert.equal((await pbx('GET',callId)).status,409,'Same call ID cannot dial twice');
 const epoch=Math.floor(Date.now()/1000),audio=Buffer.alloc(16044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
 const payload={id:callId,started:epoch,answered:epoch+1,ended:epoch+3,status:'ANSWERED',cause:'16',audio:audio.toString('base64')};
 assert.equal((await pbx('POST','',payload,'wrong-key')).status,403);
 assert.equal((await pbx('POST','',payload)).status,200);
 assert.equal((await pbx('POST','',{...payload,audio:'wrong'})).status,200,'Finalized replay cannot overwrite audio');
 assert.deepEqual(readFileSync(join(dir,'recordings',callId+'.wav')),audio);
 let history=(await api('/api/call-history?orderId=o-one')).data.calls;assert.equal(history[0].status,'completed');assert.equal(history[0].bill_seconds,2);assert.equal(history[0].recording,true);
 assert.equal((await api('/api/telephony',{id:callId,status:'failed',detail:'late browser failure'},cookies.admin,'PATCH')).status,200);
 assert.equal((await api('/api/call-history?orderId=o-one')).data.calls[0].status,'completed','PBX result is authoritative');
 const recording='/api/call-history/recording?id='+callId;
 assert.equal((await call(recording)).status,401);assert.equal((await api(recording,undefined,cookies.two)).status,403);assert.equal((await api(recording,undefined,cookies.one)).status,200);
 const range=await call(recording,{cookie:cookies.admin,headers:{Range:'bytes=0-43'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-length'),'44');
 assert.equal((await call(recording,{cookie:cookies.admin,headers:{Range:'bytes=999999-'}})).status,416);
 const failedId=(await dial({mode:'client',clientId:'c-one'})).data.callId;
 await api('/api/telephony',{id:failedId,status:'failed',detail:'Микрофон недоступен'},cookies.admin,'PATCH');
 assert.equal((await api('/api/call-history?clientId=c-one')).data.calls[0].status,'failed');
 assert.ok(!(await api('/api/call-history?orderId=o-one')).data.calls.some(c=>c.id===failedId),'Direct client call has no fabricated order link');
 const blocked=(await dial({mode:'order',orderId:'o-one'})).data.callId;
 const nums='/api/telephony/numbers';assert.equal((await api(nums,undefined,cookies.one)).status,403);
 const imported=await api(nums,{action:'import',numbers:['8 (999) 111-22-33','79991112233','79992223344','bad','']});assert.equal(imported.data.report.added,2);assert.equal(imported.data.report.duplicates,1);assert.equal(imported.data.report.invalid.length,2);
 assert.equal((await api(nums,{action:'replace',count:3,version:0})).status,400);
 assert.equal((await api(nums,{action:'replace',count:2,version:0})).status,200);
 assert.equal((await pbx('GET',blocked)).status,409,'Replaced number cannot start a later call');
 assert.equal((await api(nums,{action:'replace',count:1,version:0})).status,400);
 const pool=(await api(nums)).data;assert.equal(pool.numbers.filter(n=>n.state==='completed').length,1);
 await api(nums,{action:'markExported',numbers:['79000000000','79991112233']});
 const exported=(await api(nums)).data;assert.equal(exported.numbers.filter(n=>n.exported_at).length,1,'Cannot export active numbers as completed');
 const direct=(await dial({mode:'client',clientId:'c-one'})).data.callId;
 const rotated=db.prepare('SELECT caller_number FROM phone_calls WHERE id=?').get(direct);assert.equal(rotated.caller_number,'79991112233');
 const detached=JSON.parse(db.prepare('SELECT data FROM clients WHERE id=?').get('c-one').data);detached.owner='two';db.prepare('UPDATE clients SET data=? WHERE id=?').run(JSON.stringify(detached),'c-one');
 assert.equal((await api('/api/call-history?clientId=c-one',undefined,cookies.one)).status,403);assert.equal((await api('/api/call-history?clientId=c-one',undefined,cookies.head)).status,403);
 assert.equal((await api('/api/call-history?orderId=o-one',undefined,cookies.one)).status,200);
 assert.equal((await api(recording,undefined,cookies.two)).status,200,'New client owner can hear client history');
 db.prepare('UPDATE employees SET data=? WHERE id=?').run(JSON.stringify({...staff[1],role:'admin'}),'one');
 assert.equal((await call('/api/telephony',{cookie:cookies.one,body:{mode:'test'}})).status,403);
 console.log('Call history, private recordings, byte ranges, PBX replay protection, detached clients, number pool import/replace/export and telephony pilot: authentication, dedicated admin, CSRF, fixed destinations, card phone normalization, private config and no-store passed. No calls placed.');
}catch(error){console.error(logs);throw error;}
finally{if(server){server.kill('SIGTERM');await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

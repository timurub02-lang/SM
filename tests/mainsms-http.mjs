// Uses a synthetic database and a mocked MainSMS transport. Never sends real SMS.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-sms-')),database=join(dir,'test.sqlite'),db=new DatabaseSync(database);
const origin='https://crm.test',port=process.env.SMS_TEST_PORT||'3119',base=`http://127.0.0.1:${port}`;
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const password='synthetic-password-123',hash=await hashPassword(password);
 for(const [id,role,department] of [['admin','admin',''],['one','operator','1'],['two','operator','2'],['head','department_head','1']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,role,department,login:id,name:'Test '+id,alias:'',skLogin:'',salary:0,bonus:1,version:1}));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 for(const id of ['one','two']){
  db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c-'+id,'+7999000000'+(id==='one'?1:2),JSON.stringify({id:'c-'+id,name:'Test client',phone:'+7999000000'+(id==='one'?1:2),owner:id,city:'Москва',address:'Москва',source:'Test',sheet:'К',baseType:'M',createdAt:new Date().toISOString(),assignmentStartedAt:new Date().toISOString(),assignedUntil:'',version:1}));
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run('o-'+id,'c-'+id,JSON.stringify({id:'o-'+id,clientId:'c-'+id,manager:id,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1}));
 }
 const config={project:'synthetic',apiKey:'secret-never-exposed',sender:'TEST',templates:[],revision:'rev-1'};
 db.prepare('INSERT INTO settings VALUES(?,?)').run('mainsms',JSON.stringify(config));
 for(const state of ['preview','accepted','unknown','sending']){
  db.prepare('INSERT INTO settings VALUES(?,?)').run('sms-old-'+state,JSON.stringify({orderId:'o-one',actorId:'one',phone:'+79990000001',text:'old '+state,state,at:1,sender:'OLD'}));
 }
 const mock=join(dir,'mock.mjs'),calls=join(dir,'calls.txt');
 writeFileSync(mock,`import {appendFileSync} from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://mainsms.ru/')){
  const values=new URLSearchParams(options.body);appendFileSync(${JSON.stringify(calls)},values.get('message')+'\\n');
  await new Promise(r=>setTimeout(r,100));
  if(values.get('message')==='ambiguous')throw Error('Synthetic transport timeout');
  return Response.json({status:'success',messages_id:[123]});
 }
 return original(url,options);
};`);
 server=spawn(process.execPath,['--import',pathToFileURL(mock).href,resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:database,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,'Server failed to start');
 async function call(path,cookie,body){
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{Origin:origin,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json()};
 }
 const cookies={};
 for(const id of ['admin','one','two','head']){
  const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:id,password})});
  assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];
 }
 const endpoint='/api/mainsms',history=endpoint+'?orderId=o-one';
 assert.equal((await call(history)).status,401);
 assert.equal((await call(history,cookies.two)).status,403);
 assert.equal((await call(history+'&actorId=admin',cookies.one)).status,403);
 for(const id of ['one','head','admin']){
  const r=await call(history,cookies[id]);assert.equal(r.status,200);
  assert.equal(r.data.history.length,3);assert.ok(r.data.history.every(x=>x.state!=='preview'));
  assert.ok(!JSON.stringify(r.data).includes('+79990000001'));assert.ok(!JSON.stringify(r.data).includes(config.apiKey));
 }
 async function preview(text,extra={}){return call(endpoint,cookies.one,{action:'preview',orderId:'o-one',text,...extra});}
 for(const text of ['', '   ', 'a'.repeat(1001)])assert.equal((await preview(text)).status,400);
 const draft=await preview('  Hello {literal}  ');assert.equal(draft.status,200);assert.equal(draft.data.text,'Hello {literal}');
 assert.equal((await call(history,cookies.one)).data.history.length,3,'Previews are not history');
 const body={action:'send',orderId:'o-one',token:draft.data.token};
 const results=await Promise.all([call(endpoint,cookies.one,body),call(endpoint,cookies.one,body)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 assert.equal(readFileSync(calls,'utf8').trim(),'Hello {literal}');
 let entries=(await call(history,cookies.one)).data.history;
 assert.equal(entries[0].state,'accepted');assert.equal(entries[0].actor,'Test one');assert.equal(entries[0].text,'Hello {literal}');assert.ok(entries[0].at>1);
 const unknown=await preview('ambiguous');assert.equal(unknown.status,200);
 const sendUnknown={action:'send',orderId:'o-one',token:unknown.data.token};
 assert.equal((await call(endpoint,cookies.one,sendUnknown)).status,409);
 assert.equal((await call(endpoint,cookies.one,sendUnknown)).status,400);
 entries=(await call(history,cookies.one)).data.history;
 assert.equal(entries[0].state,'unknown');assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,2);
 config.templates=[{id:'t',name:'Template',text:'Hi {client}, {order}'}];
 db.prepare("UPDATE settings SET data=? WHERE id='mainsms'").run(JSON.stringify(config));
 const template=await preview(undefined,{templateId:'t'});assert.equal(template.status,200);assert.equal(template.data.text,'Hi Test client, o-one');
 const order=JSON.parse(db.prepare("SELECT data FROM orders WHERE id='o-one'").get().data);
 db.prepare("UPDATE orders SET data=? WHERE id='o-one'").run(JSON.stringify({...order,testOnly:true}));
 assert.equal((await preview('Test blocked')).status,400);
 console.log('SMS free text, template compatibility, history, permissions and duplicate/uncertain sends passed with mocked transport.');
} catch(error){console.error(logs);throw error;}
finally{if(server&&server.exitCode===null){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

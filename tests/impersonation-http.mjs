// Real HTTP/auth boundary against a synthetic database and a fake local phone bridge. No calls.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';
import {authSchema} from '../lib/auth-schema.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-impersonation-')),file=join(dir,'test.sqlite'),socket=join(dir,'bridge.sock');
const d=new DatabaseSync(file),port='3117',base='http://127.0.0.1:'+port,origin='https://crm.test';
let server,bridge,logs='';const calls=[],sessions={};
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
async function call(id,path,body,options={}){
 const r=await fetch(base+path,{method:body?'POST':'GET',...options,headers:{cookie:sessions[id]||'',...(body?{Origin:origin,'Content-Type':'application/json'}:{}),...options.headers},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual'});
 return {status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.text()};
}
try{
 d.exec('PRAGMA journal_mode=WAL');d.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)d.exec(sql);
 const expires=Date.now()+3600000;
 for(const [id,role] of [['admin','admin'],['admin2','admin'],['one','operator'],['two','operator'],['head','department_head'],['foreign-head','department_head'],['empty-head','department_head'],['logistic','logistic']]){
  const e={id,name:id,login:id,role,department:id==='two'||id==='foreign-head'?'2':id==='empty-head'?'':'1',alias:'',salary:0,bonus:0,version:1,oktell:{requested:true,status:'linked',userId:'native-'+id,login:'native-'+id}};
  d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify(e));d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,'synthetic-only');
  const token=randomBytes(32).toString('hex');sessions[id]='__Host-sm-session='+token;d.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(tokenHash(token),id,expires);
 }
 sessions.adminOther='__Host-sm-session='+randomBytes(32).toString('hex');d.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(tokenHash(sessions.adminOther.split('=')[1]),'admin',expires);
 d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 const now=new Date().toISOString();
 for(const owner of ['one','two']){
  const c={id:'c-'+owner,name:'Synthetic '+owner,phone:owner==='one'?'+79990000001':'+79990000002',owner,createdAt:now,assignmentStartedAt:now,assignedUntil:new Date(Date.now()+86400000).toISOString(),city:'',address:'',source:'Synthetic',baseType:'M',sheet:'К'};
  const o={id:'o-'+owner,clientId:c.id,manager:owner,logistic:'',status:'draft',draftHours:null,items:[{name:'Synthetic item',quantity:1,price:100}],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now};
  d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 bridge=createServer((req,res)=>{calls.push({path:req.url,method:req.method});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,registered:true,token:'synthetic',actor:new URL(req.url,'http://local').searchParams.get('actor')}));});bridge.listen(socket);await once(bridge,'listening');
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,CRM_SPLIT_READS:'0',CRM_PREPARED_MODELS:'0',CRM_LEGACY_SNAPSHOT_ORIGIN:'',CRM_LEGACY_SNAPSHOT_WORKER:'0',CRM_PHONE_STAFF_ENABLED:'1',CRM_PHONE_RESULT_KEY:'synthetic-only-key-for-no-real-calls-123',OKTELL_CONTROL_SOCKET:socket,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const switchPath='/api/auth/impersonation',start={action:'start',employeeId:'one'};
 assert.equal((await call('',switchPath,start)).status,401);assert.equal((await call('one',switchPath,start)).status,403);
 assert.equal((await call('admin',switchPath,start,{headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await call('admin',switchPath,{...start,employeeId:'admin'})).status,400);
 assert.equal((await call('admin',switchPath,{...start,employeeId:'missing'})).status,409);
 d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='two'").run();assert.equal((await call('admin',switchPath,{...start,employeeId:'two'})).status,409);d.prepare("UPDATE auth_accounts SET enabled=1 WHERE employee_id='two'").run();
 d.prepare("INSERT INTO auth_test_accounts VALUES('two')").run();assert.equal((await call('admin',switchPath,{...start,employeeId:'two'})).status,409);d.prepare("DELETE FROM auth_test_accounts WHERE employee_id='two'").run();
 const sessionsBefore=d.prepare('SELECT * FROM auth_sessions ORDER BY token_hash').all();
 const employeeBefore=(await call('one','/api/auth/me')).data;assert.equal((await call('one','/api/oktell-phone')).status,200);
 for(const employeeId of ['two','admin','admin2','foreign-head','logistic','missing'])assert.equal((await call('head',switchPath,{action:'start',employeeId})).status,403,'Head cannot enter '+employeeId);
 assert.equal((await call('empty-head',switchPath,start)).status,403,'A head without a department cannot enter operators');
 assert.equal((await call('head',switchPath,start)).status,200);
 assert.equal((await call('head','/api/auth/me')).data.employee.id,'one');
 assert.equal((await call('head','/api/telephony',{mode:'echo'})).status,403);
 assert.equal((await call('one','/api/oktell-phone')).status,200,'Real operator phone remains available during head entry');
 const headPage=await call('head','/api/crm?list=orders&view=orders&filter=all');assert.deepEqual(headPage.data.rows.map(o=>o.id),['o-one']);
 assert.equal((await call('head','/api/crm',{action:'comment',id:'o-one',version:headPage.data.rows[0].version,text:'Synthetic delegated head edit'})).status,200);
 assert.ok(d.prepare("SELECT id FROM auth_impersonation_audit WHERE admin_id='head' AND target_id='one' AND kind='request' AND status=200").get());
 d.prepare("UPDATE employees SET data=json_set(data,'$.department','2') WHERE id='one'").run();
 assert.equal((await call('head','/api/auth/me')).status,401,'A transferred operator is immediately inaccessible');
 assert.ok((await call('head','/login')).data.includes('Вернуться в кабинет руководителя'));
 assert.equal((await call('head',switchPath,{action:'stop'})).status,200);assert.equal((await call('head','/api/auth/me')).data.employee.id,'head');
 d.prepare("UPDATE employees SET data=json_set(data,'$.department','1') WHERE id='one'").run();
 for(const [who,field,value] of [['head','department','2'],['one','role','department_head'],['head','role','operator']]){
  assert.equal((await call('head',switchPath,start)).status,200);
  d.prepare('UPDATE employees SET data=json_set(data,?,?) WHERE id=?').run('$.'+field,value,who);
  assert.equal((await call('head','/api/auth/me')).status,401,'Current head/target scope must be rechecked');
  assert.equal((await call('head',switchPath,{action:'stop'})).status,200);
  d.prepare('UPDATE employees SET data=json_set(data,?,?) WHERE id=?').run('$.'+field,field==='department'?'1':who==='head'?'department_head':'operator',who);
 }
 const ownCall=await call('admin','/api/telephony',{mode:'echo'});assert.equal(ownCall.status,200,JSON.stringify(ownCall));
 assert.equal((await call('admin',switchPath,start)).status,409,'An administrator cannot switch during their own call');
 const originalCall=d.prepare('SELECT * FROM phone_calls WHERE id=?').get(ownCall.data.callId);
 for(const [status,minutes,expected] of [['preparing',1,409],['preparing',3,200],['dialing',10,409],['connected',31,409],['connected',33,200],['preparing',5*24*60,200]]){
  const started=new Date(Date.now()-minutes*60000).toISOString();
  d.prepare('UPDATE phone_calls SET status=?,started_at=? WHERE id=?').run(status,started,ownCall.data.callId);
  assert.equal((await call('admin',switchPath,start)).status,expected,'Call guard: '+status+' '+minutes+' minutes');
  if(expected===200)assert.equal((await call('admin',switchPath,{action:'stop'})).status,200);
  const unchanged=d.prepare('SELECT status,started_at,ended_at FROM phone_calls WHERE id=?').get(ownCall.data.callId);
  assert.deepEqual({...unchanged},{status,started_at:started,ended_at:null},'Switching must not edit call history');
 }
 d.prepare('UPDATE phone_calls SET started_at=? WHERE id=?').run(originalCall.started_at,ownCall.data.callId);
 d.prepare("UPDATE phone_calls SET actor_id='one',status='connected' WHERE id=?").run(ownCall.data.callId);
 assert.equal((await call('admin',switchPath,start)).status,200);
 assert.equal((await call('admin','/api/auth/me')).data.employee.id,'one');assert.equal((await call('admin','/api/auth/me')).data.impersonation.adminId,'admin');
 assert.equal((await call('adminOther','/api/auth/me')).data.employee.id,'admin','Other administrator sessions are unchanged');
 assert.deepEqual((await call('one','/api/auth/me')).data,employeeBefore,'The real employee session is unchanged');
 assert.equal((await call('admin',switchPath,{...start,employeeId:'two'})).status,403,'No nested switches');
 const phoneBefore=calls.length;
 for(const path of ['/api/telephony','/api/operator-state','/api/oktell-phone','/api/oktell-delivery'])assert.equal((await call('admin',path)).status,403,path);
 for(const [path,body] of [['/api/telephony',{mode:'echo'}],['/api/oktell-phone',{action:'connect',tab:crypto.randomUUID()}],['/api/oktell-pilot',{action:'sync'}],['/api/operator-state',{action:'ready'}]])assert.equal((await call('admin',path,body)).status,403,path);
 assert.equal(calls.length,phoneBefore,'Impersonation must never contact the phone bridge');
 assert.equal(d.prepare('SELECT status FROM phone_calls WHERE id=?').get(ownCall.data.callId).status,'connected','The employee call remains untouched');
 assert.equal((await call('one','/api/oktell-phone')).status,200);assert.equal((await call('one','/api/oktell-phone',{action:'connect',tab:crypto.randomUUID()})).status,200,'Real employee can still connect their own phone');
 assert.equal(calls.length,phoneBefore+2);
 assert.equal((await call('admin','/api/crm?actorId=two')).status,403,'No actor spoofing');
 const listPath='/api/crm?list=orders&view=orders&filter=all';
 const ownPage=await call('admin',listPath);assert.equal(ownPage.status,200);assert.deepEqual(ownPage.data.rows.map(o=>o.id),['o-one'],'Only target employee orders are visible');
 assert.equal((await call('admin','/api/crm',{action:'comment',id:'o-two',version:1,text:'Forbidden synthetic edit'})).status,403);
 const edit=await call('admin','/api/crm',{action:'comment',id:'o-one',version:ownPage.data.rows[0].version,text:'Synthetic administrator edit'});assert.equal(edit.status,200,JSON.stringify(edit));
 const employeePage=await call('one',listPath);assert.equal(employeePage.status,200);assert.deepEqual(employeePage.data.rows.map(o=>o.id),['o-one']);
 assert.equal((await call('one','/api/crm',{action:'comment',id:'o-one',version:employeePage.data.rows[0].version,text:'Synthetic employee edit'})).status,200,'The real employee can still edit their order after the administrator');
 const journal=(await call('one','/api/crm/history?clientId=c-one')).data;
 for(const [text,actor,delegatedById] of [
  ['Synthetic delegated head edit','РК head от имени оператора one','head'],
  ['Synthetic administrator edit','Администратор admin от имени оператора one','admin'],
 ]){
  const event=journal.rows.find(e=>e.text.includes(text));assert.ok(event,JSON.stringify(journal));
  assert.equal(event.actor,actor);assert.equal(event.actorId,'one');assert.equal(event.delegatedById,delegatedById);
 }
 const ownEvent=journal.rows.find(e=>e.text.includes('Synthetic employee edit'));
 assert.ok(ownEvent);assert.equal(ownEvent.delegatedById,undefined);assert.ok(!ownEvent.actor.includes('РК ')&&!ownEvent.actor.includes('Администратор '),'Concurrent real operator work has no delegated author');
 const headJournal=(await call('head','/api/crm/history?employeeId=head')).data;
 assert.ok(headJournal.rows.some(e=>e.text.includes('Synthetic delegated head edit')),'Head journal includes their delegated edits');
 const reminder=await call('admin','/api/crm',{action:'readReminder',id:'synthetic-missing-reminder'});assert.equal(reminder.status,200,JSON.stringify(reminder));
 const audit=d.prepare("SELECT * FROM auth_impersonation_audit WHERE kind='request'").all();assert.ok(audit.some(r=>r.admin_id==='admin'&&r.target_id==='one'&&r.action==='readReminder'&&r.status===200));
 assert.deepEqual(d.prepare('SELECT * FROM auth_sessions ORDER BY token_hash').all(),sessionsBefore,'No session is deleted, replaced or extended');
 d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='one'").run();assert.equal((await call('admin','/api/auth/me')).status,401,'Disabled target fails closed');
 const loginPage=await call('admin','/login');assert.ok(loginPage.data.includes('Вернуться в администратора'),'Return remains available even with a disabled target');
 assert.equal((await call('admin',switchPath,{action:'stop'})).status,200);assert.equal((await call('admin','/api/auth/me')).data.employee.id,'admin');
 d.prepare("UPDATE auth_accounts SET enabled=1 WHERE employee_id='one'").run();
 const competing=await Promise.all([call('admin',switchPath,start),call('admin',switchPath,{...start,employeeId:'two'})]);
 assert.equal(competing.filter(r=>r.status===200).length,1,'Only one concurrent switch can win');assert.ok(competing.every(r=>[200,403,409].includes(r.status)));
 assert.equal((await call('admin',switchPath,{action:'stop'})).status,200);
 assert.equal((await call('admin',switchPath,{action:'start',employeeId:'admin2'})).status,200);assert.equal((await call('admin','/api/oktell-delivery')).status,403,'Phone controls remain forbidden even as another admin');
 assert.equal((await call('admin',switchPath,{action:'stop'})).status,200);
 assert.equal((await call('admin',switchPath,start)).status,200);
 d.prepare("UPDATE employees SET data=json_set(data,'$.role','operator') WHERE id='admin'").run();assert.equal((await call('admin','/api/auth/me')).status,401,'Revoked administrator rights end effective access');
 assert.equal((await call('admin',switchPath,{action:'stop'})).status,200);assert.equal((await call('admin','/api/auth/me')).data.employee.role,'operator','Return never restores revoked rights');
 d.prepare("UPDATE employees SET data=json_set(data,'$.role','admin') WHERE id='admin'").run();
 assert.equal((await call('admin',switchPath,start)).status,200);assert.equal((await call('admin','/api/auth/logout',{})).status,200);assert.equal((await call('admin','/api/auth/me')).status,401);assert.equal((await call('one','/api/auth/me')).status,200);
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM auth_impersonations').get().n,0);
 assert.ok(d.prepare("SELECT COUNT(*) AS n FROM auth_impersonation_audit WHERE kind IN ('start','stop','logout')").get().n>=6);
 console.log('Impersonation HTTP: admin-only/CSRF, effective identity, independent sessions, live employee phone, no impersonated phone traffic, audit, disabled targets, return, revocation and logout passed; no real calls');
}catch(error){console.error(logs);throw error;}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}if(bridge){bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}d.close();rmSync(dir,{recursive:true,force:true});
}

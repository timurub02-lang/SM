// Run after the Miran standalone build. Uses only a temporary, synthetic database.
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {createHmac} from 'node:crypto';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-auth-')), db=new DatabaseSync(join(dir,'test.sqlite'));
const password='test-password-only-123',pbxKey='fixture-pbx-result-key-not-a-real-secret';
const origin='https://crm.test',port=process.env.AUTH_TEST_PORT||'3109',base=`http://127.0.0.1:${port}`;
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password);
 const staff=[['admin','admin','1'],['one','operator','1'],['two','operator','2'],['debtor','operator','2'],['head','department_head','1'],['head2','department_head','2'],['head0','department_head',''],['logistic','logistic',''],['chief','chief_logistic',''],['redemption','redemption',''],['courier','courier','']].map(([id,role,department])=>({id,login:id,name:'Test '+id,alias:'',skLogin:'',role,department,salary:100,bonus:10,sz:id==='two',version:1}));
 for(const e of staff){db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(e.id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(e.id,hash);}
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 for(const id of ['one','two']){
  const c={id:'c-'+id,name:'Client '+id,phone:id==='one'?'+79990000001':'+79990000002',city:'',address:'',source:'Test',owner:id,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:new Date().toISOString(),createdAt:new Date().toISOString(),version:1};
  db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
  const o={id:'o-'+id,clientId:c.id,manager:id,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:c.createdAt,updatedAt:c.createdAt,version:1};
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_PHONE_STAFF_ENABLED:'1',CRM_PHONE_RESULT_KEY:pbxKey,CRM_PHONE_RECORDINGS_DIR:join(dir,'recordings'),CRM_PHONE_USER:'pilot-test',CRM_PHONE_PASSWORD:'fixture-secret',CRM_PHONE_TEST_NUMBER:'79990000001',CRM_PHONE_CALLER_ID:'79000000000',CRM_PHONE_EMPLOYEE:'admin',CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,'Server failed to start');
 async function call(path,{cookie,body,headers={},method}={}){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,headers:r.headers,text};}
 async function login(name,pw=password){return call('/api/auth/login',{body:{login:name,password:pw}});}
 const cookies={};for(const {id} of staff){const r=await login(id);assert.equal(r.status,200,r.text);cookies[id]=r.headers.get('set-cookie').split(';')[0];}


 const period='2026-10-2';
 for(const id of ['head','head2'])db.prepare("UPDATE employees SET data=json_set(data,'$.leaderPremium',json(?)) WHERE id=?").run(JSON.stringify({model:'salary_bonus',fixedPerPeriod:100,links:[]}),id);
 for(const id of ['o-one','o-two'])db.prepare("UPDATE orders SET data=json_set(data,'$.status','redeemed','$.delivery','russian_post','$.paymentReceivedAt','2026-10-25T10:00:00Z','$.paymentReceivedAmount',1000) WHERE id=?").run(id);
 const initial={revision:'initial',initialPeriod:period,activePeriod:period,historyReconciled:true,periods:{[period]:{status:'open',signatures:{}}}};
 db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').run('premium-ledger',JSON.stringify(initial));
 const draft={salary:0,vacation:0,official:0,debt:12.34,penalty:0,extra:0,sz:false,firstHalfBonus:null,revision:'debt'};
 db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').run('premium-draft:'+period+':one',JSON.stringify({...draft,debt:0,official:10}));
 db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').run('premium-draft:'+period+':debtor',JSON.stringify(draft));
 db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').run('premium-draft:2026-11-1:debtor',JSON.stringify({...draft,debt:5}));
 const ledger=()=>JSON.parse(db.prepare("SELECT data FROM settings WHERE id='premium-ledger'").get().data);
 const act=(who,action,revision=ledger().revision)=>call('/api/premium/lifecycle',{cookie:cookies[who],body:{period,revision,action}});
 const stages=async()=>{const r=await call('/api/crm',{cookie:cookies.admin});assert.equal(r.status,200,r.text);return Object.fromEntries(r.data.orders.map(o=>[o.id,o.premiumStage?.status]));};
 for(const id of ['one','two']){
  const future={...JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get('o-'+id).data),id:'future-'+id,paymentReceivedAt:'2026-10-28T10:00:00Z'};
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(future.id,future.clientId,JSON.stringify(future));
 }
 for(const who of ['one','head']){
  const preview=await call('/api/crm',{cookie:cookies[who]});assert.equal(preview.status,200);
  assert.equal(preview.data.premiumNextPeriod,'2026-11-1');
  assert.equal(preview.data.orders.find(o=>o.id==='future-one').premiumNextPeriod,'2026-11-1');
  assert(!preview.data.orders.some(o=>o.id==='future-two'));
  assert(!preview.data.orders.find(o=>o.id==='future-one').premiumStage);
 }
 assert.equal((await stages())['o-one'],'accrued');
 assert.equal((await act('one','freeze')).status,403);
 assert.equal((await act('head','freeze')).status,403);
 assert.equal((await act('admin','freeze')).status,200);
 assert.equal((await act('admin','pay')).status,400);
 const blockedEdit=await call('/api/premium?period='+period,{cookie:cookies.admin,body:{employeeId:'one',employeeVersion:1,revision:'',adjustment:{salary:0,vacation:0,official:0,debt:0,penalty:0,extra:0,sz:false,firstHalfBonus:null}}});
 assert.equal(blockedEdit.status,409,blockedEdit.text);
 assert.equal((await act('one','sign')).status,403);
 assert.equal((await act('head','pay')).status,403);
 assert.equal((await act('head','sign','stale')).status,409);
 const late={...JSON.parse(db.prepare("SELECT data FROM orders WHERE id='o-one'").get().data),id:'late',paymentReceivedAt:'2026-10-25T12:00:00Z'};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(late.id,late.clientId,JSON.stringify(late));
 assert.equal((await stages()).late,undefined);
 assert.equal((await act('head','sign')).status,200);
 assert.equal((await act('admin','pay')).status,400);
 assert.equal((await act('head2','sign')).status,200);
 assert.equal((await act('head','reopen')).status,403);
 assert.equal((await act('admin','reopen')).status,200);
 assert.equal(ledger().periods[period].status,'open');
 assert.deepEqual(ledger().periods[period].signatures,{});
 assert.equal(ledger().periods[period].returns.length,1);
 assert.equal((await act('admin','freeze')).status,200);
 assert.equal((await act('head','sign')).status,200);
 assert.equal((await act('head2','sign')).status,200);
 const frozen=JSON.stringify(ledger());
 assert.equal((await act('admin','pay')).status,400,'Empty cash must block payment');
 assert.equal(JSON.stringify(ledger()),frozen,'Failed debit must roll back period');
 assert.equal(db.prepare("SELECT count(*) AS n FROM cash_operations WHERE kind='spend'").get().n,0);
 const fund=id=>db.prepare("INSERT INTO cash_operations VALUES(?, 'add',NULL,?,100000,'Test funding','2026-10-29','2026-10-29','2026-10-29','admin','','Test',NULL)").run('fund-'+id,id);
 fund('head');
 assert.equal((await act('admin','pay')).status,400,'Second cash shortage must roll back first debit');
 assert.equal(JSON.stringify(ledger()),frozen);
 assert.equal(db.prepare("SELECT count(*) AS n FROM cash_operations WHERE kind='spend'").get().n,0);
 assert.equal(JSON.parse(db.prepare("SELECT data FROM settings WHERE id='premium-draft:2026-11-1:debtor'").get().data).debt,5,'Failed cash must not carry debt');
 fund('head2');
 assert.equal((await act('admin','pay','stale')).status,409);
 assert.equal((await act('admin','pay')).status,200);
 const spends=db.prepare("SELECT sender,amount FROM cash_operations WHERE kind='spend' ORDER BY sender").all();
 assert.deepEqual(spends.map(r=>({...r})),[{sender:'head',amount:20000},{sender:'head2',amount:10000}],'Н includes head/operator, SZ excluded');

 assert.equal(ledger().activePeriod,'2026-11-1');
 const result=await stages();assert.equal(result['o-one'],'paid');assert.equal(result['o-two'],'paid');assert.equal(result.late,'accrued');
 assert.equal((await act('admin','pay')).status,400);
 assert.equal(db.prepare("SELECT count(*) AS n FROM cash_operations WHERE kind='spend'").get().n,2,'Retry never debits twice');
 assert.equal((await act('admin','reopen')).status,400,'Paid period cannot reopen');
 assert.equal(JSON.parse(db.prepare("SELECT data FROM settings WHERE id='premium-draft:2026-11-1:debtor'").get().data).debt,17.34,'Exact debt carried once and adds to existing advance');
 for(const who of ['admin','head','one']){
  const stats=await call('/api/premium/statistics?month=2026-10',{cookie:cookies[who]});
  assert.equal(stats.status,who==='one'?403:200);
  if(who==='head')assert(stats.data.rows.every(r=>r.department==='1'));
  if(who==='admin'){assert.equal(stats.data.rows.find(r=>r.id==='head').second,100);assert.equal(stats.data.rows.find(r=>r.id==='one').second,110,'Statistics add official part');}
 }
 for(const who of ['admin','head','one']){
  const response=await fetch(base+'/api/premium/export?period='+period+'&department=2',{headers:{cookie:cookies[who]}});
  assert.equal(response.status,who==='one'?403:200);
  if(who==='one')continue;
  assert(response.headers.get('content-type').includes('spreadsheetml'));
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const values=workbook.worksheets.flatMap(sheet=>sheet.getSheetValues()).flat(3);
  assert(values.includes('one'));assert(values.includes('head'));
  assert.equal(values.includes('two'),who==='admin','Workbook must not contain another department');
  assert.equal(workbook.worksheets.length,who==='admin'?5:3);
  const summary=workbook.getWorksheet('Итоги'),total=summary.lastRow;
  assert.equal(total.getCell(2).value,who==='admin'?2:1);
  assert.equal(total.getCell(3).value,who==='admin'?2000:1000);
  assert.equal(total.getCell(4).value,who==='admin'?300:200);
  assert.equal(total.getCell(5).value,who==='admin'?100:0);
 }
 assert.equal((await call('/api/premium/export?period='+period+'&actorId=admin',{cookie:cookies.head})).status,403);
 for(const who of ['admin','head','one','logistic']){
  const r=await call('/api/premium/archive',{cookie:cookies[who]});
  assert.equal(r.status,who==='logistic'?403:200);
  if(who==='logistic')continue;
  assert.deepEqual(r.data.periods.map(p=>p.id),[period],'Paid period automatically enters archive');
  const p=r.data.periods[0];assert.equal(p.count,who==='admin'?2:1);
  const calculation=await call('/api/premium?period='+period,{cookie:cookies[who]});
  assert.equal(calculation.data.periodCounts[period],p.count,'Period selector counts the saved worksheet, using the same role scope as archive');
  if(who!=='admin')assert(p.orders.every(o=>o.employeeId==='one'),'No other operators in scoped archive');
  assert.equal(p.payout,who==='admin'?400:who==='head'?200:100);
 }
 assert.equal((await call('/api/premium/archive?actorId=admin',{cookie:cookies.one})).status,403);
 const operatorState=await call('/api/crm',{cookie:cookies.one});assert.equal(operatorState.status,200,operatorState.text);
 assert(operatorState.data.orders.some(o=>o.id==='o-one'&&o.status==='redeemed'&&o.premiumStage.status==='paid'));
 assert(!operatorState.data.orders.some(o=>o.id==='o-two'));
 const historical=ledger();historical.periods[period].orders.push({externalId:'archive-only',employeeId:'one',login:'one',department:'1',amount:300});
 db.prepare("UPDATE settings SET data=? WHERE id='premium-ledger'").run(JSON.stringify(historical));
 for(const who of ['admin','head','one']){
  const r=await call('/api/premium?period='+period,{cookie:cookies[who]});
  assert.equal(r.data.periodCounts[period],who==='admin'?3:2,'Saved orders missing from CRM still count in the worksheet');
 }
 console.log('Payroll HTTP: roles, signatures, reopen audit, cash rollback, exact debt carry, repeat protection, scoped statistics, official part and order rollover passed. Synthetic data only.');
}catch(error){console.error(logs);throw error;}
finally{if(server){server.kill('SIGTERM');await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

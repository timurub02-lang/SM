import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {registryPayments,applyCdekRegistries,syncCdekRemittances} from '../lib/cdek-remittance-sync.ts';
import {cdekMoneyLabel,remittanceAccountingDate} from '../lib/cdek-remittance.ts';
import {periodOrders,applyPremiumStages,freezePeriod,signPeriod,payPeriod,ledgerRows} from '../lib/premium-ledger.ts';
import {orderDisplayGroup} from '../lib/order-premium-stage.ts';
const folder=mkdtempSync(join(tmpdir(),'cdek-remittances-')),db=openDatabase(join(folder,'test.sqlite'));
const at='2026-10-29T08:00:00Z';
const registry=(number='R1',amount=90,date='2026-10-28',tracking='123')=>({registry_number:number,payment_date:date,orders:[{cdek_number:tracking,payment_sum:100,transfer_sum:amount,basis_type:'ORDER'}]});
const answer=(...registries)=>({registries});
async function row(id='o'){const r=await db.prepare('SELECT data,version FROM orders WHERE id=?').bind(id).first();return {...JSON.parse(r.data),version:r.version};}
async function fixture(id='o',extra={},slot){
 const o={id,clientId:'c',manager:'operator',delivery:'cdek_pickup',status:'redeemed',redeemedAt:'2026-10-01T12:00:00Z',legacyLv:{track:'123'},items:[],...extra};
 await db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(id,'c',JSON.stringify(o)).run();
 if(slot)await db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('cdek-shipment-'+id,JSON.stringify({number:'123',slot})).run();
}
try{
 for(const sql of readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8').split('--> statement-breakpoint'))await db.prepare(sql).run();
 await db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('c','+79990000000','{}').run();
 await fixture();
 assert.deepEqual(registryPayments({},1),[],"CDEK returns an empty object on days with no registries");
 assert.equal(cdekMoneyLabel(await row()),'Оплачен · ожидается приём денег');
 for(const bad of [answer(registry('R0',0)),answer(registry('R0',-5)),answer({...registry('fee',8),orders:[{cdek_number:'123',payment_sum:0,transfer_sum:8}]})])assert.equal((await applyCdekRegistries(db,1,bad,at)).added,0);
 const negativeBank=await db.prepare("SELECT data FROM settings WHERE id=?").bind('cdek-bank-registry:'+JSON.stringify([1,'R0','2026-10-28'])).first();
 assert.equal(JSON.parse(negativeBank.data).rows[0].transferred,-500,'Negative registry rows are retained for the bank balance without marking an order paid');
 await applyCdekRegistries(db,1,answer(registry('SCOPED',50)),at,true,new Set(['not-present']));
 assert.equal(await db.prepare('SELECT data FROM settings WHERE id=?').bind('cdek-bank-registry:'+JSON.stringify([1,'SCOPED','2026-10-28'])).first(),null,'Scoped order repair cannot replace a complete bank registry');
 assert.equal((await applyCdekRegistries(db,1,answer(registry()),at,true)).added,1);assert.equal((await row()).cdekRemittances,undefined);
 assert.equal((await applyCdekRegistries(db,1,answer(registry()),at)).added,1);
 const paid=await row();assert.equal(paid.cdekRemittances[0].amountCents,9000);assert.equal(paid.paymentReceivedAt,undefined);assert.equal(paid.status,'redeemed');
 assert.match(cdekMoneyLabel(paid),/Деньги получены · реестр №R1 · 28.10.2026/);
 assert.equal((await applyCdekRegistries(db,1,answer(registry(),registry()),at)).unchanged,1);
 assert.equal((await row()).version,paid.version);assert.equal((await db.prepare('SELECT COUNT(*) n FROM events').first()).n,1);
 await applyCdekRegistries(db,1,answer(registry('R1',0)),at);assert.equal((await row()).cdekRemittances.length,1);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('R2',80)),at)).conflicts,1);assert.match(cdekMoneyLabel(await row()),/требуется проверка/);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('R2',80)),at)).unchanged,1);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('R2',85)),at)).conflicts,1,'Changed positive amount retained as conflict');
 assert.equal((await row()).cdekRemittances.length,3);
 assert.throws(()=>registryPayments(answer({...registry(),payment_date:'2026-02-30'}),1));
 assert.throws(()=>registryPayments({errors:[{code:'error'}]},1));
 assert.throws(()=>registryPayments(answer({...registry(),payment_date:undefined}),1));
 await fixture('duplicate');assert.equal((await applyCdekRegistries(db,1,answer(registry('R3')),at)).ambiguous,1);assert.equal((await row('duplicate')).cdekRemittances,undefined);
 await db.prepare("DELETE FROM orders WHERE id='duplicate'").run();
 await fixture('other-account',{legacyLv:{track:'456'}},2);
 // Shipment identity is authoritative, and duplicated numbers never choose the first order.
 assert.equal((await applyCdekRegistries(db,1,answer(registry('R3')),at)).ambiguous,1);
 await db.prepare("UPDATE settings SET data=? WHERE id='cdek-shipment-other-account'").bind(JSON.stringify({number:'456',slot:2})).run();
 assert.equal((await applyCdekRegistries(db,1,answer(registry('R3',90,'2026-10-28','456')),at)).unmatched,1);
 for(const [id,extra] of [['test',{testOnly:true}],['shipping',{status:'shipping'}],['post',{delivery:'russian_post'}]]){await fixture(id,{legacyLv:{track:id},...extra});await applyCdekRegistries(db,1,answer(registry('R3',90,'2026-10-28',id)),at);assert.equal((await row(id)).cdekRemittances,undefined);}
 await fixture('equal',{legacyLv:{track:'equal'}});
 await applyCdekRegistries(db,1,answer(registry('equal-1',90,'2026-11-09','equal')),at);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('equal-2',90,'2026-11-10','equal')),at)).conflicts,0);
 assert.equal((await row('equal')).cdekRemittances.length,2,'Duplicate evidence retained');
 assert.match(cdekMoneyLabel(await row('equal')),/09.11.2026 · дубль не начисляется/);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('equal-2',90,'2026-11-10','equal')),at)).unchanged,1);
 await fixture('race',{legacyLv:{track:'race'}});
 const racing={prepare:sql=>db.prepare(sql),batch:async stmts=>{await db.prepare("UPDATE orders SET data=json_set(data,'$.comment','new'),version=version+1 WHERE id='race'").run();return db.batch(stmts);}};
 assert.equal((await applyCdekRegistries(racing,1,answer(registry('R4',90,'2026-10-28','race')),at)).races,1);assert.equal((await row('race')).cdekRemittances,undefined);
 await db.prepare("CREATE TRIGGER test_failure BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'audit failed'); END").run();
 await assert.rejects(applyCdekRegistries(db,1,answer(registry('R4',90,'2026-10-28','race')),at));assert.equal((await row('race')).cdekRemittances,undefined);
 await db.prepare('DROP TRIGGER test_failure').run();


 // Calendar cutoff applies even while the administrator has not frozen the old sheet.
 const beforeCutoff='2026-11-24T20:59:59.999Z',afterCutoff='2026-11-24T21:00:00.000Z';
 for(const [id,time] of [['boundary-before',beforeCutoff],['boundary-after',afterCutoff]]){
  await fixture(id,{legacyLv:{track:id}});
  await applyCdekRegistries(db,1,answer(registry(id,90,'2026-11-03',id)),time);
 }
 const boundaryOrders=[await row('boundary-before'),await row('boundary-after')];
 const boundaryStaff=[{id:'operator',login:'synthetic',name:'Synthetic',role:'operator',department:'a',bonus:10},{id:'head',role:'department_head',name:'Head',department:'a',leaderPremium:{model:'salary_bonus',fixedPerPeriod:0,links:[]}}];
 let boundaryLedger={revision:'test',activePeriod:'2026-11-2',initialPeriod:'2026-11-2',historyReconciled:true,periods:{'2026-11-2':{status:'open',signatures:{}}}};
 const boundaryGroups=l=>applyPremiumStages(l,boundaryOrders,boundaryStaff).map(o=>orderDisplayGroup(o).id);
 assert.equal(remittanceAccountingDate(boundaryOrders[0].cdekRemittances[0]),'2026-11-24');
 assert.equal(remittanceAccountingDate(boundaryOrders[1].cdekRemittances[0]),'2026-11-25');
 assert.deepEqual(boundaryGroups(boundaryLedger),['accrued','paid']);
 assert.deepEqual(periodOrders(boundaryLedger,'2026-11-2',boundaryOrders,boundaryStaff).map(o=>o.id),['boundary-before']);
 assert.equal(ledgerRows(boundaryLedger,'2026-11-2',boundaryOrders,boundaryStaff,{}).find(r=>r.employeeId==='operator').volume,100);
 boundaryLedger=freezePeriod(boundaryLedger,'2026-11-2',boundaryOrders,boundaryStaff,{},'admin','2026-11-30T12:00:00Z');
 const boundarySnapshot=JSON.stringify(boundaryLedger.periods['2026-11-2'].orders);
 boundaryLedger=signPeriod(boundaryLedger,'2026-11-2',boundaryStaff[1],'2026-11-30T12:01:00Z');
 assert.deepEqual(boundaryGroups(boundaryLedger),['accrued','paid']);
 boundaryLedger=payPeriod(boundaryLedger,'2026-11-2','admin','2026-12-01T12:00:00Z');
 assert.equal(boundaryLedger.activePeriod,'2026-12-1');
 assert.deepEqual(boundaryGroups(boundaryLedger),['premium_paid','accrued']);
 assert.equal(ledgerRows(boundaryLedger,'2026-12-1',boundaryOrders,boundaryStaff,{}).find(r=>r.employeeId==='operator').volume,100);
 assert.equal(JSON.stringify(boundaryLedger.periods['2026-11-2'].orders),boundarySnapshot);
 await applyCdekRegistries(db,1,answer(registry('boundary-after',90,'2026-11-03','boundary-after')),'2026-12-10T12:00:00Z');
 assert.equal((await row('boundary-after')).cdekRemittances[0].receivedAt,afterCutoff,'Replay preserves first acceptance');
 assert.equal((await row('boundary-after')).cdekRemittances[0].paymentDate,'2026-11-03','Original registry date remains visible');
 assert.equal(remittanceAccountingDate({paymentDate:'2026-11-03'}),'2026-11-03','Existing historical receipts are not reassigned');
 await assert.rejects(applyCdekRegistries(db,1,answer(),'invalid-time'));

 const missingCount=async()=>Number((await db.prepare("SELECT COUNT(*) n FROM cdek_unmatched_remittances WHERE tracking='missing-track'").first()).n);
 const missingReceipt=answer(registry('MISSING',90,'2026-10-28','missing-track'));
 const beforeOrders=(await db.prepare('SELECT COUNT(*) n FROM orders').first()).n;
 await applyCdekRegistries(db,1,missingReceipt,at,true);assert.equal(await missingCount(),0,'Dry run does not save missing receipts');
 assert.equal((await applyCdekRegistries(db,1,missingReceipt,at)).unmatched,1);assert.equal(await missingCount(),1);
 await applyCdekRegistries(db,1,missingReceipt,at);assert.equal(await missingCount(),1,'Repeated response is not duplicated');
 await applyCdekRegistries(db,1,answer(registry('MISSING2',80,'2026-10-29','missing-track')),at);assert.equal(await missingCount(),2,'Separate evidence retained');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders').first()).n,beforeOrders,'Unknown receipt does not create an order');
 await fixture('new-match',{legacyLv:{track:'missing-track'}});
 assert.equal((await applyCdekRegistries(db,1,missingReceipt,at)).added,1);assert.equal(await missingCount(),1,'Only matched receipt is removed');
 await applyCdekRegistries(db,1,answer(registry('MISSING2',80,'2026-10-29','missing-track')),at);assert.equal(await missingCount(),0);
 assert.equal((await row('new-match')).cdekRemittances.length,2);assert.match(cdekMoneyLabel(await row('new-match')),/требуется проверка/);
 async function historyFixture(key,tracking=key){
  const client={id:'history-'+key,owner:'other-operator',assignedUntil:'2027-01-01',legacyOrderHistory:[{externalId:key,status:'paid'}]};
  await db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(client.id,'+7999'+key,JSON.stringify(client)).run();
  const o={id:'LV-'+key,clientId:client.id,status:'redeemed',manager:'original-operator',delivery:'cdek_pickup',items:[],createdAt:at,redeemedAt:at,cdekTrackingNumber:tracking,legacyLv:{orderId:key,track:tracking,originalOperatorLogin:'original.login'}};
  await db.prepare('INSERT INTO cdek_history_recovery(external_id,client_id,tracking,data) VALUES(?,?,?,?)').bind(key,client.id,tracking,JSON.stringify(o)).run();return client;
 }
 await historyFixture('90010');
 await db.prepare("UPDATE cdek_history_recovery SET data=json_set(data,'$.legacyLv.status','Выплачен') WHERE external_id='90010'").run();
 assert.equal((await applyCdekRegistries(db,1,answer(registry('HP',90,'2026-10-28','90010')),at)).archived,1);
 assert.equal(await db.prepare("SELECT id FROM orders WHERE id='LV-90010'").first(),null);
 assert.equal(JSON.parse((await db.prepare("SELECT data FROM clients WHERE id='history-90010'").first()).data).legacyOrderHistory.length,1);
 const hc=await historyFixture('90001');
 assert.equal((await applyCdekRegistries(db,1,answer(registry('H1',90,'2026-10-28','90001')),at,true)).recovered,1);
 assert.equal(await db.prepare("SELECT id FROM orders WHERE id='LV-90001'").first(),null);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('H1',90,'2026-10-28','90001')),at)).recovered,1);
 const recovered=await row('LV-90001');assert.equal(recovered.manager,'original-operator');assert.equal(recovered.cdekHistoryRecovery.registry,'H1');assert.match(cdekMoneyLabel(recovered),/создан из истории/);
 const after=JSON.parse((await db.prepare('SELECT data FROM clients WHERE id=?').bind(hc.id).first()).data);assert.equal(after.owner,hc.owner);assert.equal(after.assignedUntil,hc.assignedUntil);assert.deepEqual(after.legacyOrderHistory,[]);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('H1',90,'2026-10-28','90001')),at)).unchanged,1);
 assert.equal((await applyCdekRegistries(db,1,answer(registry('H2',90,'2026-10-29','90001')),at)).recovered,0);assert.equal((await row('LV-90001')).cdekRemittances.length,2);
 await historyFixture('90009');
await db.prepare("UPDATE cdek_history_recovery SET data=json_remove(data,'$.delivery') WHERE external_id='90009'").run();
const unknownDelivery=await applyCdekRegistries(db,1,answer(registry('H9',90,'2026-10-28','90009')),at);assert.equal(unknownDelivery.recovered,1);
assert.equal((await applyCdekRegistries(db,1,answer(registry('H9',90,'2026-10-28','90009')),at)).unchanged,1);
await historyFixture('90002');await db.prepare("INSERT INTO settings(id,data) VALUES('premium-ledger',?)").bind(JSON.stringify({periods:{old:{status:'paid',orders:[{externalId:'90002'}]}}})).run();
 assert.equal((await applyCdekRegistries(db,1,answer(registry('H3',90,'2026-10-28','90002')),at)).archived,1);assert.equal(await db.prepare("SELECT id FROM orders WHERE id='LV-90002'").first(),null);
 await historyFixture('90003','shared');await historyFixture('90004','shared');assert.equal((await applyCdekRegistries(db,1,answer(registry('H4',90,'2026-10-28','shared')),at)).ambiguous,1);
 await historyFixture('90005');
 const recoveryRace={prepare:sql=>db.prepare(sql),batch:async statements=>{await db.prepare("UPDATE clients SET version=version+1 WHERE id='history-90005'").run();return db.batch(statements);}};
 assert.equal((await applyCdekRegistries(recoveryRace,1,answer(registry('H5',90,'2026-10-28','90005')),at)).races,1);assert.equal(await db.prepare("SELECT id FROM orders WHERE id='LV-90005'").first(),null);
 await db.prepare("CREATE TRIGGER recovery_failure BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'audit failed'); END").run();await assert.rejects(applyCdekRegistries(db,1,answer(registry('H5',90,'2026-10-28','90005')),at));assert.equal(await db.prepare("SELECT id FROM orders WHERE id='LV-90005'").first(),null);await db.prepare('DROP TRIGGER recovery_failure').run();
 await db.prepare("INSERT INTO settings(id,data) VALUES('cdek-1',?)").bind(JSON.stringify({clientId:'test',clientSecret:'test'})).run();
 let calls=[],mode='normal';
 const request=async(url,opts)=>{const u=new URL(url);calls.push(u.pathname+u.search);if(u.pathname.endsWith('/token'))return Response.json({access_token:'synthetic'});assert.equal(opts.method,undefined);if(mode==='error')return Response.json({}, {status:429});return Response.json(answer());};
 let summary=await syncCdekRemittances(db,request,Date.parse(at));assert.equal(summary.checked,2);assert.ok(calls.some(s=>s.includes('date=2026-10-29')));assert.ok(calls.some(s=>s.includes('date=2026-10-01')));
 calls=[];await syncCdekRemittances(db,request,Date.parse(at)+60000);assert.ok(!calls.some(s=>s.includes('date=2026-10-29')));assert.ok(calls.some(s=>s.includes('date=2026-10-02')));
 mode='error';summary=await syncCdekRemittances(db,request,Date.parse(at)+120000);assert.equal(summary.failed,1);
 mode='normal';calls=[];await syncCdekRemittances(db,request,Date.parse(at)+180000);assert.equal(calls.length,0,'No token or registry requests during backoff');
 await syncCdekRemittances(db,request,Date.parse(at)+421000);assert.ok(calls.some(s=>s.includes('date=2026-10-03')),'Failed day retried after backoff');
 await db.prepare("UPDATE settings SET data=? WHERE id='cdek-registry-sync-1'").bind(JSON.stringify({nextDay:'2026-10-29',todayCheckedAt:at})).run();
 calls=[];await syncCdekRemittances(db,request,Date.parse(at)+480000);assert.equal(calls.length,0,'Today is not polled again through the historical cursor');
 await syncCdekRemittances(db,request,Date.parse(at)+3600001);assert.equal(calls.filter(s=>s.includes('date=2026-10-29')).length,1);
 async function retryCase(label,read,attempts,failed=false,retrySeconds=300){
  const now=Date.parse(at)+60000,initial={nextDay:'2026-10-03',todayCheckedAt:at},signals=[];let tokenCalls=0;
  await db.prepare("UPDATE settings SET data=? WHERE id='cdek-registry-sync-1'").bind(JSON.stringify(initial)).run();
  const result=await syncCdekRemittances(db,async(url,options)=>{
   if(new URL(url).pathname.endsWith('/token')){tokenCalls++;return Response.json({access_token:'synthetic'});}
   assert.equal(new URL(url).searchParams.get('date'),'2026-10-03',label);
   assert.equal(options.method,undefined,'Retry is restricted to GET');
   signals.push(options.signal);return read(signals.length);
  },now);
  assert.equal(signals.length,attempts,label);assert.equal(tokenCalls,1,'Token POST is not retried');
  if(attempts===2)assert.notEqual(signals[0],signals[1],'Each attempt has a fresh timeout');
  const state=JSON.parse((await db.prepare("SELECT data FROM settings WHERE id='cdek-registry-sync-1'").first()).data);
  assert.equal(result.failed,Number(failed),label);
  assert.equal(state.nextDay,failed?initial.nextDay:'2026-10-04',label);
  assert.equal(state.todayCheckedAt,initial.todayCheckedAt,'Failed date must not advance the daily watermark');
  assert.equal(state.retryAt,failed?new Date(now+retrySeconds*1000).toISOString():undefined,label);
  return result;
 }
 await fixture('retry-paid',{legacyLv:{track:'retry-paid'}});
 const beforeRetryEvents=(await db.prepare('SELECT COUNT(*) n FROM events').first()).n;
 const retryPaid=await retryCase('Timeout followed by success',attempt=>{
  if(attempt===1)throw new DOMException('synthetic timeout','TimeoutError');
  return Response.json(answer(registry('RETRY',90,'2026-10-03','retry-paid')));
 },2);
 assert.equal(retryPaid.added,1);assert.equal((await row('retry-paid')).cdekRemittances.length,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM events').first()).n,beforeRetryEvents+1,'Retry produces one financial audit event');
 await retryCase('Repeated timeout retains date',()=>{throw new DOMException('synthetic timeout','TimeoutError');},2,true);
 await retryCase('Transient network failure',attempt=>{if(attempt===1)throw new TypeError('fetch failed');return Response.json(answer());},2);
 await retryCase('Timeout while reading response body',attempt=>{
  const response=Response.json(answer());if(attempt===1)response.json=async()=>{throw new DOMException('body timeout','TimeoutError');};return response;
 },2);
 for(const status of [502,503,504])await retryCase('Temporary HTTP '+status,attempt=>attempt===1?Response.json({}, {status}):Response.json(answer()),2);
 await retryCase('Repeated gateway failure',()=>Response.json({}, {status:503}),2,true);
 await retryCase('Rate limit is deferred without immediate retry',()=>Response.json({}, {status:429,headers:{'Retry-After':'600'}}),1,true,600);
 for(const status of [401,403])await retryCase('Authentication failure '+status,()=>Response.json({}, {status}),1,true);
 await retryCase('Invalid registry data is not retried',()=>Response.json({unexpected:'shape'}),1,true);
 await retryCase('Explicit abort is not retried',()=>{throw new DOMException('cancelled','AbortError');},1,true);
 await fixture('midnight-response',{legacyLv:{track:'midnight-response'}});
 await db.prepare("UPDATE settings SET data='{}' WHERE id='cdek-registry-sync-1'").run();
 await syncCdekRemittances(db,async url=>{
  if(new URL(url).pathname.endsWith('/token'))return Response.json({access_token:'synthetic'});
  await new Promise(resolve=>setTimeout(resolve,25));
  return Response.json(answer(registry('MIDNIGHT',90,'2026-11-03','midnight-response')));
 },Date.parse('2026-11-24T20:59:59.999Z'));
 assert.equal(remittanceAccountingDate((await row('midnight-response')).cdekRemittances[0]),'2026-11-25','Response received after midnight uses the new day, not request start');
 console.log('CDEK remittances: positive-only, replay, duplicate conflicts, identity, dry run, CAS, atomic audit and polling passed.');
}finally{db.close();rmSync(folder,{recursive:true,force:true});}

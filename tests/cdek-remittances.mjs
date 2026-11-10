import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {registryPayments,applyCdekRegistries,syncCdekRemittances} from '../lib/cdek-remittance-sync.ts';
import {cdekMoneyLabel} from '../lib/cdek-remittance.ts';
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

 async function historyFixture(key,tracking=key){
  const client={id:'history-'+key,owner:'other-operator',assignedUntil:'2027-01-01',legacyOrderHistory:[{externalId:key,status:'paid'}]};
  await db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(client.id,'+7999'+key,JSON.stringify(client)).run();
  const o={id:'LV-'+key,clientId:client.id,status:'redeemed',manager:'original-operator',delivery:'cdek_pickup',items:[],createdAt:at,redeemedAt:at,cdekTrackingNumber:tracking,legacyLv:{orderId:key,track:tracking,originalOperatorLogin:'original.login'}};
  await db.prepare('INSERT INTO cdek_history_recovery(external_id,client_id,tracking,data) VALUES(?,?,?,?)').bind(key,client.id,tracking,JSON.stringify(o)).run();return client;
 }
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
 console.log('CDEK remittances: positive-only, replay, duplicate conflicts, identity, dry run, CAS, atomic audit and polling passed.');
}finally{db.close();rmSync(folder,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {operatorReturnScheduled,awaitingOperator,initRedemption,syncRedemption,editRedemption,redemptionRows,archiveRedemption,inWorkday,allowedResults,refusalRetryDate,awaitingReturn,canSeeRedemption,dayOf,closedTime} from '../lib/redemption.ts';
const d=openDatabase(':memory:'),now=new Date('2026-10-15T12:00:00Z');
const admin={id:'a',name:'Админ',role:'admin'},buyer={id:'b',name:'Выкуп',role:'redemption'},op={id:'op',name:'Оператор',role:'operator',department:'1'},head={id:'h',role:'department_head',department:'1'};
try{
 await d.batch(['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)'].map(s=>d.prepare(s)));
 await initRedemption(d);
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('redemption-config',JSON.stringify({statuses:['ACCEPTED_AT_DELIVERY_WAREHOUSE']})).run();
 await d.prepare('INSERT INTO clients VALUES(?,?)').bind('c',JSON.stringify({id:'c',name:'Тест',phone:'+70000000001'})).run();
 await d.prepare('INSERT INTO employees VALUES(?,?)').bind(op.id,JSON.stringify(op)).run();
 const order={id:'o',manager:op.id,delivery:'cdek_pickup',cdekStatus:{code:'ACCEPTED_AT_DELIVERY_WAREHOUSE'},items:[]};
 await d.prepare('INSERT INTO orders VALUES(?,?,?)').bind('o','c',JSON.stringify(order)).run();
 await d.prepare('UPDATE redemption_entries SET entered_at=?').bind(now.toISOString()).run();
 let row=async()=>(await redemptionRows(d))[0];
 assert.equal((await row()).order_id,'o');
 await d.prepare('UPDATE orders SET data=?').bind(JSON.stringify({...order,cdekStatus:{code:'CREATED'}})).run();await syncRedemption(d,now);
 assert.equal((await row()).entered_at,now.toISOString());
 assert(canSeeRedemption(op,await row(),false));assert(canSeeRedemption(head,await row(),false));assert(!canSeeRedemption({...head,department:'2'},await row(),false));assert(canSeeRedemption({...head,department:'2'},await row(),true));assert(!canSeeRedemption({...op,id:'other'},await row(),true));
 async function edit(actor,p,t=now){await editRedemption(d,actor,{id:'o',version:(await row()).version,...p},t);}
 await assert.rejects(edit(admin,{action:'date',result:'date',date:'2026-10-20'}),/срок хранения/);
 await edit(admin,{operation:'storage',date:'2026-10-18'});
 await assert.rejects(edit(op,{action:'refusal',result:'date'}),/недоступен/);
 assert.equal(refusalRetryDate('2026-10-15'),'2026-10-19');assert.equal(refusalRetryDate('2026-10-16'),'2026-10-20');assert.equal(refusalRetryDate('2026-10-19'),'2026-10-21');
 assert.deepEqual(allowedResults('po',await row(),'operator','2026-10-15'),['date']);
 await edit(admin,{operation:'storage',date:'2026-10-22'});
 await edit(op,{action:'refusal',result:'date'});assert.equal((await row()).resultDate,'2026-10-19');assert.equal((await row()).refusalRetryUsed,true);assert(!inWorkday(await row(),'2026-10-15'));assert(!inWorkday(await row(),'2026-10-18'));assert(!inWorkday(await row(),'2026-10-19'));assert(awaitingOperator(await row()));assert(operatorReturnScheduled(await row(),now));assert.equal((await row()).operatorReturn.startsAt,'2026-10-19T06:00:00.000Z');assert.equal((await row()).operatorReturn.deadline,'2026-10-19T08:00:00.000Z');
 await assert.rejects(edit(op,{action:'refusal',result:'to_return'},new Date('2026-10-19T05:59:59Z')),/09:00/);assert(!operatorReturnScheduled(await row(),new Date('2026-10-19T06:00:00Z')));
 await assert.rejects(edit(op,{action:'refusal',result:'date'},new Date('2026-10-19T06:00:00Z')),/недоступен/);
 assert.deepEqual(allowedResults('refusal',await row(),'redemption','2026-10-19'),['to_return']);
 await syncRedemption(d,new Date('2026-10-19T07:59:59Z'));assert(awaitingOperator(await row()));
 await syncRedemption(d,new Date('2026-10-19T08:00:00Z'));assert(awaitingReturn(await row()));assert.equal((await row()).operatorReturn.outcome,'Оператор не проработал заказ');
 await d.prepare("UPDATE redemption_entries SET data=json_remove(json_set(data,'$.result',''),'$.operatorReturn')").run();
 await edit(admin,{operation:'storage',date:'2026-10-18'});
 await assert.rejects(edit(op,{action:'date',result:'date',date:'2026-10-19'}),/Дата/);
 assert.deepEqual(allowedResults('po',{storageUntil:'2026-10-22'},'operator','2026-10-15'),[]);
 await assert.rejects(edit(admin,{action:'refusal',result:'returned'}),/недоступен/);
 await assert.rejects(edit(buyer,{action:'nd',result:'returned'}),/недоступен/);
 await edit(op,{action:'nd',result:'none'});
 await archiveRedemption(d,new Date('2026-10-15T16:50:00Z'));
 const snapshot=(await d.prepare('SELECT data FROM redemption_archives').first()).data;assert.equal(JSON.parse(snapshot)[0].result,'none');
 await assert.rejects(edit(admin,{action:'nd',result:'none'},new Date('2026-10-15T17:00:00Z')),/закрыт/);
 await syncRedemption(d,new Date('2026-10-16T09:00:00Z'));assert.equal((await row()).result,'');assert(inWorkday(await row(),'2026-10-16'));
 assert.equal((await d.prepare('SELECT data FROM redemption_archives').first()).data,snapshot);
 await assert.rejects(edit(op,{action:'nd',result:'to_return'}),/недоступен/);
 await edit(op,{action:'refusal',result:'to_return'});
 assert(awaitingReturn(await row()));assert(!inWorkday(await row(),'2026-10-15'));assert(!inWorkday(await row(),'2026-10-16'));assert(canSeeRedemption(admin,await row(),true));assert(canSeeRedemption(buyer,await row(),true));assert(!canSeeRedemption(op,await row(),true));assert(!canSeeRedemption(head,await row(),true));
 await syncRedemption(d,new Date('2026-10-16T09:00:00Z'));assert(awaitingReturn(await row()));
 await assert.rejects(edit(op,{action:'refusal',result:'delivered'}),/недоступен/);await assert.rejects(edit(admin,{action:'refusal',result:'returned'}),/недоступен/);
 await assert.rejects(edit(buyer,{action:'refusal',result:'delivered'}),/недоступен/);
 await d.prepare('UPDATE orders SET data=?').bind(JSON.stringify({...order,cdekStatus:{code:'DELIVERED'}})).run();await syncRedemption(d,now);assert(awaitingReturn(await row()));
 await assert.rejects(edit(buyer,{action:'refusal',result:'returned'}),/накладной/);await edit(buyer,{action:'refusal',result:'returned',returnWaybill:'TEST-RETURN-123'});assert.equal((await row()).returnWaybill,'TEST-RETURN-123');await syncRedemption(d,now);assert.equal((await row()).result,'returned');
 await d.prepare('UPDATE orders SET data=?').bind(JSON.stringify(order)).run();assert(!inWorkday(await row(),'2026-10-16'));assert(!inWorkday(await row(),'2026-10-15'));assert(!awaitingReturn(await row()));
 assert.deepEqual(allowedResults('work',{storageUntil:'2026-10-18'},'operator','2026-10-15'),['date']);
 assert.deepEqual(allowedResults('date',{storageUntil:'2026-10-15'},'redemption','2026-10-15'),[]);
 assert.deepEqual(allowedResults('refusal',{storageUntil:'2026-10-15'},'operator','2026-10-15'),['to_return']);
 assert.deepEqual(allowedResults('po',{storageUntil:'2026-10-15'},'operator','2026-10-15'),['date']);
 await d.prepare("UPDATE redemption_entries SET data='{}'").run();
 await edit(admin,{operation:'storage',date:'2026-10-20'});
 await edit(op,{action:'date',result:'date',date:'2026-10-18'});
 assert.equal((await row()).dateConfirmation,'pending');
 for(const actor of [op,head]){
  assert(!canSeeRedemption(actor,await row(),true));
  await assert.rejects(edit(actor,{operation:'confirm_date'}),/недоступен/);
 }
 assert(canSeeRedemption(buyer,await row(),false));
 assert(!inWorkday(await row(),'2026-10-18'));
 assert(canSeeRedemption(admin,await row(),false));
 await edit(admin,{operation:'confirm_date'});
 assert.equal((await row()).dateConfirmedBy,admin.name);
 assert.equal((await row()).author,op.name);
 assert(!inWorkday(await row(),'2026-10-15'));
 assert(!inWorkday(await row(),'2026-10-17'));
 assert(inWorkday(await row(),'2026-10-18'));assert(inWorkday(await row(),'2026-10-19'));
 await assert.rejects(edit(buyer,{operation:'confirm_date'}),/Подтверждение/);
 await assert.rejects(edit(buyer,{action:'work',result:'date',date:'2026-10-19'}),/Подтверждение/);
 await d.prepare("UPDATE redemption_entries SET data=json_set(data,'$.dateConfirmedAt','2026-10-14T10:00:00Z')").run();
 await edit(buyer,{action:'work',result:'date',date:'2026-10-19'});
 assert.equal((await row()).dateConfirmation,'pending');assert.equal((await row()).dateConfirmedAt,null);
 await edit(buyer,{operation:'storage',date:'2026-10-15'});
 await edit(buyer,{action:'po',result:'date',date:'2026-10-25'});
 assert.equal((await row()).dateConfirmation,'pending');
 await edit(buyer,{operation:'confirm_date'});
 const confirmHistory=JSON.parse((await d.prepare("SELECT data FROM redemption_history WHERE json_extract(data,'$.changeKind')='confirm_date' ORDER BY id DESC LIMIT 1").first()).data);
 assert.equal(confirmHistory.dateConfirmedById,buyer.id);
 await d.prepare("UPDATE redemption_entries SET data='{}'").run();
 await d.prepare('UPDATE redemption_entries SET data=?').bind(JSON.stringify({action:'date',result:'date',resultDate:'2026-10-17',author:'Legacy'})).run();
 await syncRedemption(d,now);assert.equal((await row()).dateConfirmation,'pending');assert.equal((await row()).resultDate,'2026-10-17');assert.equal((await row()).author,'Legacy');
 const migratedVersion=(await row()).version;await syncRedemption(d,now);assert.equal((await row()).version,migratedVersion);
 await edit(admin,{operation:'confirm_date'});await syncRedemption(d,now);assert.equal((await row()).dateConfirmation,'confirmed');
 await d.prepare('UPDATE redemption_entries SET data=?').bind(JSON.stringify({action:'date',result:'date',resultDate:'2026-10-14',dateConfirmation:'pending',author:'Legacy'})).run();
 await assert.rejects(edit(admin,{operation:'confirm_date'}),/Подтверждение/);await syncRedemption(d,now);assert.equal((await row()).dateConfirmation,'expired');assert.equal((await row()).resultDate,'2026-10-14');assert(inWorkday(await row(),'2026-10-15'));assert(canSeeRedemption(op,await row(),false));
 await syncRedemption(d,now);assert.equal((await row()).dateConfirmation,'expired');
 await d.prepare('UPDATE orders SET data=?').bind(JSON.stringify({...order,cdekStatus:{code:'DELIVERED'}})).run();await syncRedemption(d,now);assert.equal((await row()).author,'API');assert.equal((await row()).result,'delivered');
 assert.equal(dayOf(new Date('2026-10-15T21:01:00Z')),'2026-10-16');assert(!closedTime(now));assert(closedTime(new Date('2026-10-15T16:50:00Z')));
 assert(!inWorkday({entered_at:'2026-10-15T21:01:00Z'},'2026-10-15'));
 const archiveCases=[
  ['confirmed',{action:'date',result:'date',resultDate:'2026-10-20',dateConfirmation:'confirmed',lastDay:'2026-10-16'}],
  ['retry',{action:'refusal',result:'date',resultDate:'2026-10-20',refusalRetryUsed:true,lastDay:'2026-10-16'}],
  ['confirmed-today',{action:'date',result:'date',resultDate:'2026-10-20',dateConfirmation:'confirmed',lastDay:'2026-10-15',updatedAt:'2026-10-16T10:00:00Z'}],
  ['returned',{result:'returned',lastDay:'2026-10-16'}],
  ['delivered',{result:'delivered',lastDay:'2026-10-16'}],
  ['to-return',{result:'to_return',lastDay:'2026-10-15'}],
  ['future-untouched',{action:'date',result:'date',resultDate:'2026-10-20',dateConfirmation:'confirmed',lastDay:'2026-10-15'}]
 ];
 for(const [id,value] of archiveCases){
  await d.prepare('INSERT INTO orders VALUES(?,?,?)').bind(id,'c',JSON.stringify({...order,id})).run();
  await d.prepare('INSERT OR REPLACE INTO redemption_entries(order_id,entered_at,data) VALUES(?,?,?)').bind(id,'2026-10-15T09:00:00Z',JSON.stringify(value)).run();
 }
 await archiveRedemption(d,new Date('2026-10-16T16:50:00Z'));
 const endOfDay=(await d.prepare("SELECT data FROM redemption_archives WHERE day='2026-10-16'").first()).data;
 const archived=JSON.parse(endOfDay);
 for(const [id,value] of archiveCases){const saved=archived.find(r=>r.order_id===id);if(id==='future-untouched')assert(!saved);else{assert(saved,id+' missing from archive');assert.equal(saved.result,value.result);assert.equal(saved.resultDate,value.resultDate);}}
 await d.prepare("UPDATE redemption_entries SET data='{}' WHERE order_id='confirmed'").run();
 await archiveRedemption(d,new Date('2026-10-16T17:00:00Z'));
 assert.equal((await d.prepare("SELECT data FROM redemption_archives WHERE day='2026-10-16'").first()).data,endOfDay);
 console.log('Redemption: enrollment, permissions, dates, rollover, immutable archive and API delivery passed');
}finally{d.close();}

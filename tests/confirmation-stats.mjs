import assert from 'node:assert/strict';
import {confirmationStats} from '../lib/confirmation-stats.ts';
const employees=[{id:'op',login:'op',role:'operator',department:'1'},{id:'other',login:'other',role:'operator',department:'2'}];
const author={id:'head',name:'Артем',role:'department_head',at:'2026-11-16T21:00:00Z'};
const order=(id,status,extra={})=>({id,manager:'op',delivery:'russian_post',status,packingWaybillAt:author.at,deliveryPackingAt:author.at,deliveryConfirmationAuthor:author,...extra});
const orders=[order('1','refused'),order('2','refused'),order('3','shipping'),order('4','redeemed'),order('5','redeemed')];
const state={employees,orders};
const stats=(actor={role:'admin'},from='2026-11-17',to=from)=>confirmationStats({...state,events:[...orders.filter(o=>o.packingWaybillAt).map(o=>({orderId:o.id,actorId:'admin',actor:'Администратор',at:new Date(Date.parse(o.packingWaybillAt)+1).toISOString(),text:'Проверка → Упаковка\nСтатус: Проверка → Упаковка'})),...(state.events||[])]},actor,from,to);
assert.deepEqual(stats().map(({label,confirmed,cancelled,sent,paid,waiting,returned})=>({label,confirmed,cancelled,sent,paid,waiting,returned})),[{label:'Артем',confirmed:5,cancelled:2,sent:1,paid:2,waiting:0,returned:0}]);
orders.push({...orders[0]},order('wait','rework'),order('return','returned'),order('test','redeemed',{testOnly:true}),order('old','shipping',{deliveryPackingAt:'2026-11-15T20:59:59Z',packingWaybillAt:'2026-11-15T20:59:59Z',deliveryConfirmationAuthor:{...author,at:'2026-11-16T20:59:59Z'}}));
assert.equal(stats()[0].confirmed,7);
assert.equal(stats()[0].waiting,1);assert.equal(stats()[0].returned,1);
assert.equal(stats({role:'department_head',department:'2'}).length,0);
assert.equal(confirmationStats(state,{role:'admin'},'','','2').length,0);
orders[2].deliveryPackingAt='2026-11-18T09:00:00Z';orders[2].deliveryConfirmationAuthor={...author,id:'second',name:'Другой',at:'2026-11-18T09:00:00Z'};
assert.equal(stats()[0].confirmed,6);assert.equal(stats(undefined,'2026-11-18')[0].label,'Другой');
orders[2].confirmationAuthor={id:'courier',name:'Курьер',role:'courier',at:'2026-11-19T09:00:00Z'};
assert.equal(stats(undefined,'2026-11-18')[0].label,'Другой');
orders.push(order('missing','refused',{deliveryConfirmationAuthor:undefined}),order('intermediate','check',{deliveryConfirmationAuthor:undefined,confirmationAuthor:author}));
assert.equal(stats()[0].confirmed,6);
console.log('Confirmation statistics: user example, last author, Moscow date, current outcomes, deduplication and permissions passed');

state.events=[{orderId:'missing',actorId:'head',actor:'Артем',at:author.at,text:'Доп. подтверждение → Упаковка\nСтатус: Доп. подтверждение → Упаковка'}];assert.equal(stats()[0].confirmed,7);
state.events.push({...state.events[0],actorId:'second',actor:'Другой',at:'2026-11-18T09:00:00Z'});assert.equal(stats()[0].confirmed,6);assert.equal(stats(undefined,'2026-11-18')[0].confirmed,2);

state.events.push({orderId:'intermediate',actorId:'head',actor:'Артем',at:author.at,text:'Комментарий: текст\nСтатус: Подтверждение → Упаковка'});assert.equal(stats()[0].confirmed,6);

const confirmedAt='2026-11-17T20:59:59Z',reviewedAt='2026-11-17T21:00:00Z';
const audit=(orderId,actorId,actor,at,transition)=>({orderId,actorId,actor,at,text:transition+'\nСтатус: '+transition});
const reviewed={employees,orders:[order('reviewed','redeemed',{deliveryConfirmationAuthor:{id:'admin',name:'Администратор',role:'admin',at:reviewedAt}})],events:[audit('reviewed','head','Артем',confirmedAt,'Подтверждение → Проверка'),audit('reviewed','admin','Администратор',reviewedAt,'Проверка → Упаковка')]};
const corrected=confirmationStats(reviewed,{role:'admin'},'2026-11-18','2026-11-18');
assert.equal(corrected[0].label,'Артем');assert.equal(corrected[0].paid,1);
assert.equal(confirmationStats(reviewed,{role:'admin'},'2026-11-17','2026-11-17').length,0,'The consent date must not replace the actual packing date');
reviewed.orders[0].deliveryConfirmationAuthor=undefined;
assert.equal(confirmationStats(reviewed,{role:'admin'},'','')[0].label,'Артем','Pre-feature history is corrected too');
reviewed.events.push(audit('reviewed','second','Другой','2026-11-19T09:00:00Z','Подтверждение → Проверка'),audit('reviewed','admin','Администратор','2026-11-19T10:00:00Z','Проверка → Упаковка'));
assert.equal(confirmationStats(reviewed,{role:'admin'},'','')[0].label,'Другой','The last consent author still wins');
reviewed.events=reviewed.events.filter(e=>e.actorId==='admin');
assert.equal(confirmationStats(reviewed,{role:'admin'},'','').length,0,'Review alone is not client consent');
console.log('Client consent: pre-admin author/date, historical mistaken admin markers, latest reconfirmation and missing evidence passed');

reviewed.events=[{orderId:'reviewed',actorId:'head',actor:'Артем',at:confirmedAt,text:'Подтверждено руководителем · Артем · замечания логиста исправлены: адрес · клиент согласен выкупить заказ\nСтатус: Возврат оператору → Проверка'},audit('reviewed','admin','Администратор',reviewedAt,'Проверка → Упаковка')];assert.equal(confirmationStats(reviewed,{role:'admin'},'','')[0].label,'Артем','Explicit head confirmation before admin check is preserved');

const pending={employees,orders:[order('pending','check',{packingWaybillAt:undefined,deliveryPackingAt:undefined})],events:[audit('pending','head','Артем',confirmedAt,'Подтверждение → Проверка')]};
assert.equal(confirmationStats(pending,{role:'admin'},'','').length,0,'Sending to admin is not yet a counted confirmation');
pending.orders[0].status='extra';
assert.equal(confirmationStats(pending,{role:'admin'},'','').length,0,'Admin extra confirmation must not be counted');
pending.events.push(audit('pending','logistic','Логист','2026-11-19T09:00:00Z','Доп. подтверждение → Упаковка'));
pending.orders[0].status='packing';pending.orders[0].deliveryConfirmationAuthor={id:'logistic',name:'Логист',role:'logistic',at:'2026-11-19T09:00:00Z'};
assert.equal(confirmationStats(pending,{role:'admin'},'','')[0].label,'Логист','The logistic who finally sends to packing receives credit');
pending.orders[0].status='refused';
assert.equal(confirmationStats(pending,{role:'admin'},'','')[0].cancelled,1,'Later cancellation retains the qualified confirmation');
pending.orders[0].status='check';pending.orders[0].deliveryConfirmationAuthor={...author,at:'2026-11-20T09:00:00Z'};
pending.events.push(audit('pending','head','Артем','2026-11-20T09:00:00Z','Подтверждение → Проверка'));
assert.equal(confirmationStats(pending,{role:'admin'},'','')[0].label,'Логист','An unfinished later review cannot take over an already qualified confirmation');
console.log('Packing eligibility: pending admin/extra excluded, final logistic credited, later outcomes and completed cohort preserved');

for(const delivery of ['cdek_pickup','cdek_courier','russian_post','moscow_courier']){const sample={employees,orders:[order('unpacked','extra',{delivery,deliveryPackingAt:undefined})]};assert.equal(confirmationStats(sample,{role:'admin'},'','').length,0,'A waybill alone must not prove packing');sample.orders[0].status='packing';sample.orders[0].deliveryPackingAt=author.at;assert.equal(confirmationStats(sample,{role:'admin'},'','')[0].id,'head');}

const dates={employees,orders:[order('date','redeemed',{deliveryPackingAt:undefined,shippedAt:'2026-11-22T09:00:00Z',redeemedAt:'2026-11-25T09:00:00Z'})],events:[audit('date','head','Артем',confirmedAt,'Подтверждение → Проверка'),audit('date','admin','Администратор',reviewedAt,'Проверка → Упаковка')]};
assert.equal(confirmationStats(dates,{role:'admin'},'2026-11-17','2026-11-17').length,0);
assert.equal(confirmationStats(dates,{role:'admin'},'2026-11-18','2026-11-18')[0].id,'head');
assert.equal(confirmationStats(dates,{role:'admin'},'2026-11-22','2026-11-22').length,0,'Shipping must not replace packing date');
dates.events=[];assert.equal(confirmationStats(dates,{role:'admin'},'','').length,0,'An unknown packing date must not be guessed from consent or shipping');
dates.orders[0].deliveryPackingAt=reviewedAt;
assert.equal(confirmationStats(dates,{role:'admin'},'2026-11-18','2026-11-18')[0].id,'head','Persisted packing date works without loaded history');
console.log('Packing date: Moscow midnight, original author, later shipping/buyout and unknown historical dates passed');

const physical={employees,orders:[order('physical','packing',{delivery:'moscow_courier',shippedAt:undefined,courier:{acceptedAt:'2026-11-18T09:00:00Z'}})]};
assert.equal(confirmationStats(physical,{role:'admin'},'','')[0].sent,1);
physical.orders[0].status='refused';assert.equal(confirmationStats(physical,{role:'admin'},'','')[0].cancelled,1);
physical.orders[0].status='returned';assert.equal(confirmationStats(physical,{role:'admin'},'','')[0].cancelled,0);assert.equal(confirmationStats(physical,{role:'admin'},'','')[0].returned,1);

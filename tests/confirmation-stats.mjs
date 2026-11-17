import assert from 'node:assert/strict';
import {confirmationStats} from '../lib/confirmation-stats.ts';
const employees=[{id:'op',login:'op',role:'operator',department:'1'},{id:'other',login:'other',role:'operator',department:'2'}];
const author={id:'head',name:'Артем',role:'department_head',at:'2026-11-16T21:00:00Z'};
const order=(id,status,extra={})=>({id,manager:'op',delivery:'russian_post',status,deliveryConfirmationAuthor:author,...extra});
const orders=[order('1','refused'),order('2','refused'),order('3','shipping'),order('4','redeemed'),order('5','redeemed')];
const state={employees,orders};
const stats=(actor={role:'admin'},from='2026-11-17',to=from)=>confirmationStats(state,actor,from,to);
assert.deepEqual(stats().map(({label,confirmed,cancelled,sent,paid,waiting,returned})=>({label,confirmed,cancelled,sent,paid,waiting,returned})),[{label:'Артем',confirmed:5,cancelled:2,sent:1,paid:2,waiting:0,returned:0}]);
orders.push({...orders[0]},order('wait','rework'),order('return','returned'),order('test','redeemed',{testOnly:true}),order('old','shipping',{deliveryConfirmationAuthor:{...author,at:'2026-11-16T20:59:59Z'}}));
assert.equal(stats()[0].confirmed,7);
assert.equal(stats()[0].waiting,1);assert.equal(stats()[0].returned,1);
assert.equal(stats({role:'department_head',department:'2'}).length,0);
assert.equal(confirmationStats(state,{role:'admin'},'','','2').length,0);
orders[2].deliveryConfirmationAuthor={...author,id:'second',name:'Другой',at:'2026-11-18T09:00:00Z'};
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
const corrected=confirmationStats(reviewed,{role:'admin'},'2026-11-17','2026-11-17');
assert.equal(corrected[0].label,'Артем');assert.equal(corrected[0].paid,1);
assert.equal(confirmationStats(reviewed,{role:'admin'},'2026-11-18','2026-11-18').length,0,'Admin review must not move the confirmation date');
reviewed.orders[0].deliveryConfirmationAuthor=undefined;
assert.equal(confirmationStats(reviewed,{role:'admin'},'','')[0].label,'Артем','Pre-feature history is corrected too');
reviewed.events.push(audit('reviewed','second','Другой','2026-11-19T09:00:00Z','Подтверждение → Проверка'),audit('reviewed','admin','Администратор','2026-11-19T10:00:00Z','Проверка → Упаковка'));
assert.equal(confirmationStats(reviewed,{role:'admin'},'','')[0].label,'Другой','The last consent author still wins');
reviewed.events=reviewed.events.filter(e=>e.actorId==='admin');
assert.equal(confirmationStats(reviewed,{role:'admin'},'','').length,0,'Review alone is not client consent');
console.log('Client consent: pre-admin author/date, historical mistaken admin markers, latest reconfirmation and missing evidence passed');

reviewed.events=[{orderId:'reviewed',actorId:'head',actor:'Артем',at:confirmedAt,text:'Подтверждено руководителем · Артем · замечания логиста исправлены: адрес · клиент согласен выкупить заказ\nСтатус: Возврат оператору → Проверка'},audit('reviewed','admin','Администратор',reviewedAt,'Проверка → Упаковка')];assert.equal(confirmationStats(reviewed,{role:'admin'},'','')[0].label,'Артем','Explicit head confirmation before admin check is preserved');

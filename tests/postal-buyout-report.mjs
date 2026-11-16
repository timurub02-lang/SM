import assert from 'node:assert/strict';
import {reportPostalBuyout,resolvePostalBuyout,postalBuyoutPending,mayReportPostalBuyout} from '../lib/postal-buyout-report.ts';
import {authorizeCrm} from '../lib/permissions.ts';
import {employeeTasks} from '../lib/reminder-tasks.ts';
import {filteredOrderList} from '../lib/crm-order-list.ts';
const op={id:'op',role:'operator',department:'d',name:'Оператор'},head={id:'head',role:'department_head',department:'d',name:'РК'},other={id:'other',role:'department_head',department:'x'},log={id:'log',role:'logistic',name:'Логист'};
const staff=[op,head,other,log,{id:'log2',role:'chief_logistic'}],at='2026-11-16T10:00:00Z';
const order={id:'post',clientId:'c',manager:'op',delivery:'russian_post',status:'shipping',createdAt:at,updatedAt:at,items:[],version:1};
const state={orders:[order],clients:[{id:'c',name:'Клиент',owner:'op',phone:'',city:''}],employees:staff,events:[],settings:{},incoming:[]};
for(const e of [op,head]){assert.ok(mayReportPostalBuyout(order,e,staff));assert.doesNotThrow(()=>authorizeCrm(e,{action:'reportPostalBuyout',id:'post'},state));}
for(const e of [other,{...op,id:'foreign'},log,{id:'courier',role:'courier'}]){assert.equal(mayReportPostalBuyout(order,e,staff),false);assert.throws(()=>reportPostalBuyout(order,e,staff,at,'r'));assert.throws(()=>authorizeCrm(e,{action:'reportPostalBuyout',id:'post'},state));}
for(const changed of [{delivery:'cdek_pickup'},{status:'packing'},{status:'redeemed'}])assert.throws(()=>reportPostalBuyout({...order,...changed},op,staff,at,'r'));
const pending={...order,...reportPostalBuyout(order,head,staff,at,'r')};assert.equal(pending.status,'shipping');assert.ok(postalBuyoutPending(pending));assert.throws(()=>reportPostalBuyout(pending,op,staff,at,'r2'));
const withPending={...state,orders:[pending]};
for(const e of [log,staff[4]])assert.equal(employeeTasks(withPending,e).filter(t=>t.id.includes('postal-buyout:r')).length,1);
assert.equal(employeeTasks(withPending,{id:'admin',role:'admin'}).length,0);
assert.throws(()=>resolvePostalBuyout(pending,op,at,'sent'));
for(const result of ['paid','returned','sent']){
 const resolved={...pending,...resolvePostalBuyout(pending,log,at,result),status:result==='paid'?'redeemed':result==='returned'?'returned':'shipping'};
 assert.equal(postalBuyoutPending(resolved),false);assert.equal(employeeTasks({...state,orders:[resolved]},staff[4]).some(t=>t.id.includes('postal-buyout')),false);
 if(result==='sent'){assert.equal(resolved.status,'shipping');assert.equal(reportPostalBuyout(resolved,op,staff,at,'r2').postalBuyoutReport.id,'r2');}
}
const older={...pending,createdAt:'2025-01-01T00:00:00Z',updatedAt:'2025-01-01T00:00:00Z'},newer={...order,id:'new',createdAt:'2026-11-17T10:00:00Z',updatedAt:'2026-11-17T10:00:00Z'};
for(const direction of ['asc','desc'])assert.deepEqual(filteredOrderList({...state,orders:[newer,older]},log,{view:'post',filter:'exported',query:'',showNextPremium:false,sort:'id',direction}).map(o=>o.id),['post','new']);
console.log('Postal buyout: roles, scope, duplicate, statuses, shared tasks, resolution, re-report, list priority passed');

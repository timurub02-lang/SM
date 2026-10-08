import assert from 'node:assert/strict';
import {allowedOrderTransitions,orderEditingLocked,scheduledCalls,callAuthor} from '../lib/crm.ts';
import {authorizeCrm} from '../lib/permissions.ts';
import {departmentWorkStage,headOrderMarks,usesOrderLease} from '../lib/department-orders.ts';
import {applyCourierCommand,courierLabel} from '../lib/courier.ts';
import {defaultOrderPolicy} from '../lib/order-policy.ts';
import {employeeTasks} from '../lib/reminder-tasks.ts';
const at=new Date().toISOString(),due=new Date(Date.now()+3600000).toISOString();
const operator={id:'op',role:'operator',department:'1'},head={id:'head',role:'department_head',department:'1',name:'Руководитель'},foreign={...head,id:'foreign',department:'2'},logistic={id:'log',role:'logistic'};
const employees=[operator,head,foreign,logistic],base={id:'order',clientId:'client',manager:'op',status:'confirm',delivery:'cdek_pickup',contact:'none',due:'',round:1,extra:false,createdAt:at,updatedAt:at,items:[]};
const state=o=>({orders:[o],clients:[{id:'client',name:'Клиент'}],employees,settings:{},events:[]});
for(const [delivery,next] of [['cdek_pickup','check'],['cdek_courier','check'],['moscow_courier','packing'],['russian_post','extra']]){
 const o={...base,delivery};assert(allowedOrderTransitions(o,head.role).includes(next));assert(allowedOrderTransitions(o,head.role).includes('refused'));
 assert.doesNotThrow(()=>authorizeCrm(head,{action:'transition',id:o.id,to:next},state(o)));
 assert.throws(()=>authorizeCrm(foreign,{action:'transition',id:o.id,to:next},state(o)),/Недостаточно/);
}
for(const status of ['draft','check','packing','phone','shipping','pickup','redeemed','returned','refused']){
 const o={...base,status};assert.equal(departmentWorkStage(o),false);assert.equal(orderEditingLocked(head,o),true);assert.deepEqual(allowedOrderTransitions(o,head.role),[]);
 assert.throws(()=>authorizeCrm(head,{action:'transition',id:o.id,to:'refused'},state(o)),/Недостаточно/);
}
for(const status of ['confirm','extra','rework']){
 const o={...base,status};assert.equal(orderEditingLocked(head,o),false);assert.equal(usesOrderLease(head,o),true);
 assert.throws(()=>authorizeCrm(head,{action:'updateOrder',id:o.id},state(o)),/Недостаточно/);
 for(const action of ['contact','comment','transition'])assert.doesNotThrow(()=>authorizeCrm(head,{action,id:o.id},state(o)));
 assert.equal(employeeTasks(state(o),head).length,1);
}
const call={...base,contact:'callback',due,contactAuthor:{...head,at}};
assert.equal(scheduledCalls([call],head,employees).length,1);assert.equal(scheduledCalls([call],foreign,employees).length,0);
assert.equal(employeeTasks(state(call),head)[0].kind,'call');assert.match(callAuthor(call,employees),/Руководитель/);
assert.equal(headOrderMarks(call)[0].text,'Перезвон руководителем');
assert.equal(headOrderMarks({...call,contact:'missed'})[0].text,'Недозвон руководителем');
assert.equal(headOrderMarks({...base,confirmationAuthor:{...head,at}})[0].text,'Подтверждено руководителем');
assert.equal(headOrderMarks({...base,status:'refused',cancellationAuthor:{...head,at}})[0].text,'Отменено руководителем');
const c={id:'courier',name:'Курьер',assignedAt:at,acceptedAt:at,phase:'confirmation',amount:100,workStartedAt:at,workHours:48};
const courierOrder={...base,delivery:'moscow_courier',status:'packing',courier:c};
assert.throws(()=>applyCourierCommand(courierOrder,{action:'courierWorkflow',operation:'confirm'},head,defaultOrderPolicy,at,employees));
assert.equal(usesOrderLease(head,courierOrder),false);assert.equal(employeeTasks(state(courierOrder),head).length,0);
const returned={...courierOrder,status:'rework',reworkDeadline:due,courier:{...c,phase:'operator',operatorStartedAt:at,operatorBudgetMs:3600000}};
const nextAt=new Date(Date.parse(at)+60000).toISOString();
const result=applyCourierCommand(returned,{action:'courierWorkflow',operation:'confirm'},head,defaultOrderPolicy,nextAt,employees);
assert.equal(result.order.status,'shipping');assert.equal(result.order.courier.phase,'resume');assert.equal(result.order.courier.confirmedBy,'department_head');
assert.equal(result.order.courier.operatorBudgetMs,3540000);assert.equal(result.order.courier.acceptedAt,c.acceptedAt);assert.equal(result.order.courier.amount,100);
assert.match(courierLabel(result.order),/Подтверждено руководителем/);
assert.throws(()=>applyCourierCommand(returned,{action:'courierWorkflow',operation:'confirm'},foreign,defaultOrderPolicy,nextAt,employees));
assert.deepEqual(allowedOrderTransitions(returned,head.role),['refused']);
assert.equal(usesOrderLease(operator,{...base,status:'rework'}),true);assert.equal(usesOrderLease(operator,base),false);
console.log('Department heads: scope, routes, cancellation boundaries, calls, labels, tasks, shared leases and unchanged courier confirmation/budget passed');

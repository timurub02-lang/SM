import assert from 'node:assert/strict';
import {buildWorkspaceSummary,buildClientWorkCounts} from '../lib/crm-workspace-summary.ts';
import {assignedClients,departmentOrders,orderGroup,reworkStage,scheduledCalls} from '../lib/crm.ts';
import {filteredClientList} from '../lib/crm-client-list.ts';
import {orderDisplayGroups,orderDisplayGroup,showOrderInList} from '../lib/order-premium-stage.ts';
import {defaultOrderPolicy} from '../lib/order-policy.ts';
import {eligibleForRedemption} from '../lib/redemption-priority.ts';
const now=Date.parse('2026-11-12T20:59:59.999Z');
const staff=[{id:'a',role:'operator',department:'1'},{id:'b',role:'operator',department:'2'},{id:'head',role:'department_head',department:'1'},{id:'empty',role:'department_head',department:''}];
const statuses=['draft','rework','confirm','extra','check','packing','phone','shipping','pickup','redeemed','returned','refused'];
const state={clients:[],orders:[],employees:staff,events:[],settings:{retentionDays:30,orderPolicy:defaultOrderPolicy},redemptionStatuses:['DELIVERED'],premiumNextPeriod:'next',incoming:[{id:'i',closedAt:null,spam:false},{id:'closed',closedAt:'yes'},{id:'spam',spam:true}],clientWork:[],clientReminders:[],retentionPreview:{}};
for(let i=0;i<48;i++){
 const id='c-'+i,owner=i<36?'a':'b';
 const client={id,owner,name:'Client '+i,phone:'+7999'+i,city:'Москва',source:'Fixture',createdAt:new Date(now-100000).toISOString(),assignedUntil:new Date(now+5*86400000).toISOString(),version:1};state.clients.push(client);
 const order={id:'o-'+i,clientId:id,manager:owner,status:statuses[i%statuses.length],delivery:'cdek_pickup',cdekStatus:{code:'DELIVERED'},items:[],contact:i%3===0?'callback':'none',due:new Date(now+1).toISOString(),reworkDeadline:new Date(now+defaultOrderPolicy.reworkWarningHours*3600000+1).toISOString(),createdAt:client.createdAt,updatedAt:client.createdAt,version:1};
 if(i===9)order.premiumStage={status:'paid',periodId:'paid'};
 if(i===21){order.premiumStage={status:'accrued',periodId:'active'};order.premiumNextPeriod='next';}
 if(i===33)order.legacyLv={paymentPendingReview:true};
 state.orders.push(order);
}
// Unassigned payroll history must not reappear in the operational order counts.
state.clients[9].owner='';state.clients[11].owner='';
// Foreign manager on an owned client: own-client attention and own-order tabs differ deliberately.
state.orders.push({...state.orders[1],id:'cross',clientId:'c-0',manager:'b'});
state.clients.push({id:'expires',owner:'a',name:'Deadline',phone:'deadline',city:'',source:'Fixture',createdAt:new Date(now-86400000).toISOString(),assignedUntil:new Date(now+3*86400000+1).toISOString()});
state.clients.push({id:'worked',owner:'a',name:'Worked',phone:'worked',city:'',source:'Fixture',createdAt:new Date(now-86400000).toISOString(),assignedUntil:''});
state.clients.push({id:'planned',owner:'a',name:'Planned',phone:'planned',city:'',source:'Fixture',createdAt:new Date(now-86400000).toISOString(),assignedUntil:''});
state.clientWork.push({clientId:'worked',outcome:'reached',at:'2026-11-12T09:00:00.000Z',version:1});
state.clientReminders.push({id:'r',clientId:'planned',due:new Date(now+1).toISOString(),createdAt:'2026-11-12T09:00:00.000Z'});
state.retentionPreview['c-21']={until:new Date(now+3*86400000+1).toISOString()};
const original=JSON.stringify(state);let comparisons=0;
for(const at of [now,now+2,now+86400000])for(const employee of staff){
 const summary=buildWorkspaceSummary(state,employee,at),mine=assignedClients(state.clients,staff,employee),mineIds=new Set(mine.map(c=>c.id));
 for(const [key,filter] of [['all','all'],['withoutOrders','without_orders'],['inTransit','in_transit'],['expires','expires']]){
  assert.equal(summary.mine[key],filteredClientList(state,employee,{filter,query:'',clientWorkFilter:'all',timeZone:'Europe/Moscow'},at).length);comparisons++;
 }
 assert.equal(summary.mine.reworkOrders,state.orders.filter(o=>mineIds.has(o.clientId)&&o.status==='rework').length);
 assert.equal(summary.mine.scheduledCalls,scheduledCalls(state.orders,employee,staff).filter(o=>mineIds.has(o.clientId)).length);
 const scoped=employee.role==='operator'?state.orders.filter(o=>o.manager===employee.id):departmentOrders(state.orders,staff,employee),clients=new Map(state.clients.map(c=>[c.id,c]));
 const visible=scoped.filter(o=>showOrderInList(o,clients.get(o.clientId),employee.role)&&clients.has(o.clientId));
 assert.equal(summary.orders.all,visible.length);
 for(const group of orderDisplayGroups){assert.equal(summary.orders.groups[group.id],visible.filter(o=>orderDisplayGroup(o).id===group.id).length);comparisons++;}
 assert.equal(summary.orders.eligibleSent,visible.filter(o=>orderGroup(o).id==='sent'&&eligibleForRedemption(o,state.redemptionStatuses)).length);
 for(const tab of ['new','expiring','callback','missed','extra_new','extra_expiring','extra_callback','extra_missed']){assert.equal(summary.rework[tab]||0,scoped.filter(o=>o.status==='rework'&&reworkStage(o,at,state.settings.orderPolicy)===tab).length);comparisons++;}
 assert.equal(summary.nav.incoming,1);
}
for(const at of [now,now+2])for(const filter of ['all','without_orders','today','expires'])for(const query of ['','Client','Planned'])for(const timeZone of ['Europe/Moscow','Asia/Yekaterinburg']){
 const params={filter,query,timeZone,clientWorkFilter:'all'},counts=buildClientWorkCounts(state,staff[0],params,at);
 // Search intentionally ignores work filters; the badges still describe the matching candidates.
 const candidates=query?{...state,clients:filteredClientList(state,staff[0],params,at)}:state,reference=query?{...params,filter:'all',query:''}:params;
 for(const group of ['all','needed','planned','done']){assert.equal(counts[group],filteredClientList(candidates,staff[0],{...reference,clientWorkFilter:group},at).length);comparisons++;}
}
assert.equal(buildWorkspaceSummary(state,staff[0],now+2).mine.expires-buildWorkspaceSummary(state,staff[0],now).mine.expires,2,'client and prepared-preview deadlines advance without a source write');
assert.ok((buildWorkspaceSummary(state,staff[0],now+2).rework.expiring||0)>(buildWorkspaceSummary(state,staff[0],now).rework.expiring||0),'rework warning boundary advances');
assert.equal(buildClientWorkCounts(state,staff[0],{filter:'all',query:'Worked',clientWorkFilter:'all'},now).done,1);
assert.equal(buildClientWorkCounts(state,staff[0],{filter:'all',query:'Worked',clientWorkFilter:'all'},now+2).needed,1,'Moscow midnight resets worked-today without a DB write');
assert.equal(buildClientWorkCounts(state,staff[0],{filter:'all',query:'Planned',clientWorkFilter:'all'},now).planned,1);
assert.equal(buildClientWorkCounts(state,staff[0],{filter:'all',query:'Planned',clientWorkFilter:'all'},now+2).needed,1,'reminder becomes due without a DB write');
assert.equal(JSON.stringify(state),original,'summary calculation never changes source entities');
 assert.deepEqual(buildWorkspaceSummary(state,staff[0],now).work,buildClientWorkCounts(state,staff[0],{filter:'all',query:'',clientWorkFilter:'all'},now));
 assert.notEqual(buildWorkspaceSummary(state,staff[0],now).listRevision,buildWorkspaceSummary(state,staff[0],now+2).listRevision,'deadline/midnight signals list refresh without a source write');
 const swapped=structuredClone(state);[swapped.clients[0].createdAt,swapped.clients[1].createdAt]=['2026-11-01T00:00:00Z',new Date(now).toISOString()];
 const other=structuredClone(swapped);[other.clients[0].createdAt,other.clients[1].createdAt]=[other.clients[1].createdAt,other.clients[0].createdAt];
 const first=buildWorkspaceSummary(swapped,staff[0],now),second=buildWorkspaceSummary(other,staff[0],now);assert.deepEqual(first.mine,second.mine);assert.deepEqual(first.work,second.work);assert.notEqual(first.listRevision,second.listRevision,'equal counters do not hide membership changes');
console.log(`${comparisons} workspace summary parity comparisons; roles, hidden payroll history, foreign-manager ownership, retention/rework boundaries, Moscow midnight and client work passed`);

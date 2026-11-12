import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {draftDeadline} from '../lib/crm.ts';
import {courierDoorNoticeId,courierDeadline} from '../lib/courier.ts';
const built=await build({entryPoints:['lib/reminders.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'test-db',setup(api){api.onResolve({filter:/^\.\/db$/},()=>({path:'db',namespace:'test'}));api.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function db(){return globalThis.__employeeReminderDb;}'}));}}]});
const {resolveEmployeeReminders,employeeReminders}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const wallClock=Date.now,now=Date.parse('2026-11-12T12:00:00Z');Date.now=()=>now;
try{
 const op={id:'op',role:'operator',department:'1'},other={id:'other',role:'operator',department:'2'},head={id:'head',role:'department_head',department:'1'},admin={id:'admin',role:'admin'},courier={id:'courier',role:'courier'};
 const own={id:'own',clientId:'c',manager:'op',status:'draft',createdAt:new Date(now-1000).toISOString(),contact:'callback',due:new Date(now+60000).toISOString(),cancellationRequest:{id:'cancel',status:'pending'}};
 const door={...own,id:'door',status:'rework',delivery:'moscow_courier',courier:{id:'courier',phase:'operator',doorRefusal:{at:new Date(now-1000).toISOString(),claimDueAt:new Date(now+1000).toISOString(),decisionDueAt:new Date(now+10000).toISOString()}}};
 const delivery={...own,id:'delivery',status:'pickup',delivery:'moscow_courier',courier:{id:'courier',phase:'delivery',acceptedAt:own.createdAt,confirmedAt:own.createdAt,postponement:{state:'approved',at:own.due}}};
 const state={clients:[{id:'c',owner:'op'},{id:'foreign',owner:'other'}],orders:[own,door,delivery,{...own,id:'foreign',clientId:'foreign',manager:'other'}],employees:[op,other,head,admin,courier],settings:{},events:[]};
 const values=[{id:'draft',kind:'draft',orderId:'own',due:draftDeadline(own)},{id:'old-draft',kind:'draft',orderId:'own',due:'old'},{id:'cancel:cancel:pending',kind:'order-cancellation',orderId:'own'},{id:'cancel:old:pending',kind:'order-cancellation',orderId:'own'},{id:`call:own:${own.due}`,orderId:'own'},{id:'call:old',orderId:'own'},{id:courierDoorNoticeId(door),kind:'courier-door',orderId:'door'},{id:'old-door',kind:'courier-door',orderId:'door'},{id:'delivery',kind:'courier-delivery',orderId:'delivery',due:own.due},{id:'warning',kind:'courier-warning',orderId:'delivery',due:courierDeadline(delivery)},{id:'foreign',orderId:'foreign'},{id:'missing',orderId:'missing'},{id:'client-only'},{id:'receipt',kind:'courier-receipt',orderId:'missing'},{id:'deletion',kind:'cdek-deletion',orderId:'own'}];
 const rows=values.map(v=>({data:JSON.stringify({clientId:'c',title:'Test',text:'Test',at:own.createdAt,...v}),read_at:v.id==='draft'?own.createdAt:null}));
 // Fail if indexed resolution regresses to per-reminder linear source searches.
 state.orders.find=()=>{throw Error('Repeated order lookup');};state.clients.find=()=>{throw Error('Repeated client lookup');};
 const result=resolveEmployeeReminders(state,op,rows),byId=new Map(result.map(r=>[r.id,r]));
 assert.deepEqual(result.map(r=>r.id),values.slice(0,10).map(v=>v.id).concat('client-only'));
 for(const id of ['draft','cancel:cancel:pending',`call:own:${own.due}`,courierDoorNoticeId(door),'delivery','warning'])assert.equal(byId.get(id).resolved,false,id);
 for(const id of ['old-draft','cancel:old:pending','call:old','old-door'])assert.equal(byId.get(id).resolved,true,id);
 assert.equal(byId.get('draft').readAt,own.createdAt);assert.equal(byId.get('old-draft').text,'Напоминание больше не актуально');
 assert.deepEqual(resolveEmployeeReminders(state,head,rows).map(r=>r.id),result.map(r=>r.id));
 assert.ok(resolveEmployeeReminders(state,admin,rows).some(r=>r.id==='deletion'));assert.ok(resolveEmployeeReminders(state,courier,rows).some(r=>r.id==='receipt'));
 assert.ok(!resolveEmployeeReminders(state,other,rows).some(r=>r.id==='client-only'));
 globalThis.__employeeReminderDb={prepare:()=>({bind:()=>({all:async()=>({results:rows})})})};assert.deepEqual(await employeeReminders(state,op),result);
 console.log('Employee reminders: indexed lookups preserve ownership, department rights, receipts, cancellation/calls/drafts/courier resolution, order and read state');
}finally{Date.now=wallClock;delete globalThis.__employeeReminderDb;}

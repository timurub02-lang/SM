import assert from 'node:assert/strict';
import {logisticCallsDue} from '../lib/crm.ts';
const now=Date.parse('2026-09-29T12:00:00Z');
const order={id:'due',logistic:'log',status:'confirm',contact:'callback',due:new Date(now).toISOString()};
assert.equal(logisticCallsDue([order],'log',now-1).length,0);
assert.equal(logisticCallsDue([order],'log',now).length,1);
assert.equal(logisticCallsDue([order],'other',now).length,1);
for(const patch of [{status:'rework'},{status:'check'},{contact:'none'},{due:''},{due:'invalid'}])assert.equal(logisticCallsDue([{...order,...patch}],'log',now).length,0);
assert.equal(logisticCallsDue([{...order,status:'extra',contact:'missed'}],'log',now).length,1);
console.log('Scheduled call reminders passed');
const {scheduledCalls}=await import('../lib/crm.ts');
const op={id:'op',role:'operator'};
const future={...order,id:'future',manager:'op',status:'rework',due:new Date(now+60000).toISOString()};
const past={...future,id:'past',contact:'missed',due:new Date(now-60000).toISOString()};
assert.deepEqual(scheduledCalls([future,past],op).map(o=>o.id),['past','future']);
assert.equal(scheduledCalls([{...future,status:'confirm'}],op).length,0);
assert.equal(scheduledCalls([future],{...op,id:'other'}).length,0);
assert.equal(scheduledCalls([{...future,due:''}],op).length,0);
assert.equal(scheduledCalls([{...future,status:'draft'}],op).length,1);
assert.equal(scheduledCalls([order],{id:'log',role:'logistic'}).length,1);
console.log('Operator and logistic reminder lists passed');

for(const delivery of ['cdek_pickup','cdek_courier','moscow_courier','russian_post'])
 for(const status of ['confirm','extra','pickup'])
  for(const role of ['logistic','chief_logistic'])
   assert.equal(scheduledCalls([{...order,delivery,status}],{id:'other',role}).length,1);
for(const role of ['admin','department_head','courier'])
 assert.equal(scheduledCalls([order],{id:'other',role}).length,0);
const {callAuthor}=await import('../lib/crm.ts');
assert.equal(callAuthor(order,[{id:'log',name:'Legacy logistic'}]),'Legacy logistic');
assert.equal(callAuthor({...order,contactAuthor:{id:'deleted',name:'Original author'}},[]),'Original author');
console.log('Shared logistics calls across delivery methods, role isolation and author attribution passed');

import assert from 'node:assert/strict';
import {canOperatorReachClient,operatorCallBlocked,markClientWaiting,confirmationStage} from '../lib/crm.ts';
import {authorizeCrm} from '../lib/permissions.ts';
const e={id:'op',role:'operator',name:'Оператор'};
const now='2026-10-21T12:00:00Z';
const o={id:'order',manager:e.id,clientId:'client',status:'confirm',contact:'missed',due:'2026-10-21T13:00:00Z',version:1,confirmationStartedAt:now,confirmationHours:48};
assert.equal(canOperatorReachClient(e,o),true);
for(const contact of ['none','callback']){
 assert.equal(operatorCallBlocked(e,{...o,contact}),true);
 assert.throws(()=>markClientWaiting(e,{...o,contact},now));
}
assert.equal(canOperatorReachClient({...e,id:'other'},o),false);
assert.equal(canOperatorReachClient({...e,role:'logistic'},o),false);
assert.equal(canOperatorReachClient(e,{...o,courier:{id:'courier'}}),false);
const next=markClientWaiting(e,o,now);
assert.equal(next.contact,'none');assert.equal(next.due,'');assert.equal(next.clientWaiting.by,e.id);
assert.equal(next.confirmationStartedAt,o.confirmationStartedAt);assert.equal(next.confirmationHours,48);
assert.equal(confirmationStage(next,Date.parse(now)+47*3600000),'new');
assert.equal(confirmationStage({...next,status:'extra'}),'repeat');
assert.equal(operatorCallBlocked(e,next),true);
assert.equal(operatorCallBlocked(e,{...o,status:'draft'}),false);
assert.equal(operatorCallBlocked({...e,role:'logistic'},next),false);
const state={employees:[e],clients:[{id:'client',owner:e.id}],orders:[o]};
assert.doesNotThrow(()=>authorizeCrm(e,{action:'clientWaiting',id:o.id},state));
assert.throws(()=>authorizeCrm(e,{action:'updateOrder',id:o.id},state));
assert.throws(()=>authorizeCrm(e,{action:'clientWaiting',id:o.id},{...state,orders:[{...o,contact:'callback'}]}));
console.log('Client waiting permissions, routing and unchanged deadline passed');

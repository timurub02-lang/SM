import assert from 'node:assert/strict';
import {applyRetention,clientAssignment} from '../lib/crm.ts';
import {clientRetentionLabel,clientRetentionExpiring} from '../lib/client-retention-label.ts';
const now=Date.parse('2030-01-01'),c={id:'permanent',name:'Тест',owner:'operator',permanentOwner:'operator',sheet:'К',source:'',assignedUntil:'2020-01-01',trialUntil:'2020-01-01',assignmentStartedAt:'2019-01-01'};
for(const orders of [[],...['refused','returned','redeemed'].map(status=>[{clientId:c.id,manager:c.owner,status,createdAt:'2019-01-01',redeemedAt:'2019-01-02'}])]){
 const next=applyRetention(c,orders,now,0,true);
 assert.equal(next.owner,c.owner);assert.equal(next.assignedUntil,'');assert.equal(next.trialUntil,undefined);
 assert.equal(clientRetentionLabel(next,orders,now),'Без срока открепления · исключение');
 assert.equal(clientRetentionExpiring(next,false,now,{expired:true}),false);
}
assert.equal(applyRetention({...c,permanentOwner:'other'},[],now).owner,'');
assert.equal(applyRetention({...c,owner:''},[],now).owner,'');
for(const owner of ['','new'])assert.equal(clientAssignment(c,owner,new Date(now).toISOString()).permanentOwner,undefined);
assert.deepEqual(clientAssignment(c,c.owner,new Date(now).toISOString()),{});
console.log('Permanent owner: timers, expired purchases, label, owner change passed');

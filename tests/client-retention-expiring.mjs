import assert from 'node:assert/strict';
import {clientRetentionExpiring as expiring} from '../lib/client-retention-label.ts';
const now=Date.parse('2026-11-11T12:00:00Z'),c={id:'c',owner:'op',assignedUntil:''};
const at=days=>new Date(now+days*86400000).toISOString();
for(const days of [-2,0,1,3]){
 assert.equal(expiring({...c,assignedUntil:at(days)},false,now),true);
 assert.equal(expiring(c,false,now,{until:at(days)}),true);
}
assert.equal(expiring(c,false,now,{expiresAfterPremium:true}),true);
assert.equal(expiring(c,false,now,{until:at(3)+''}),true);
assert.equal(expiring(c,false,now,{until:new Date(now+3*86400000+1).toISOString()}),false);
assert.equal(expiring({...c,assignedUntil:at(4)},false,now),false);
assert.equal(expiring(c,false,now,{}),false);
assert.equal(expiring(c,false,now,{until:'invalid'}),false);
assert.equal(expiring(c,true,now,{expiresAfterPremium:true}),false);
assert.equal(expiring({...c,owner:''},false,now,{expiresAfterPremium:true}),false);
assert.equal(expiring({...c,assignedUntil:at(1)},true,now),false);
console.log('Soon-expiring filter: ordinary and premium-held deadlines, expired, 3-day boundary, active/free/unknown excluded');

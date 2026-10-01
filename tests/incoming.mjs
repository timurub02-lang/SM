import assert from 'node:assert/strict';
import {visibleIncoming} from '../lib/crm.ts';
const clients=[{id:'a',owner:'one'},{id:'b',owner:'two'},{id:'c',owner:''}];
const requests=clients.map(c=>({clientId:c.id}));
assert.deepEqual(visibleIncoming(requests,clients,{id:'one',role:'operator'}),[requests[0]]);
for(const role of ['admin','department_head'])assert.equal(visibleIncoming(requests,clients,{role,department:'1'}).length,3);
assert.equal(visibleIncoming(requests,clients,{role:'logistic'}).length,0);
console.log('Incoming role visibility passed');

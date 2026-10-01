import assert from 'node:assert/strict';
import {applyRetention,clientAssignment} from '../lib/crm.ts';
const start='2026-09-30T00:00:00Z',end='2026-10-01T00:00:00Z';
const c={id:'c',owner:'op',source:'test.xlsx · ТК',sheet:'К',assignmentStartedAt:start,assignedUntil:end,trialUntil:end,trialReturnSheet:'Т1'};
assert.equal(applyRetention(c,[],Date.parse(end)-1).owner,'op');
const released=applyRetention(c,[],Date.parse(end));
assert.equal(released.owner,'');assert.equal(released.sheet,'Т1');assert.equal(released.trialUntil,undefined);
const held=applyRetention(c,[{clientId:'c',manager:'op',createdAt:start,status:'draft'}],Date.parse(end));
assert.equal(held.owner,'op');assert.equal(held.trialUntil,undefined);
assert.equal(applyRetention(c,[{clientId:'c',manager:'other',createdAt:start,status:'draft'}],Date.parse(end)).owner,'');
console.log('24-hour assignment tests passed');

const free={...c,owner:"",trialUntil:undefined,assignedUntil:""};
const assigned={...free,...clientAssignment(free,"op",start)};
assert.equal(assigned.trialUntil,"2026-10-01T00:00:00.000Z");
assert.equal(assigned.sheet,"К");
assert.equal(applyRetention(assigned,[],Date.parse(end)).owner,"");
assert.deepEqual(clientAssignment(assigned,"op",end),{}); // Ordinary editing must not extend the deadline.
assert.equal(clientAssignment(assigned,"other",end).trialUntil,"2026-10-02T00:00:00.000Z");
assert.equal(clientAssignment(assigned,"",end).trialUntil,undefined);
assert.equal(applyRetention(assigned,[{clientId:'c',manager:'op',createdAt:start,status:'draft'}],Date.parse(end)).owner,'op');

import assert from 'node:assert/strict';
import {applyRetention,clientSheet} from '../lib/crm.ts';
const now=Date.parse('2026-09-29T12:00:00Z');
const c={id:'c',source:'clients.xlsx · Т1',owner:'anna',assignedUntil:'2020-01-01',version:1};
const order=(status,extra={})=>({clientId:'c',manager:'anna',status,createdAt:'2026-01-01',...extra});
for(const status of ['draft','confirm','shipping']){const n=applyRetention(c,[order(status)],now);assert.equal(clientSheet(n),'К');assert.equal(n.owner,'anna');assert.equal(n.assignedUntil,'');}
for(const status of ['refused','returned']){const n=applyRetention(c,[order(status)],now);assert.equal(clientSheet(n),'Т1');assert.equal(n.owner,'');}
const paid=order('redeemed',{redeemedAt:new Date(now-34*86400000).toISOString()});
assert.equal(applyRetention(c,[paid],now).owner,'anna');
const expired=applyRetention(c,[paid],now+86400000);assert.equal(expired.owner,'');assert.equal(clientSheet(expired),'ТК');
assert.equal(applyRetention(c,[paid,order('draft')],now+86400000).owner,'anna');
assert.equal(applyRetention(c,[paid,order('returned')],now).owner,'anna');
assert.equal(applyRetention(c,[order('redeemed')],now).owner,'anna');
const reassigned={...expired,owner:'anna',assignmentStartedAt:'2026-09-29T12:00:00Z'};
assert.equal(clientSheet(applyRetention(reassigned,[paid,order('refused',{createdAt:'2026-09-29T12:00:00Z'})],now)),'ТК');
assert.deepEqual(applyRetention(expired,[paid],now),expired);
console.log('Retention scenarios passed');

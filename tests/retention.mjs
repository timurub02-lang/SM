import assert from 'node:assert/strict';
import {applyRetention,clientSheet} from '../lib/crm.ts';
const now=Date.parse('2026-09-29T12:00:00Z');
const c={id:'c',source:'clients.xlsx · Т1',owner:'anna',assignedUntil:'2020-01-01',version:1};
const order=(status,extra={})=>({clientId:'c',manager:'anna',status,createdAt:'2026-01-01',...extra});
for(const status of ['draft','confirm','shipping']){const n=applyRetention(c,[order(status)],now);assert.equal(clientSheet(n),'К');assert.equal(n.owner,'anna');assert.equal(n.assignedUntil,'');}
for(const status of ['refused','returned']){const n=applyRetention(c,[order(status)],now);assert.equal(clientSheet(n),'Т1');assert.equal(n.owner,'');}
const paid=order('redeemed',{redeemedAt:new Date(now-34*86400000).toISOString()});
assert.equal(applyRetention(c,[paid],now).owner,'anna');
const expired=applyRetention(c,[paid],now+86400000);assert.equal(expired.owner,'');assert.equal(clientSheet(expired),'П');
assert.equal(applyRetention(c,[paid,order('draft')],now+86400000).owner,'anna');
assert.equal(applyRetention(c,[paid,order('returned')],now).owner,'anna');
assert.equal(applyRetention(c,[order('redeemed')],now).owner,'anna');
const reassigned={...expired,owner:'anna',assignmentStartedAt:'2026-09-29T12:00:00Z'};
assert.equal(clientSheet(applyRetention(reassigned,[paid,order('refused',{createdAt:'2026-09-29T12:00:00Z'})],now)),'П');
assert.deepEqual(applyRetention(expired,[paid],now),expired);
console.log('Retention scenarios passed');

// Unpaid commission protects an existing owner, but never reassigns a released client.
const overdue=order('redeemed',{id:'unpaid',redeemedAt:'2026-01-02'});
for(const weeks of [2,5]){
 assert.equal(applyRetention(c,[overdue],now,weeks*7,true,true).owner,'anna');
 assert.equal(applyRetention(c,[overdue],now,weeks*7,true,true).assignedUntil,'');
 assert.equal(applyRetention(c,[overdue],now,weeks*7,true,false).owner,'');
}
assert.deepEqual(applyRetention({...c,owner:''},[overdue],now,14,true,true),{...c,owner:''});
assert.equal(applyRetention({...c,trialUntil:'2020-01-01',assignmentStartedAt:'2026-09-01'},[overdue],now,14,true,true).owner,'anna');

// Old orders predate the new assignment; a missing trial deadline must not keep it forever.
const fresh={...c,assignmentStartedAt:new Date(now-3600000).toISOString(),assignedUntil:''};
const freshNext=applyRetention(fresh,[overdue],now,35,true,false);
assert.equal(freshNext.owner,'anna');
assert.equal(freshNext.assignedUntil,new Date(now+23*3600000).toISOString());
assert.equal(applyRetention(freshNext,[overdue],now+23*3600000,35,true,false).owner,'');
const stale={...fresh,assignmentStartedAt:new Date(now-3*86400000).toISOString()};
assert.equal(applyRetention(stale,[overdue],now,35,true,false).owner,'');
assert.equal(applyRetention(stale,[],now).owner,'');
assert.equal(applyRetention(stale,[overdue],now,35,true,true).owner,'anna');
assert.equal(applyRetention(stale,[overdue,order('draft')],now).owner,'anna');
assert.equal(applyRetention(stale,[{...overdue,zvd:true}],now).owner,'anna');
assert.equal(applyRetention({...stale,retentionExtensionUntil:new Date(now+86400000).toISOString()},[overdue],now).owner,'anna');
assert.equal(applyRetention({...stale,importRetentionUntil:new Date(now+86400000).toISOString()},[overdue],now).owner,'anna');
assert.equal(applyRetention(c,[],now).owner,'anna');

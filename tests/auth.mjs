import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,validatePassword} from '../lib/auth-crypto.ts';
import {visibleState,authorizeCrm,mayCallEndpoint,seesOrder} from '../lib/permissions.ts';
const hash=await hashPassword('a-long-test-password');
assert.equal(await verifyPassword('a-long-test-password',hash),true);
assert.equal(await verifyPassword('another-test-password',hash),false);
assert.notEqual(hash,await hashPassword('a-long-test-password'));
assert.throws(()=>validatePassword('short'));
const a={id:'a',role:'operator',department:'1',salary:10,bonus:1},b={...a,id:'b',department:'2'},head={...a,id:'head',role:'department_head'};
const admin={...a,id:'admin',role:'admin'},logist={...a,id:'logist',role:'logistic'};
const state={employees:[a,b,head,admin,logist],clients:[{id:'ca',owner:'a',phone:'+70000000001'},{id:'cb',owner:'b',phone:'+70000000002'}],orders:[{id:'oa',clientId:'ca',manager:'a',status:'draft'},{id:'ob',clientId:'cb',manager:'b',status:'draft'}],events:[{clientId:'ca',orderId:'oa'},{clientId:'cb',orderId:'ob'}],settings:{retentionDays:30}};
for(const user of [a,head]){
 const s=visibleState(state,user);assert.deepEqual(s.clients.map(c=>c.id),['ca']);assert.equal(s.clients[0].phone,'');assert.deepEqual(s.orders.map(o=>o.id),['oa']);assert.equal(s.events.length,1);
 assert.throws(()=>authorizeCrm(user,{action:'updateClient',id:'cb'},state));
 assert.throws(()=>authorizeCrm(user,{action:'settings'},state));
 assert.equal(mayCallEndpoint(user,new URL('https://crm/api/cdek'),'POST',{}),false);
 assert.equal(mayCallEndpoint(user,new URL('https://crm/api/warehouse'),'POST',{}),false);
}
assert.throws(()=>authorizeCrm(a,{action:'saveEmployee'},state));
assert.throws(()=>authorizeCrm(head,{action:'updateOrder',id:'oa'},state));
assert.equal(seesOrder(logist,state.orders[0],state.employees),false);
assert.equal(visibleState(state,admin),state);
console.log('Passwords, role checks, department isolation and phone filtering passed');

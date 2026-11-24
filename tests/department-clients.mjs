import assert from 'node:assert/strict';
import {assignedClients,departmentOrders} from '../lib/crm.ts';
const employees=[{id:'a',role:'operator',department:'1'},{id:'b',role:'operator',department:'2'},{id:'c',role:'operator',department:'1'},{id:'l',role:'logistic',department:'1'},{id:'u',role:'operator'}];
const clients=['a','b','c','l','u',''].map(owner=>({id:owner,owner}));
assert.deepEqual(assignedClients(clients,employees,{id:'h',role:'department_head',department:'1'}).map(c=>c.owner),['a','c']);
assert.deepEqual(assignedClients(clients,employees,{id:'h',role:'department_head'}),[]);
assert.deepEqual(assignedClients(clients,employees,employees[0]).map(c=>c.owner),['a']);
console.log('Department client scope passed');

const orders=employees.map(e=>({id:e.id,manager:e.id}));
assert.deepEqual(departmentOrders(orders,employees,{role:"department_head",department:"1"}).map(o=>o.id),["a","c"]);
assert.deepEqual(departmentOrders(orders,employees,{role:"department_head"}),[]);
console.log("Department order scope passed");

const substitute={id:'rk2',role:'department_head',department:'2'};
const day=new Date(Date.now()+10800000).toISOString().slice(0,10);
const head={id:'rk1',role:'department_head',department:'1',vacation:{substitute:'rk2',department:'1',substituteDepartment:'2',from:day,until:day,enabled:false}};
const staff=[...employees,head,substitute];
const scope=()=>assignedClients(clients,staff,substitute).map(c=>c.owner);
assert.deepEqual(scope(),['b']);
head.vacation.enabled=true;
assert.deepEqual(scope(),['a','b','c']);
assert.deepEqual(departmentOrders(orders,staff,substitute).map(o=>o.manager),['a','b','c']);
head.vacation.until='2000-01-01';
assert.deepEqual(scope(),['b']);
delete head.vacation;
assert.deepEqual(scope(),['b']);

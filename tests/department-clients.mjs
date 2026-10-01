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

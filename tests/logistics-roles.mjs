import assert from 'node:assert/strict';
import {teamEmployees,employeeForManager,employeeSchema,allowedOrderTransitions,orderEditingLocked} from '../lib/crm.ts';
import {mayCallEndpoint} from '../lib/permissions.ts';
const base={id:'e',name:'Employee',alias:'',login:'employee',skLogin:'',salary:0,bonus:0,version:1};
const staff=['admin','chief_logistic','logistic','operator','courier'].map(role=>({...base,id:role,role,department:'1'}));
const chief=staff[1];
assert.deepEqual(teamEmployees(staff,chief).map(e=>e.role),['logistic']);
assert.deepEqual(teamEmployees(staff,staff[2]),[]);
assert.deepEqual(teamEmployees(staff,staff[4]),[]);
assert.equal(employeeForManager(chief,{...base,role:'admin'}).role,'logistic');
assert.throws(()=>employeeForManager(chief,staff[0],staff[0]));
assert.equal(employeeSchema.parse({...base,role:'courier'}).department,undefined);
assert.equal(employeeSchema.parse({...base,role:'chief_logistic'}).department,undefined);
for(const path of ['/api/cdek/shipment','/api/warehouse','/api/warehouse/waybill'])assert.equal(mayCallEndpoint(chief,new URL('https://crm'+path),'GET',{}),true);
for(const status of ['confirm','extra','packing','shipping']){
 const o={status,delivery:'moscow_courier',packingWaybillAt:'2026-10-02'};
 assert.deepEqual(allowedOrderTransitions(o,'chief_logistic'),allowedOrderTransitions(o,'logistic'));
 assert.equal(orderEditingLocked(chief,o),orderEditingLocked(staff[2],o));
}
console.log('Chief logistics capabilities, scoped team and role schemas passed');

import assert from 'node:assert/strict';
import {employeeSchema} from '../lib/crm.ts';
const base={name:'Сотрудник',alias:'',login:'test',skLogin:'',salary:0,bonus:0};
for(const role of ['logistic','redemption']){
 assert.equal(employeeSchema.parse({...base,role}).department,undefined);
 assert.equal(employeeSchema.parse({...base,role,department:'1'}).department,undefined);
}
for(const role of ['operator','department_head','admin']){
 assert.equal(employeeSchema.safeParse({...base,role}).success,false);
 assert.equal(employeeSchema.parse({...base,role,department:'2'}).department,'2');
}
console.log('Employee department validation passed');
const {employeeForManager}=await import('../lib/crm.ts');
const head={role:'department_head',department:'2'};
const saved=employeeForManager(head,{...base,role:'admin',department:'1'});
assert.equal(saved.role,'operator');assert.equal(saved.department,'2');
assert.throws(()=>employeeForManager({role:'department_head'},base),/назначьте отдел/);
assert.throws(()=>employeeForManager(head,base,{role:'operator',department:'1'}),/своего отдела/);
assert.throws(()=>employeeForManager(head,base,{role:'admin',department:'2'}),/своего отдела/);
assert.equal(employeeForManager(head,base,{role:'operator',department:'2'}).department,'2');
console.log('Department head employee restrictions passed');

for(const department of ["1","2","3","4","5"]){
 assert.equal(employeeSchema.parse({...base,role:"operator",department}).department,department);
}
assert.throws(()=>employeeSchema.parse({...base,role:"operator",department:"6"}));

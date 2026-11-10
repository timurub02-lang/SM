import assert from 'node:assert/strict';
import {departmentTotals} from '../lib/premium-departments.ts';
const row=(role,overrides={})=>({employee:{role},input:{salary:999,vacation:10,official:20,debt:30,penalty:40,extra:50,sz:false},volume:11400,commission:570,salary:100,result:650,payout:650,...overrides});
const rows=[row('operator'),row('department_head',{volume:11400,commission:1140,salary:50000,payout:51000,result:51000}),row('operator',{input:{salary:0,vacation:0,official:0,debt:0,penalty:0,extra:0,sz:true},volume:100,commission:5,salary:0,payout:50,result:50}),row('operator',{volume:0,commission:0,salary:0,result:-500,payout:0}),row('department_head',{volume:0,commission:0,salary:0,result:null,payout:null})];
const totals=departmentTotals(rows);
assert.equal(totals.volume,11500); // Leader volume cannot double count orders.
assert.equal(totals.salary,50100); // Use calculated salary, including UDL guarantees.
assert.equal(totals.normal,51650);assert.equal(totals.sz,50);assert.equal(totals.total,51700);
assert.equal(totals.operators,3);assert.equal(totals.missing,true);
for(const key of ['volume','commission','salary','vacation','official','debt','penalty','extra','normal','sz','total'])assert.equal(totals[key],departmentTotals(rows.slice(0,2))[key]+departmentTotals(rows.slice(2))[key]);
assert.equal(departmentTotals([row('operator',{commission:.1}),row('operator',{commission:.2})]).commission,.3);
assert.equal(departmentTotals([]).total,0);
console.log('Department summary: order totals, leader payouts, N/SZ, debt, missing calculation and kopecks passed');

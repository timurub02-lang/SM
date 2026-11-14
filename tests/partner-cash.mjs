import assert from 'node:assert/strict';
import {partnerCalculation,defaultPartnerSettings,isEmil} from '../lib/partner-cash.ts';
const member={id:'LV-1',externalId:'1',department:'5'};
const receipt={registry:'10',paymentDate:'2026-11-12',collectedCents:1130000,amountCents:767670};
const order={id:'LV-1',items:[{name:'Товар',quantity:2}],cdekRemittances:[receipt,{...receipt,registry:'11'}]};
const payroll=[{department:'5',input:{sz:false},payout:500},{department:'5',role:'department_head',input:{sz:false},payout:200},{department:'5',input:{sz:true},payout:9000},{department:'4',input:{sz:false},payout:9999}];
const settings={...defaultPartnerSettings,taxRate:7,communication:100,bank:50};
const r=partnerCalculation([member,member,{externalId:'other',department:'4'}],[order],payroll,settings);
assert.equal(r.receipts.length,1);assert.equal(r.orderCount,1);assert.equal(r.tax,79100);assert.equal(r.transferred,767670);assert.equal(r.goods,60000);assert.equal(r.premium,70000);assert.equal(r.remaining,543570);assert.equal(r.ourShare+r.partnerShare,r.remaining);
assert.equal(partnerCalculation([member],[order],payroll,defaultPartnerSettings).remaining,null);
assert.equal(partnerCalculation([member],[],payroll,settings).remaining,null);
assert.equal(partnerCalculation([member],[{...order,cdekRemittances:[receipt,{...receipt,amountCents:1}]}],payroll,settings).receipts.length,0);
assert.equal(partnerCalculation([member],[order],[{department:'5',input:{sz:false},payout:null}],settings).remaining,null);
assert.equal(isEmil({login:'A_Emil'}),true);assert.equal(isEmil({login:'A_Alena'}),false);
console.log('Partner settlement: gross tax, net receipts, duplicates, leader premium, SZ exclusion and missing data passed');

assert.equal(partnerCalculation([{...member,historyOnly:true}],[order],[],settings).orderCount,0);
assert.equal(partnerCalculation([member],[{...order,items:[{name:'ИТОГО',quantity:1},{name:'Товар',quantity:2}]}],payroll,settings).goods,60000);

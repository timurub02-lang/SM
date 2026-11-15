import assert from 'node:assert/strict';
import {partnerPremiumStatus,partnerRegistries,partnerCalculation,defaultPartnerSettings,isEmil} from '../lib/partner-cash.ts';
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

const priced=partnerCalculation([member],[order],payroll,{...settings,productPrices:{[order.items[0].name]:125.50}});
assert.equal(priced.products.find(p=>p.name===order.items[0].name).price,125.50);
assert.equal(priced.goods,priced.products.reduce((sum,p)=>sum+p.total,0));
assert.equal(priced.remaining,priced.transferred-priced.tax-15000-priced.goods-priced.premium);

const groupedReceipt={order:'one',slot:1,registry:'123',date:'2026-11-12',collected:10000,transferred:9000,tax:700};
const groups=partnerRegistries([groupedReceipt,{...groupedReceipt,order:'two',tax:701},{...groupedReceipt,slot:2,order:'three'},{...groupedReceipt,date:'2026-11-13',order:'four',tax:null}]);
assert.equal(groups.length,3);assert.equal(groups[0].tax,null);
const combined=groups.find(g=>g.orders.length===2);assert.equal(combined.collected,20000);assert.equal(combined.transferred,18000);assert.equal(combined.tax,1401);
assert.equal(partnerCalculation([member],[order],payroll,{...settings,productUnitPrice:125.5}).products[0].price,125.5);
const minutes={updatedAt:'2026-11-15T12:00:00Z',through:'2026-11-15T12:00:00Z',missing:[],rows:[{employeeId:'op',login:'op',billed:354,seconds:15097}]};
const metered=partnerCalculation([member],[order],payroll,{...settings,minutePrice:1,minutes});
assert.equal(metered.communication,Math.round(settings.communication*100)+35400);
assert.equal(partnerCalculation([member],[order],payroll,{...settings,minutePrice:1}).remaining,null);
assert.equal(partnerCalculation([member],[order],payroll,{...settings,minutePrice:1,minutes:{...minutes,missing:['missing']}}).remaining,null);

assert.equal(partnerPremiumStatus('2026-11-24',false,Date.parse('2026-11-24T23:59:59.999+03:00')),'Ещё идёт');
assert.equal(partnerPremiumStatus('2026-11-24',false,Date.parse('2026-11-25T00:00:00+03:00')),'Рассчитано');
assert.equal(partnerPremiumStatus('2026-11-24',false,Date.parse('2026-12-01T12:00:00+03:00')),'Рассчитано');
assert.equal(partnerPremiumStatus('2026-12-08',false,Date.parse('2026-12-02T12:00:00+03:00')),'Ещё идёт');
assert.equal(partnerPremiumStatus('2026-11-24',true,Date.parse('2026-11-15T12:00:00+03:00')),'Рассчитано');

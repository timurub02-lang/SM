import assert from 'node:assert/strict';
import {removalPlan} from '../lib/employee-removal.ts';
import {applyRetention,clientAssignment} from '../lib/crm.ts';
import {periodForReceipt} from '../lib/premium-periods.ts';
import {premiumCalculation} from '../lib/premium-calculation.ts';
import {rowFromCalculation,ledgerRows} from '../lib/premium-ledger.ts';
const op={id:'op',role:'operator',department:'1',version:1,bonus:10,login:'old',name:'Old'},other={...op,id:'other',login:'new'},head={id:'head',role:'department_head',department:'1',leaderPremium:{model:'percent',fixedPerPeriod:0,links:[{operatorId:'op',rate:5}]}},admin={id:'admin',role:'admin'};
const client={id:'c',owner:'op',name:'Иванов Иван Иванович',sheet:'К',returnSheet:'Т1',permanentOwner:'op',assignedUntil:'2099-01-01',importRetentionUntil:'2099-01-01'};
const order={id:'o',clientId:'c',manager:'op',status:'draft',createdAt:'2026-11-01',version:1};
const state={employees:[op,other,head],clients:[client],orders:[order]};
assert.throws(()=>removalPlan(state,head,'op',1,'transfer','other'),/администратор/);
const p=removalPlan(state,head,'op',1,'release');
assert.equal(p.orders[0].manager,'op');assert.equal(p.clients[0].owner,'op');
for(const status of ['draft','rework','confirm','extra','check','packing','shipping','pickup'])assert.equal(applyRetention(p.clients[0],[{...order,status}]).owner,'op',status);
for(const status of ['redeemed','refused','returned']){
 const c=applyRetention(p.clients[0],[{...order,status}]);assert.equal(c.owner,'',status);assert.equal(c.permanentOwner,undefined);
 assert.equal(applyRetention(p.clients[0],[{...order,status},{...order,id:'o2',status:'shipping'}]).owner,'op');
}
assert.equal(removalPlan({...state,orders:[]},head,'op',1,'release').clients[0].owner,'');
assert.equal(clientAssignment(p.clients[0],'other','2026-11-27').dismissedOwner,undefined);
const transfer=removalPlan(state,admin,'op',1,'transfer','other');assert.equal(transfer.orders[0].manager,'other');assert.equal(transfer.orders[0].premiumManager,'op');
const dismissed={...op,dismissedAt:'2026-11-27',accessEnabled:false};
assert.throws(()=>removalPlan({...state,employees:[dismissed,other]},admin,'op',1,'release'),/уже уволен/);
assert.throws(()=>removalPlan({...state,employees:[op,{...other,dismissedAt:'2026-11-27'}]},admin,'op',1,'transfer','other'),/другого оператора/);
const paid={...transfer.orders[0],status:'redeemed',delivery:'moscow_courier',paymentReceivedAt:'2026-11-27T10:00:00Z',paymentReceipt:{amount:10000}};
const staff=[dismissed,other,head];
const calc=premiumCalculation([paid],admin,staff,periodForReceipt('2026-11-27').id,{});
assert.equal(calc.rows.find(r=>r.employee.id==='op').commission,1000);
assert.equal(calc.rows.find(r=>r.employee.id==='other').commission,0);
assert.equal(calc.rows.find(r=>r.employee.id==='head').commission,500);
assert.equal(rowFromCalculation(calc.rows[0]).dismissedAt,'2026-11-27');
const ledger={activePeriod:'2026-11-2',periods:{'2026-11-2':{status:'paid',rows:[{id:'op',payout:12345}],signatures:{}}}};
assert.deepEqual(ledgerRows(ledger,'2026-11-2',[paid],staff,{}),ledger.periods['2026-11-2'].rows);
console.log('Dismissal: ownership, delayed release, admin transfer, operator and head premium, paid history passed');

for(const sheet of ['ПВ','ЧС'])assert.equal(applyRetention({...p.clients[0],sheet,manualSheet:{sheet,at:'2026-11-27'}},[{...order,status:'refused'}]).sheet,sheet);

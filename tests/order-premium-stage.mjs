import assert from 'node:assert/strict';
import {orderDisplayGroup,orderDisplayGroups,showOrderInList} from '../lib/order-premium-stage.ts';
import {orderGroup,closedOrderCallBlocked} from '../lib/crm.ts';
assert.deepEqual(orderDisplayGroups.slice(4,7).map(g=>g.label),['Оплачен','Начислено','Выплачено']);
const order={status:'redeemed'};
assert.equal(orderDisplayGroup(order).id,'paid');
for(const [status,id] of [['accrued','accrued'],['paid','premium_paid']]){
 const o={...order,premiumStage:{status,periodId:'2026-10-2'}};
 assert.equal(orderDisplayGroup(o).id,id);
 assert.equal(orderGroup(o).id,'paid');
 assert.equal(closedOrderCallBlocked({id:'operator',role:'operator'},o,{owner:''}),true);
}
assert.equal(orderDisplayGroup({...order,premiumStage:{status:'accrued',periodId:''}}).id,'paid');
assert.equal(orderDisplayGroup({status:'returned',premiumStage:{status:'paid',periodId:'2026-10-2'}}).id,'returned');
console.log('Financial tabs preserve order lifecycle and call restrictions');

const paidOrder={status:'redeemed',manager:'original',premiumStage:{status:'paid',periodId:'2026-10-2'}};
for(const role of ['operator','department_head']){
 assert.equal(showOrderInList(paidOrder,{owner:'original'},role),true);
 for(const client of [{owner:''},{owner:'other'},undefined])assert.equal(showOrderInList(paidOrder,client,role),false);
 for(const premiumStage of [undefined,{status:'accrued',periodId:'2026-10-2'},{status:'paid',periodId:'2026-10-2'}]){
  const archived={...paidOrder,premiumStage},before=JSON.stringify(archived);
  for(const client of [{owner:''},{owner:'other'},undefined])assert.equal(showOrderInList(archived,client,role),false);
  assert.equal(showOrderInList(archived,{owner:'original'},role),true);
  assert.equal(showOrderInList(archived,{owner:''},'admin'),true);
  assert.equal(JSON.stringify(archived),before);
 }
 assert.equal(showOrderInList({...paidOrder,status:'shipping',premiumStage:undefined},{owner:''},role),true);
}
assert.equal(showOrderInList(paidOrder,{owner:''},'admin'),true);
assert.equal(paidOrder.premiumStage.status,'paid');

const cancelled={status:'refused',manager:'original',cancelledAt:'2026-10-28T10:00:00Z',cancellationAuthor:{id:'original',name:'Operator'}};
const saved=JSON.stringify(cancelled);
for(const role of ['operator','department_head']){
 assert.equal(showOrderInList(cancelled,{owner:'original'},role),true);
 assert.equal(showOrderInList(cancelled,{owner:''},role),false);
 assert.equal(showOrderInList(cancelled,{owner:'other'},role),false);
}
assert.equal(showOrderInList(cancelled,{owner:''},'admin'),true);
assert.equal(JSON.stringify(cancelled),saved);
assert.equal(orderGroup(cancelled).id,'cancelled');

const {cdekMoneyLabel}=await import('../lib/cdek-remittance.ts');
const imported={status:'redeemed',delivery:'',importedPayment:{source:'История выплат · 2026-10-1'}};
assert.equal(cdekMoneyLabel(imported),'Деньги получены · История выплат · 2026-10-1');
assert.equal(cdekMoneyLabel({...imported,status:'refused'}),'');
assert.equal(cdekMoneyLabel({...imported,importedPayment:undefined}),'');

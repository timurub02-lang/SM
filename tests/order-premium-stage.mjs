import assert from 'node:assert/strict';
import {orderDisplayGroup,orderDisplayGroups,showPaidOrderInList} from '../lib/order-premium-stage.ts';
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
 assert.equal(showPaidOrderInList(paidOrder,{owner:'original'},role),true);
 for(const client of [{owner:''},{owner:'other'},undefined])assert.equal(showPaidOrderInList(paidOrder,client,role),false);
 assert.equal(showPaidOrderInList({...paidOrder,premiumStage:{status:'accrued',periodId:'2026-10-2'}},{owner:''},role),true);
 assert.equal(showPaidOrderInList({...paidOrder,premiumStage:undefined},{owner:''},role),true);
}
assert.equal(showPaidOrderInList(paidOrder,{owner:''},'admin'),true);
assert.equal(paidOrder.premiumStage.status,'paid');

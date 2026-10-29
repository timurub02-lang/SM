import assert from 'node:assert/strict';
import {orderDisplayGroup,orderDisplayGroups} from '../lib/order-premium-stage.ts';
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

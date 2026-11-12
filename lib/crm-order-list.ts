import {departmentOrders,deliveryQueue,reworkStage,confirmationStage,packingStage,type State,type Employee} from './crm.ts';
import {showOrderInList,orderDisplayGroup} from './order-premium-stage.ts';
import {courierRecalledAtWarehouse,courierDoorRefusal} from './courier.ts';
import {normalizeOrderSearch} from './order-search.ts';
import {compareRedemptionPriority} from './redemption-priority.ts';
export const orderListViews=['orders','rework','confirm','check','shipping','moscow','post'] as const;
export type OrderListQuery={view:string;filter:string;query:string;showNextPremium:boolean};
export function filteredOrderList(state:State,employee:Employee,{view,filter,query,showNextPremium}:OrderListQuery,reminderNow=Date.now()){
 const actor=employee.id,clientsById=new Map(state.clients.map(c=>[c.id,c]));
 const shippingView=['shipping','moscow','post'].includes(view);
 const scopedOrders=employee.role==='operator'?state.orders.filter(o=>o.manager===actor):employee.role==='department_head'?departmentOrders(state.orders,state.employees,employee):state.orders;
 const visibleOrders=view==='orders'?scopedOrders.filter(o=>showOrderInList(o,clientsById.get(o.clientId),employee.role)):scopedOrders;
 const prioritizeRedemption=view==='orders'&&filter==='sent',redemptionStatuses=state.redemptionStatuses||[];
 const awaitingBuyoutOperator=new Set(Object.entries(state.redemptionResults||{}).filter(([,r])=>r.awaitingOperator).map(([id])=>id));
 const workedBuyoutToday=new Set(Object.entries(state.redemptionResults||{}).filter(([,r])=>r.workedToday).map(([id])=>id));
 return visibleOrders.filter(o=>{const c=clientsById.get(o.clientId);return c&&deliveryQueue(o,view)&&normalizeOrderSearch(`${c.name} ${c.phone} ${c.city} ${o.id}`).includes(normalizeOrderSearch(query))&&(view==="rework"?o.status==="rework":view==="confirm"?["confirm","extra"].includes(o.status):view==="check"?o.status==="check":shippingView?(["packing","phone","shipping","pickup","redeemed","returned"].includes(o.status)||view==="moscow"&&(!!o.courier||o.status==="rework"&&courierRecalledAtWarehouse(o))):true)&&(["orders","confirm","shipping"].includes(view)&&!!query.trim()||view==="check"||filter==="all"||(view==="rework"?filter===reworkStage(o,reminderNow,state.settings.orderPolicy):view==="orders"?(filter==="accrued"&&showNextPremium?!!state.premiumNextPeriod&&o.premiumNextPeriod===state.premiumNextPeriod:filter===orderDisplayGroup(o).id):view==="confirm"?confirmationStage(o,reminderNow,state.settings.orderPolicy)===filter:shippingView?filter===packingStage(o):filter===o.status));}).sort((a,b)=>(prioritizeRedemption?compareRedemptionPriority(a,b,redemptionStatuses,workedBuyoutToday,awaitingBuyoutOperator):0)||Number(!!courierDoorRefusal(b))-Number(!!courierDoorRefusal(a))||(view==="rework"?(Date.parse(a.reworkDeadline||"")||Infinity)-(Date.parse(b.reworkDeadline||"")||Infinity):view==="confirm"&&["expiring","repeat_expiring"].includes(filter)?(Date.parse(a.noAnswerDeadline||"")||Infinity)-(Date.parse(b.noAnswerDeadline||"")||Infinity):0));
}

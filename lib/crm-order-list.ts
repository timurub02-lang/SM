import {orderStageDate} from './order-stage-date.ts';
import {orderNextAction} from './order-next-action.ts';
import {packingDisplayStage} from './packing-display-stage.ts';
import {departmentOrders,deliveryQueue,reworkStage,confirmationStage,orderLocation,statuses,total,type Order,type State,type Employee} from './crm.ts';
import {showOrderInList,orderDisplayGroup} from './order-premium-stage.ts';
import {courierRecalledAtWarehouse,courierDoorRefusal} from './courier.ts';
import {normalizeOrderSearch} from './order-search.ts';
import {compareRedemptionPriority} from './redemption-priority.ts';
export const orderListViews=['orders','rework','confirm','check','shipping','moscow','post'] as const;
export const orderSortKeys=['stageDate','createdAt','id','client','status','location','action','total','manager'] as const;
export type OrderSortKey=typeof orderSortKeys[number];
export type OrderListQuery={view:string;filter:string;query:string;showNextPremium:boolean;sort?:OrderSortKey;direction?:'asc'|'desc'};
export function filteredOrderList(state:State,employee:Employee,{view,filter,query,showNextPremium,sort='stageDate',direction='desc'}:OrderListQuery,reminderNow=Date.now()){
 const actor=employee.id,clientsById=new Map(state.clients.map(c=>[c.id,c]));
 const employeesById=new Map(state.employees.map(e=>[e.id,e]));
 const value=(o:Order):string|number=>{switch(sort){
  case 'stageDate':return Date.parse(orderStageDate(o).at||'')||0;
  case 'createdAt':return Date.parse(o.createdAt)||0;
  case 'id':return o.id;
  case 'client':return clientsById.get(o.clientId)?.name||'';
  case 'status':return orderDisplayGroup(o).label+' '+statuses[o.status];
  case 'location':return orderLocation(o);
  case 'action':return orderNextAction(o);
  case 'total':return total(o);
  case 'manager':return employeesById.get(o.manager)?.name||'';
 }};
 const compare=(a:Order,b:Order)=>{const av=value(a),bv=value(b);if(sort==='stageDate'&&(!av||!bv))return Number(!av)-Number(!bv)||(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0);return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true,sensitivity:'base'}))*(direction==='asc'?1:-1)||(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)||a.id.localeCompare(b.id);};
 const shippingView=['shipping','moscow','post'].includes(view);
 const scopedOrders=(employee.role==='operator'?state.orders.filter(o=>o.manager===actor):employee.role==='department_head'?departmentOrders(state.orders,state.employees,employee):state.orders).filter(o=>!o.zvd||['admin','operator','department_head'].includes(employee.role));
 const visibleOrders=view==='orders'?scopedOrders.filter(o=>showOrderInList(o,clientsById.get(o.clientId),employee.role)):scopedOrders;
 const prioritizeRedemption=view==='orders'&&filter==='sent',redemptionStatuses=state.redemptionStatuses||[];
 const awaitingBuyoutOperator=new Set(Object.entries(state.redemptionResults||{}).filter(([,r])=>r.awaitingOperator).map(([id])=>id));
 const workedBuyoutToday=new Set(Object.entries(state.redemptionResults||{}).filter(([,r])=>r.workedToday).map(([id])=>id));
 return visibleOrders.filter(o=>{const c=clientsById.get(o.clientId);return c&&deliveryQueue(o,view)&&normalizeOrderSearch(`${c.name} ${c.phone} ${c.city} ${o.id}`).includes(normalizeOrderSearch(query))&&(view==="rework"?o.status==="rework":view==="confirm"?["confirm","extra"].includes(o.status):view==="check"?o.status==="check":shippingView?(["packing","phone","shipping","pickup","redeemed","returned"].includes(o.status)||view==="moscow"&&(!!o.courier||o.status==="rework"&&courierRecalledAtWarehouse(o))):true)&&(["orders","confirm","shipping","check"].includes(view)&&!!query.trim()||view==="check"&&(filter==="zvd"?!!o.zvd:!o.zvd)||filter==="all"&&view!=="check"||(view==="rework"?filter===reworkStage(o,reminderNow,state.settings.orderPolicy):view==="orders"?(filter==="accrued"&&showNextPremium?!!state.premiumNextPeriod&&o.premiumNextPeriod===state.premiumNextPeriod:filter===orderDisplayGroup(o).id):view==="confirm"?confirmationStage(o,reminderNow,state.settings.orderPolicy)===filter:shippingView?filter===packingDisplayStage(o,reminderNow):filter===o.status));}).sort((a,b)=>Number(!!a.zvd)-Number(!!b.zvd)||(view==='orders'?((prioritizeRedemption?compareRedemptionPriority(a,b,redemptionStatuses,workedBuyoutToday,awaitingBuyoutOperator):0)||compare(a,b)):(prioritizeRedemption?compareRedemptionPriority(a,b,redemptionStatuses,workedBuyoutToday,awaitingBuyoutOperator):0)||Number(!!courierDoorRefusal(b))-Number(!!courierDoorRefusal(a))||(view==="rework"?(Date.parse(a.reworkDeadline||"")||Infinity)-(Date.parse(b.reworkDeadline||"")||Infinity):view==="confirm"&&["expiring","repeat_expiring"].includes(filter)?(Date.parse(a.noAnswerDeadline||"")||Infinity)-(Date.parse(b.noAnswerDeadline||"")||Infinity):0)));
}

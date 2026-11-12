import {legacyPremiumPaid} from './legacy-premium-paid.ts';
import {orderGroup,orderGroups,type Order,type Client,type Employee} from './crm.ts';

export type OrderPremiumStage={status:'accrued'|'paid';periodId:string;paidAt?:string};
const transferred={id:'transferred',label:'Передан'};
const accrued={id:'accrued',label:'Начислено'};
const paid={id:'premium_paid',label:'Выплачено'};
export const orderDisplayGroups=orderGroups.flatMap(group=>group.id==='new'?[group,transferred]:group.id==='paid'?[group,accrued,paid]:[group]);
// Financial stages only affect the order list, never fulfilment or retention.
export function orderDisplayGroup(order:Order){
 if(order.zvd)return transferred;
 if(order.status==='confirm')return transferred;
 if(order.status==='redeemed'&&order.premiumStage?.periodId){
  if(order.premiumStage.status==='accrued')return accrued;
  if(order.premiumStage.status==='paid')return paid;
 }
 // Imported LV labels are provisional: they do not enter the paid payroll ledger.
 if(order.status==='redeemed'&&(order.legacyLv?.paymentPendingReview||legacyPremiumPaid(order)))return paid;
 return orderGroup(order);
}

// Only the operational list is pruned; payroll history retains its original membership.
export function showOrderInList(order:Order,client:Client|undefined,role:Employee["role"]){
 const group=orderDisplayGroup(order).id;
 const hideUnassigned=group==="cancelled"&&["admin","operator","department_head"].includes(role)||group==="premium_paid"&&["operator","department_head"].includes(role);
 return !hideUnassigned||!!client?.owner&&client.owner===order.manager;
}

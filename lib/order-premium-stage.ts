import {orderGroup,orderGroups,type Order,type Client,type Employee} from './crm.ts';

export type OrderPremiumStage={status:'accrued'|'paid';periodId:string};
const accrued={id:'accrued',label:'Начислено'};
const paid={id:'premium_paid',label:'Выплачено'};
export const orderDisplayGroups=orderGroups.flatMap(group=>group.id==='paid'?[group,accrued,paid]:[group]);
// Financial stages only affect the order list, never fulfilment or retention.
export function orderDisplayGroup(order:Order){
 if(order.status==='redeemed'&&order.premiumStage?.periodId){
  if(order.premiumStage.status==='accrued')return accrued;
  if(order.premiumStage.status==='paid')return paid;
 }
 return orderGroup(order);
}

// Only the operational list is pruned; payroll history retains its original membership.
export function showOrderInList(order:Order,client:Client|undefined,role:Employee["role"]){
 return !["operator","department_head"].includes(role)||!["redeemed","refused"].includes(order.status)||!!client?.owner&&client.owner===order.manager;
}

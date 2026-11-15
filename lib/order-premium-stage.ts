import {legacyPremiumPaid} from './legacy-premium-paid.ts';
import {statuses,orderGroup,orderGroups,type Order,type Client,type Employee} from './crm.ts';

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

export function orderCurrentStatusLabel(order:Order){
 return order.status==='redeemed'?orderDisplayGroup(order).label:statuses[order.status];
}

// Existing paid orders are archived immediately; subsequent payments get 48 hours.
const paidArchiveStartedAt=Date.parse('2026-11-15T21:30:16Z');
export function paidOrderArchived(order:Order,now=Date.now()){
 if(order.status!=='redeemed')return false;
 if(order.premiumStage?.status==='accrued')return false;
 if(order.premiumStage?.status!=='paid'&&!legacyPremiumPaid(order))return false;
 const at=Date.parse(order.premiumStage?.paidAt||order.priorPremiumPaid?.at||'');
 return !Number.isFinite(at)||at<=paidArchiveStartedAt||now>=at+48*3600000;
}

// Only the operational list is pruned; payroll history retains its original membership.
export function showOrderInList(order:Order,client:Client|undefined,role:Employee["role"],now=Date.now()){
 if(paidOrderArchived(order,now))return false;
 if(order.status==='rework'&&['operator','department_head'].includes(role))return false;
 const group=orderDisplayGroup(order).id;
 // A rejected review remains visible so the operator can find its cancellation reason after release.
 if(group==='cancelled'&&order.blacklistedAt)return true;
 const hideUnassigned=(group==="cancelled"||group==="premium_paid"&&!!order.legacyLv?.paymentPendingReview&&order.premiumStage?.status!=="paid")&&["admin","operator","department_head"].includes(role);
 return !hideUnassigned||!!client?.owner&&client.owner===order.manager;
}

import type {State} from './crm.ts';
export const orderMutationActions=new Set(['requestOrderCancellation','resolveOrderCancellation','updateLogisticComment','clientWaiting','markPV','courierAccept','courierOutcome','courierWorkflow','receivePayment','savePostalTracking','saveManualDeliveryCost','returnToWarehouse','markPackingWaybill','updateWaybillComment','selectCdekTariff','updateDelivery','updateOrder','transition','contact','comment']);
export type OrderEntityPatch={clientId:string;state:State};
export function mergeOrderEntityPatch(current:State,patch:OrderEntityPatch):State{
 const {clientId,state:next}=patch;
 const scoped=<T extends {clientId?:string}>(old:T[]=[],fresh:T[]=[])=>[...old.filter(x=>x.clientId!==clientId),...fresh.filter(x=>x.clientId===clientId)];
 const retentionPreview={...current.retentionPreview};delete retentionPreview[clientId];Object.assign(retentionPreview,next.retentionPreview);
 const redemptionResults={...current.redemptionResults};for(const o of current.orders.filter(o=>o.clientId===clientId))delete redemptionResults[o.id];Object.assign(redemptionResults,next.redemptionResults);
 return {...current,retentionPreview,redemptionResults,
  clients:[...current.clients.filter(c=>c.id!==clientId),...next.clients.filter(c=>c.id===clientId)],
  orders:scoped(current.orders,next.orders),events:scoped(current.events,next.events).sort((a,b)=>b.at.localeCompare(a.at)),
  reminders:scoped(current.reminders,next.reminders),tasks:scoped(current.tasks,next.tasks),incoming:scoped(current.incoming,next.incoming),
  clientReminders:scoped(current.clientReminders,next.clientReminders),clientWork:scoped(current.clientWork,next.clientWork),
 };
}

import type {Reminder} from './reminders.ts';
import type {State} from './crm.ts';
export const orderMutationActions=new Set(['createOrder','updateMoscowDetails','requestOrderCancellation','resolveOrderCancellation','updateLogisticComment','clientWaiting','markZvd','markPV','markBlacklist','courierAccept','courierOutcome','courierWorkflow','receivePayment','savePostalTracking','saveManualDeliveryCost','returnToWarehouse','markPackingWaybill','updateWaybillComment','selectCdekTariff','updateDelivery','updateOrder','transition','contact','comment']);
export type OrderEntityPatch={clientId:string;state:State;deferredWorkspace?:boolean;orderTasks?:Reminder[]};
export function mergeOrderEntityPatch(current:State,patch:OrderEntityPatch):State{
 const {clientId,state:next}=patch;
 const scoped=<T extends {clientId?:string}>(old:T[]=[],fresh:T[]=[])=>[...old.filter(x=>x.clientId!==clientId),...fresh.filter(x=>x.clientId===clientId)];
 const client=next.clients.find(c=>c.id===clientId),previousClient=current.clients.find(c=>c.id===clientId),orders=new Map(next.orders.map(o=>[o.id,o])),oldOrders=new Map(current.orders.map(o=>[o.id,o]));
 const access=(s:State)=>JSON.stringify(s.employees.map(e=>[e.id,e.role,e.department||'',e.baseAccess||'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 const sameAccess=access(current)===access(next);
 // Independently loaded sections keep their last values only while the same access remains.
 const deferred=<T extends {clientId?:string;orderId?:string}>(old:T[]=[],fresh:T[]=[])=>patch.deferredWorkspace?old.filter(row=>row.clientId!==clientId||sameAccess&&!!client&&!!previousClient&&client.owner===previousClient.owner&&(!row.orderId||orders.has(row.orderId)&&orders.get(row.orderId)?.manager===oldOrders.get(row.orderId)?.manager)):scoped(old,fresh);
 // The saved client's order tasks are authoritative; unrelated and personal reminders stay intact.
 const tasks=patch.orderTasks?deferred(current.tasks,next.tasks).filter(t=>t.clientId!==clientId||!t.orderId).concat(patch.orderTasks.filter(t=>t.clientId===clientId&&!!t.orderId)):deferred(current.tasks,next.tasks);
 const retentionPreview={...current.retentionPreview};delete retentionPreview[clientId];Object.assign(retentionPreview,next.retentionPreview);
 const redemptionResults={...current.redemptionResults};for(const o of current.orders.filter(o=>o.clientId===clientId))delete redemptionResults[o.id];Object.assign(redemptionResults,next.redemptionResults);
 return {...current,retentionPreview,redemptionResults,
  clients:[...current.clients.filter(c=>c.id!==clientId),...next.clients.filter(c=>c.id===clientId)],
  orders:scoped(current.orders,next.orders),events:scoped(current.events,next.events).sort((a,b)=>b.at.localeCompare(a.at)),
  reminders:deferred(current.reminders,next.reminders),tasks:tasks.filter(t=>!patch.deferredWorkspace||t.clientId!==clientId||!t.incomingId||next.incoming?.some(i=>i.id===t.incomingId&&!i.closedAt&&!i.spam)),incoming:scoped(current.incoming,next.incoming),
  clientReminders:deferred(current.clientReminders,next.clientReminders),clientWork:deferred(current.clientWork,next.clientWork),
 };
}

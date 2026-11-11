import type {State} from './crm.ts';

// Order edits do not remove records. Other screens still use complete snapshots.
export const orderPatchActions=new Set(['transition','contact','comment','updateOrder','updateDelivery','updateWaybillComment','updateLogisticComment','markPV']);
export function orderSavePatch(before:State,after:State,orderId:string):State{
 const order=after.orders.find(o=>o.id===orderId);
 const previousOrders=new Map(before.orders.map(o=>[o.id,o]));
 const previousClients=new Map(before.clients.map(c=>[c.id,c]));
 const events=new Set(before.events.map(e=>e.id));
 return {...after,
  orders:after.orders.filter(o=>o.id===orderId||JSON.stringify(previousOrders.get(o.id))!==JSON.stringify(o)),
  clients:after.clients.filter(c=>c.id===order?.clientId||JSON.stringify(previousClients.get(c.id))!==JSON.stringify(c)),
  events:after.events.filter(e=>e.orderId===orderId||!events.has(e.id)),
 };
}
export function mergeOrderSavePatch(current:State,patch:State):State{
 function upsert<T extends {id:string}>(existing:T[],updates:T[]){
  const next=new Map(updates.map(item=>[item.id,item]));
  const merged=existing.map(item=>{const update=next.get(item.id);next.delete(item.id);return update||item;});
  return [...merged,...next.values()];
 }
 return {...current,...patch,orders:upsert(current.orders,patch.orders),clients:upsert(current.clients,patch.clients),events:upsert(current.events,patch.events).sort((a,b)=>b.at.localeCompare(a.at))};
}

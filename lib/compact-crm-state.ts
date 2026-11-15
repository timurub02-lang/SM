import type {State} from './crm.ts';

// History and raw import audit data stay on the server; working fields are unchanged.
export function compactCrmState<T extends State>(state:T):T{
 const cancelled=new Set(state.orders.filter(o=>o.status==='refused').map(o=>o.id)),seen=new Set<string>();
 const events=state.events.filter(e=>{
  if(!cancelled.has(e.orderId)||seen.has(e.orderId)||!(/→ Отказ(?: ·|$)/.test(e.text)||e.text.startsWith('Заказ отменён:')||e.text.includes('Отказ у двери подтверждён')))return false;
  seen.add(e.orderId);return true;
 });
 return {...state,historyRemote:true,events,
  clients:state.clients.map(value=>{const {legacyOrderHistory,importFields,baseImport,...client}=value as typeof value&{baseImport?:unknown};return client;}),
  orders:state.orders.map(order=>{
   if(!order.legacyLv)return order;
   const {sourceItems,...legacyLv}=order.legacyLv as typeof order.legacyLv&{sourceItems?:unknown};
   return {...order,legacyLv};
  })};
}

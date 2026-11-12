import type {State} from './crm.ts';

// History stays in SQLite and is loaded by its own authorized, paginated endpoint.
export function compactCrmState<T extends State>(state:T):T{
 const cancelled=new Set(state.orders.filter(o=>o.status==='refused').map(o=>o.id)),seen=new Set<string>();
 const events=state.events.filter(e=>{
  if(!cancelled.has(e.orderId)||seen.has(e.orderId)||!(/→ Отказ(?: ·|$)/.test(e.text)||e.text.startsWith('Заказ отменён:')||e.text.includes('Отказ у двери подтверждён')))return false;
  seen.add(e.orderId);return true;
 });
 return {...state,historyRemote:true,events,clients:state.clients.map(({legacyOrderHistory,importFields,...client})=>client)};
}

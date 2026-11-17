import {operatorStats} from './operator-stats.ts';
import type {State,Employee,Order} from './crm.ts';
const moscowDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'});
export function confirmationOutcome(order:Order){
 if(order.status==='redeemed')return 'paid';
 if(order.status==='returned')return 'returned';
 if(order.status==='refused')return 'cancelled';
 if(order.shippedAt||order.cdekTransferredAt||['shipping','pickup'].includes(order.status))return 'sent';
 return 'waiting';
}
export function confirmationStats(state:Pick<State,'employees'|'orders'> & Partial<Pick<State,'events'>>,actor:Employee,from:string,to:string,department=''){
 const allowed=new Set(operatorStats({...state,orders:[]},actor,'','').filter(e=>!department||e.department===department).map(e=>e.id));
 const handoffs=new Map<string,NonNullable<State['events']>[number]>(),reviews=new Set<string>();
 for(const event of state.events||[]){
  const transition=/^(?:Подтверждено руководителем · [^\n]+ · )?(?:ЗВД снят · )?(Подтверждение → (?:Проверка|Доп\. подтверждение|Упаковка)|Доп\. подтверждение → Упаковка|Возврат оператору → Упаковка|Проверка → Упаковка)(?: · [^\n]*)?(?:\n|$)/.exec(event.text);
  const headConsent=event.text.startsWith('Подтверждено руководителем · ')&&event.text.includes(' · клиент согласен выкупить заказ\n')&&/^Статус: (Подтверждение|Доп\. подтверждение|Возврат оператору) → (Проверка|Доп\. подтверждение|Упаковка)$/m.test(event.text);
  if(!event.actorId||!headConsent&&(!transition||!event.text.split('\n').includes('Статус: '+transition[1])))continue;
  if(transition?.[1]==='Проверка → Упаковка'){reviews.add(event.orderId+'@'+event.at);continue;}
  if(!handoffs.has(event.orderId)||handoffs.get(event.orderId)!.at<event.at)handoffs.set(event.orderId,event);
 }
 const rows=new Map<string,{id:string;label:string;confirmed:number;cancelled:number;sent:number;paid:number;returned:number;waiting:number;orders:Order[]}>();
 for(const order of new Map(state.orders.map(o=>[o.id,o])).values()){
  const handoff=handoffs.get(order.id);
  const employee=handoff&&state.employees.find(e=>e.id===handoff.actorId);
  const saved=order.deliveryConfirmationAuthor&&!reviews.has(order.id+'@'+order.deliveryConfirmationAuthor.at)?order.deliveryConfirmationAuthor:undefined;
  const author=handoff&&(!saved||handoff.at>saved.at)?{id:handoff.actorId!,name:employee?.name||handoff.actor,at:handoff.at}:saved;
  if(!allowed.has(order.manager)||order.testOnly||!author||!Number.isFinite(Date.parse(author.at)))continue;
  const day=moscowDate.format(new Date(author.at));if(from&&day<from||to&&day>to)continue;
  let row=rows.get(author.id);if(!row){row={id:author.id,label:author.name,confirmed:0,cancelled:0,sent:0,paid:0,returned:0,waiting:0,orders:[]};rows.set(author.id,row);}
  row.confirmed++;row[confirmationOutcome(order)]++;row.orders.push(order);
 }
 return [...rows.values()];
}

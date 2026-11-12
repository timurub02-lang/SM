import {hasActiveOrder,total,type Client,type Order,type State} from './crm.ts';
import {clientRetentionLabel,clientRetentionExpiring} from './client-retention-label.ts';
export type ClientListSummary={count:number;amount:number;rate:number|null;active:boolean;latest?:Pick<Order,'contact'|'due'|'reason'|'status'>;retention:string;expiring:boolean;work?:NonNullable<State['clientWork']>[number];reminders:NonNullable<State['clientReminders']>};
export function clientListSummaries(state:State,clients:Client[],now=Date.now()):Record<string,ClientListSummary>{
 const wanted=new Set(clients.map(c=>c.id)),byClient=new Map<string,Order[]>();
 for(const o of state.orders)if(wanted.has(o.clientId)){const list=byClient.get(o.clientId)||[];list.push(o);byClient.set(o.clientId,list);}
 return Object.fromEntries(clients.map(c=>{
  const orders=byClient.get(c.id)||[],closed=orders.filter(o=>['redeemed','returned'].includes(o.status)),done=closed.filter(o=>o.status==='redeemed'),active=hasActiveOrder(orders,c.id);
  const latest=orders.filter(o=>!['redeemed','returned','refused'].includes(o.status)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  return [c.id,{count:orders.length,amount:done.reduce((sum,o)=>sum+total(o),0),rate:closed.length?Math.round(done.length/closed.length*100):null,active,latest:latest?{contact:latest.contact,due:latest.due,reason:latest.reason,status:latest.status}:undefined,retention:clientRetentionLabel(c,orders,now,state.retentionPreview?.[c.id]),expiring:clientRetentionExpiring(c,active,now,state.retentionPreview?.[c.id]),work:state.clientWork?.find(w=>w.clientId===c.id),reminders:(state.clientReminders||[]).filter(r=>r.clientId===c.id)}];
 }));
}

import {total,type Client,type Order} from './crm.ts';
import {clientHistoryEntries} from './client-order-history.ts';
import type {ActivityDb} from './activity-store.ts';
export function releasedClientStats(client:Client,orders:Order[]){
 const history=clientHistoryEntries(client.legacyOrderHistory||[],orders),paid=orders.filter(o=>o.status==='redeemed'),oldPaid=history.filter(o=>o.status==='paid');
 return {purchases:paid.length+oldPaid.length,purchaseAmount:Math.round((paid.reduce((n,o)=>n+total(o),0)+oldPaid.reduce((n,o)=>n+o.amount,0))*100)/100,returns:orders.filter(o=>o.status==='returned').length+history.filter(o=>o.status==='returned').length};
}
export async function releasedStats(d:ActivityDb,clients:Client[]){
 const result:Record<string,ReturnType<typeof releasedClientStats>>={};
 for(let offset=0;offset<clients.length;offset+=100){
  const part=clients.slice(offset,offset+100),rows:{data:string}[]=(await d.prepare(`SELECT data FROM orders WHERE client_id IN (${part.map(()=>'?').join(',')})`).bind(...part.map(c=>c.id)).all()).results;
  const orders=rows.map(r=>JSON.parse(r.data) as Order);
  for(const c of part)result[c.id]=releasedClientStats(c,orders.filter(o=>o.clientId===c.id));
 }
 return result;
}

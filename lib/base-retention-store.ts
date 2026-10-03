import type {ActivityDb as Db} from './activity-store.ts';
import {clientSheet,applyRetention,finalNoAnswerDeadline,reworkDeadlineFrom,type Client,type Order,type Event} from './crm.ts';
import {baseSettingsSchema,initialBaseSettings} from './base-policy.ts';
import {previousThreeMonths,repeatSales,retentionDays} from './base-distribution.ts';
const json=JSON.stringify;
export async function reconcileOrderTimers(d:Db,orders:Order[],events:Event[]){
  let orderChanged=false;
  for(const o of orders.filter(o=>o.status==="rework"||(o.finalHandoffAt&&["confirm","extra"].includes(o.status)))){
   if(o.status==="rework"&&o.reworkHours===null||o.status!=="rework"&&o.finalConfirmHours===null)continue;
   const received=events.find(e=>e.orderId===o.id&&e.text.includes("→ Возврат оператору"))?.at||o.updatedAt;
   const finalMissed=o.status!=="rework";
   const deadline=finalMissed?finalNoAnswerDeadline(o,o.contact,new Date().toISOString())!:(o.reworkDeadline||reworkDeadlineFrom(received,o.reworkHours===undefined?96:o.reworkHours));
   if(!deadline)continue;
   const expired=Date.now()>=Date.parse(deadline);
   if((finalMissed?o.noAnswerDeadline===deadline:!!o.reworkDeadline)&&!expired)continue;
   const expiryReason=finalMissed?`Истёк срок финального подтверждения: ${o.finalConfirmHours??24} ч`:`Истёк срок доработки после возврата логистом: ${o.reworkHours??96} ч`;
   const at=new Date().toISOString(),mutation=crypto.randomUUID();
   const next={...o,...(finalMissed?{noAnswerDeadline:deadline}:{}),reworkDeadline:finalMissed?o.reworkDeadline:deadline,returnReason:o.returnReason||o.reason,_mutation:mutation,...(expired?{status:"refused",cancelledAt:o.cancelledAt||deadline,updatedAt:at,contact:"none",due:"",reason:expiryReason}:{})};
   const e:Event={id:"EV-"+crypto.randomUUID(),clientId:o.clientId,orderId:o.id,at,actor:"Система",text:"Заказ отменён: "+expiryReason};
   const results=await d.batch([d.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=?").bind(json(next),o.id,o.version),...(expired?[d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(e.id,e.clientId,e.orderId,at,json(e),o.id,mutation)]:[])]);
   orderChanged=orderChanged||!!results[0].meta.changes;
  }
 return orderChanged;
}
export async function reconcileClients(d:Db,clients:Client[],orders:Order[]){

  let changed=false;
  const baseConfigRow=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first();const baseConfig=baseSettingsSchema.parse(baseConfigRow?JSON.parse(baseConfigRow.data).config:initialBaseSettings());const period=baseConfig.retention.from&&baseConfig.retention.to?baseConfig.retention:previousThreeMonths();const sales=repeatSales(orders,period.from,period.to);
  const byClient=new Map<string,Order[]>();for(const order of orders){const group=byClient.get(order.clientId)||[];group.push(order);byClient.set(order.clientId,group);}
  for(const c of clients){
   const related=byClient.get(c.id)||[];
   const next=applyRetention(c,related,Date.now(),retentionDays(baseConfig.retention.operators[c.owner],sales[c.owner]?.percent));
   if(JSON.stringify(next)===JSON.stringify(c))continue;
   const at=new Date().toISOString();const eid="EV-"+crypto.randomUUID();
   const event:Event={id:eid,clientId:c.id,orderId:"",at,actor:"Система",text:next.owner?"Правило К · закрепление обновлено":"Правило К · откреплён, возвращён в "+(clientSheet(next)||"исходную базу")};
   const guard=" AND (SELECT COUNT(*) FROM orders WHERE client_id=?)=?"+related.map(()=>" AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)").join("");
   const args=[c.id,related.length,...related.flatMap(o=>[o.id,o.version])];
   const result=await d.batch([
    d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?"+guard+")").bind(eid,c.id,"",at,json(event),c.id,c.version,...args),
    d.prepare("UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=?"+guard).bind(json(next),c.id,c.version,...args)
   ]);
   changed=changed||!!result[1].meta.changes;
  }
 return changed;
}

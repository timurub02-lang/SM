import {courierDeadline,courierToOperator,cancelCourierWork} from './courier.ts';
import {courierReminderStatements} from './reminder-store.ts';
import type {ActivityDb as Db} from './activity-store.ts';
import {clientSheet,applyRetention,draftDeadline,confirmationDeadline,reworkDeadlineFrom,type Client,type Order,type Event} from './crm.ts';
import {baseSettingsSchema,initialBaseSettings} from './base-policy.ts';
import {previousThreeMonths,repeatSales,retentionDays} from './base-distribution.ts';
import {defaultOrderPolicy,orderPolicySchema} from './order-policy.ts';
const json=JSON.stringify;
export async function reconcileOrderTimers(d:Db,orders:Order[],events:Event[]){
  let orderChanged=false;
  const saved=await d.prepare("SELECT data FROM settings WHERE id='order-policy'").first();
  const policy=orderPolicySchema.parse(saved?JSON.parse(saved.data).policy:defaultOrderPolicy);
  for(const stored of orders.filter(o=>["draft","rework","confirm","extra"].includes(o.status)||courierDeadline(o)||o.delivery==='moscow_courier'&&o.courier?.phase==='logistic'&&!['redeemed','returned','refused'].includes(o.status))){
   // Retire the old work queue without changing physical custody or resetting the operator budget.
   const migrateCourier=stored.delivery==='moscow_courier'&&stored.courier?.phase==='logistic';
   // Existing untimed confirmations receive a full window once, instead of retroactive cancellation.
   const initialize=["confirm","extra"].includes(stored.status)&&!stored.finalHandoffAt&&!stored.confirmationStartedAt;
   const at=new Date().toISOString();
   const o=initialize?{...stored,confirmationStartedAt:at,confirmationHours:stored.status==="extra"?policy.extraConfirmationHours:policy.confirmationHours}:stored;
   const received=events.find(e=>e.orderId===o.id&&e.text.includes("→ Возврат оператору"))?.at||o.updatedAt;
   const courierDue=courierDeadline(o);
   const draft=o.status==="draft",confirmation=["confirm","extra"].includes(o.status);
   const deadline=courierDue|| (draft?draftDeadline(o):confirmation?confirmationDeadline(o):o.reworkHours===null?undefined:(o.reworkDeadline||reworkDeadlineFrom(received,o.reworkHours??96)));
   const expired=!!deadline&&Date.now()>=Date.parse(deadline);
   if(!migrateCourier&&!initialize&&(!deadline||!expired&&(!!courierDue||draft||(confirmation?o.noAnswerDeadline===deadline:!!o.reworkDeadline))))continue;
   const expiryReason=migrateCourier?(o.courier!.workReason||o.reason||"Передача работы от курьера"):courierDue?`Истёк срок подтверждения курьером: ${o.courier?.workHours??48} ч`:draft?`Истёк срок оформления до первой передачи логисту: ${o.draftHours??24} ч`:confirmation?(o.finalHandoffAt?`Истёк срок финального подтверждения: ${o.finalConfirmHours??24} ч`:`Истёк срок ${o.status==="extra"?"повторного":"первого"} подтверждения: ${o.confirmationHours??48} ч`):`Истёк срок доработки после возврата логистом: ${o.reworkHours??96} ч`;
   const mutation=crypto.randomUUID();
   let next:Order & {_mutation:string}={...o,...(confirmation?{noAnswerDeadline:deadline}:{}),reworkDeadline:draft||confirmation?o.reworkDeadline:deadline,returnReason:o.returnReason||o.reason,_mutation:mutation,...(expired?{status:"refused",cancelledAt:o.cancelledAt||deadline,updatedAt:at,contact:"none",due:"",reason:expiryReason}:{})};
   const backToOperator=migrateCourier||expired&&(!!courierDue||o.delivery==='moscow_courier'&&confirmation&&!o.finalHandoffAt);
   if(backToOperator){
    if(o.courier)next={...courierToOperator(o,expiryReason,policy,at),_mutation:mutation};
    else{next={...o,status:'rework',contact:'none',due:'',reason:expiryReason,returnReason:expiryReason,reworkHours:policy.reworkHours,reworkDeadline:reworkDeadlineFrom(at,policy.reworkHours),updatedAt:at,_mutation:mutation};delete next.noAnswerDeadline;}
   }else if(expired)cancelCourierWork(next,at);
   const e:Event={id:"EV-"+crypto.randomUUID(),clientId:o.clientId,orderId:o.id,at,actor:"Система",text:migrateCourier?"Заказ передан оператору из упразднённой очереди логиста · "+expiryReason:backToOperator?"Заказ передан оператору: "+expiryReason:expired?"Заказ отменён: "+expiryReason:`Включён таймер ${o.status==="extra"?"повторного":"первого"} подтверждения для существующего заказа: ${o.confirmationHours} ч`};
   const notices=(migrateCourier||expired)&&next.courier?await courierReminderStatements(d,o,next,e,mutation,(await d.prepare('SELECT data FROM employees').all()).results.map((r:{data:string})=>JSON.parse(r.data))):[];
   const results=await d.batch([d.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=?").bind(json(next),o.id,o.version),...(migrateCourier||expired||initialize&&deadline?[d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(e.id,e.clientId,e.orderId,at,json(e),o.id,mutation)]:[]),...notices]);
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

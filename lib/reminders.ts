import {courierDeadline,courierStage} from './courier.ts';
import {defaultOrderPolicy} from './order-policy.ts';
import {draftDeadline,scheduledCalls,callAuthor,type State,type Employee,type Client} from './crm';
import {db} from './db';
import {initReminderStore} from './reminder-store.ts';
import {seesOrder,ownsClient} from './permissions';
export type Reminder={kind?:"call"|"draft"|"order-decision"|"cdek-deletion"|"courier"|"courier-warning"|"courier-delivery";decision?:"approved"|"rejected";resolved?:boolean;id:string;clientId:string;orderId?:string;requestId?:string;title:string;text:string;at:string;due?:string;readAt?:string};
export async function initReminders(){await initReminderStore(db());}
export function orderDecisionReminder(c:Client,staff:Employee[]):Reminder|null{
 const request=c.orderRequest;if(!request||request.status==='pending')return null;
 const author=staff.find(e=>e.id===request.decidedBy)?.name;
 return {kind:'order-decision',decision:request.status,id:'decision:'+request.id,requestId:request.id,clientId:c.id,title:request.status==='approved'?'Дополнительный заказ разрешён':'Запрос на дополнительный заказ отклонён',text:c.name+(author?' · Решение: '+author:''),at:request.decidedAt||request.at};
}
export async function saveReminders(s:State){
 const d=db();await initReminders();
 const writes=[];
 for(const e of s.employees){
  const calls:Reminder[]=scheduledCalls(s.orders,e).map(o=>({kind:"call",id:`call:${o.id}:${o.due}`,orderId:o.id,clientId:o.clientId,title:s.clients.find(c=>c.id===o.clientId)?.name||o.id,text:(o.contact==='missed'?'Недозвон — повторная попытка':'Перезвон')+(o.reason?' · '+o.reason:'')+(callAuthor(o,s.employees)?' · Кто назначил: '+callAuthor(o,s.employees):''),at:o.contactAuthor?.at||o.updatedAt,due:o.due}));
  const drafts:Reminder[]=e.role==='operator'?s.orders.filter(o=>o.manager===e.id&&draftDeadline(o)).map(o=>({kind:'draft',id:`draft:${o.id}:${draftDeadline(o)}`,orderId:o.id,clientId:o.clientId,title:s.clients.find(c=>c.id===o.clientId)?.name||o.id,text:'Передайте заказ логисту',at:o.createdAt,due:draftDeadline(o)})):[];
  const courierNotices:Reminder[]=[];
  for(const o of s.orders){
   if(!o.courier||!(e.id===o.courier.id||['admin','logistic','chief_logistic'].includes(e.role)))continue;
   const deadline=courierDeadline(o),warning=(s.settings.orderPolicy||defaultOrderPolicy).courierWarningHours;
   if(deadline&&Date.now()>=Date.parse(deadline)-warning*3600000)courierNotices.push({kind:'courier-warning',id:`courier-warning:${o.id}:${deadline}`,orderId:o.id,clientId:o.clientId,title:'Заказ скоро вернётся оператору',text:o.id+' · срок подтверждения подходит к концу',at:new Date(Date.parse(deadline)-warning*3600000).toISOString(),due:deadline});
   const date=o.courier.postponement;
   if(date?.state==='approved'&&courierStage(o)==='delivery'&&Date.now()>=Date.parse(date.at))courierNotices.push({kind:'courier-delivery',id:`courier-delivery:${o.id}:${date.at}`,orderId:o.id,clientId:o.clientId,title:'Наступило согласованное время доставки',text:o.id+' · '+date.reason+' · Согласовал: '+date.name,at:date.at,due:date.at});
  }
  const requests:Reminder[]=s.clients.filter(c=>c.orderRequest?.status==='pending'&&(e.role==='admin'||e.role==='department_head'&&!!e.department&&c.orderRequest.department===e.department)).map(c=>({id:'request:'+c.orderRequest!.id,requestId:c.orderRequest!.id,clientId:c.id,title:'Запрос на повторный заказ',text:c.name+' · '+(s.employees.find(x=>x.id===c.orderRequest!.manager)?.login||''),at:c.orderRequest!.at}));
  const decisions=s.clients.filter(c=>c.orderRequest?.actorId===e.id).map(c=>orderDecisionReminder(c,s.employees)).filter((r):r is Reminder=>!!r);
  for(const r of [...calls,...drafts,...requests,...decisions,...courierNotices])writes.push(d.prepare(r.kind==='call'?'INSERT INTO reminders(employee_id,id,data,at) VALUES(?,?,?,?) ON CONFLICT(employee_id,id) DO UPDATE SET data=excluded.data,at=excluded.at WHERE excluded.at>=reminders.at':'INSERT OR IGNORE INTO reminders(employee_id,id,data,at) VALUES(?,?,?,?)').bind(e.id,r.id,JSON.stringify(r),r.at));
  writes.push(d.prepare('DELETE FROM reminders WHERE employee_id=? AND id NOT IN (SELECT id FROM reminders WHERE employee_id=? ORDER BY at DESC,id DESC LIMIT 20)').bind(e.id,e.id));
 }
 if(writes.length)await d.batch(writes);
}
export async function employeeReminders(s:State,e:Employee){
 const activeCalls=new Set(scheduledCalls(s.orders,e).map(o=>`call:${o.id}:${o.due}`));
 const rows=await db().prepare('SELECT data,read_at FROM reminders WHERE employee_id=? ORDER BY at DESC,id DESC').bind(e.id).all<{data:string;read_at:string|null}>();
 return rows.results.map(r=>({...JSON.parse(r.data),readAt:r.read_at||undefined}) as Reminder).filter(r=>{
  if(r.kind==='cdek-deletion'&&!['admin','chief_logistic'].includes(e.role))return false;
  if(r.orderId){const o=s.orders.find(o=>o.id===r.orderId);return !!o&&seesOrder(e,o,s.employees);}
  const c=s.clients.find(c=>c.id===r.clientId);return !!c&&ownsClient(e,c,s.employees);
 }).map(r=>{
  if(r.id.startsWith('call:'))return {...r,resolved:!activeCalls.has(r.id)};
  if(r.kind==='courier-warning')return {...r,resolved:courierDeadline(s.orders.find(o=>o.id===r.orderId)!)!==r.due};
  if(r.kind==='courier-delivery'){const o=s.orders.find(o=>o.id===r.orderId)!;return {...r,resolved:courierStage(o)!=='delivery'||o.courier?.postponement?.state!=='approved'||o.courier.postponement.at!==r.due};}
  if(r.kind!=='draft')return r;
  const order=s.orders.find(o=>o.id===r.orderId)!;const resolved=draftDeadline(order)!==r.due;
  return {...r,resolved,...(resolved?{text:order.status==='refused'?'Заказ отменён':order.status==='draft'?'Напоминание больше не актуально':'Заказ передан логисту'}:{})};
 });
}

import {courierDoorRefusal,courierDoorPhase,courierDoorNoticeId,canHandleCourierDoor,courierDeadline,courierStage,courierPendingAction,courierReminderNeedsAction} from './courier.ts';
import {defaultOrderPolicy} from './order-policy.ts';
import {draftDeadline,scheduledCalls,callAuthor,type State,type Employee,type Client} from './crm';
import {db} from './db';
import {initReminderStore} from './reminder-store.ts';
import {seesOrder,ownsClient} from './permissions';
export type Reminder={kind?:"task"|"call"|"draft"|"order-decision"|"cdek-deletion"|"courier"|"courier-door"|"courier-receipt"|"courier-warning"|"courier-delivery";decision?:"approved"|"rejected";resolved?:boolean;id:string;clientId:string;orderId?:string;requestId?:string;title:string;text:string;at:string;due?:string;readAt?:string};
export async function initReminders(){await initReminderStore(db());}
export function orderDecisionReminder(c:Client,staff:Employee[]):Reminder|null{
 const request=c.orderRequest;if(!request||request.status==='pending')return null;
 const author=staff.find(e=>e.id===request.decidedBy)?.name;
 return {kind:'order-decision',decision:request.status,id:'decision:'+request.id,requestId:request.id,clientId:c.id,title:request.status==='approved'?'Дополнительный заказ разрешён':'Запрос на дополнительный заказ отклонён',text:c.name+(author?' · Решение: '+author:''),at:request.decidedAt||request.at};
}
function activeReminder(r:Reminder,s:State,e:Employee){
 const o=s.orders.find(o=>o.id===r.orderId);
 if(r.kind==='courier-door')return !!o&&r.id===courierDoorNoticeId(o);
 if(e.role==='courier')return courierReminderNeedsAction(r,o);
 if(r.kind==='call')return scheduledCalls(o?[o]:[],e,s.employees).some(o=>o.due===r.due);
 if(r.kind==='draft')return !!o&&e.id===o.manager&&draftDeadline(o)===r.due;
 if(r.requestId)return s.clients.some(c=>c.orderRequest?.id===r.requestId&&c.orderRequest?.status==='pending');
 if(r.kind==='courier'&&o?.status==='rework'&&!o.courier&&o.courierRecall?.operatorStartedAt)return (e.id===o.manager||e.role==='admin'||e.role==='department_head'&&s.employees.some(x=>x.id===o.manager&&!!e.department&&x.department===e.department))&&Date.parse(r.at)>=Date.parse(o.courierRecall.operatorStartedAt);
 if(r.kind==='courier'&&o?.courierRepackRequest&&!o.courierRepackRequest.completedAt&&Date.parse(r.at)>=Date.parse(o.courierRepackRequest.at)){
  if(o.courier?.phase==='operator'&&['admin','logistic','chief_logistic'].includes(e.role))return true;
  if(!o.courier&&o.status==='packing'&&(e.id===o.manager||e.role==='admin'))return true;
 }
 if(r.kind==='courier'&&o?.courier?.phase==='operator'&&o.status==='rework')return (e.id===o.manager||e.role==='admin'||e.role==='department_head'&&s.employees.some(x=>x.id===o.manager&&!!e.department&&x.department===e.department))&&Date.parse(r.at)>=Date.parse(o.courier.operatorStartedAt||'');
 if(r.kind==='courier'&&o?.courier?.phase==='recall_returned'&&['admin','logistic','chief_logistic'].includes(e.role))return Date.parse(r.at)>=Date.parse(o.courier.recall?.returnedAt||'');
 if(r.kind==='courier-warning')return !!o&&courierDeadline(o)===r.due;
 if(r.kind==='courier-delivery')return !!o&&courierStage(o)==='delivery'&&o.courier?.postponement?.state==='approved'&&o.courier.postponement.at===r.due;
 return false;
}
export async function saveReminders(s:State){
 const d=db();await initReminders();
 const writes=[];
 const saved=(await d.prepare('SELECT employee_id,data,read_at FROM reminders').all<{employee_id:string;data:string;read_at:string|null}>()).results;
 const stored=new Map<string,Reminder[]>();
 for(const row of saved){const list=stored.get(row.employee_id)||[];list.push({...JSON.parse(row.data),readAt:row.read_at||undefined});stored.set(row.employee_id,list);}
 for(const e of s.employees){
  const calls:Reminder[]=scheduledCalls(s.orders,e,s.employees).map(o=>({kind:"call",id:`call:${o.id}:${o.due}`,orderId:o.id,clientId:o.clientId,title:s.clients.find(c=>c.id===o.clientId)?.name||o.id,text:(o.contact==='missed'?'Недозвон — повторная попытка':'Перезвон')+(o.reason?' · '+o.reason:'')+(callAuthor(o,s.employees)?' · Кто назначил: '+callAuthor(o,s.employees):''),at:o.contactAuthor?.at||o.updatedAt,due:o.due}));
  const drafts:Reminder[]=e.role==='operator'?s.orders.filter(o=>o.manager===e.id&&draftDeadline(o)).map(o=>({kind:'draft',id:`draft:${o.id}:${draftDeadline(o)}`,orderId:o.id,clientId:o.clientId,title:s.clients.find(c=>c.id===o.clientId)?.name||o.id,text:'Передайте заказ логисту',at:o.createdAt,due:draftDeadline(o)})):[];
  const existing=stored.get(e.id)||[];
  const courierNotices:Reminder[]=[];
  for(const o of s.orders){
   const door=courierDoorRefusal(o);
   if(door&&(canHandleCourierDoor(o,e,s.employees)||e.id===o.courier?.id)){
    const phase=courierDoorPhase(o),late=phase==='decision-overdue'||phase==='claim-overdue';
    courierNotices.push({kind:'courier-door',id:courierDoorNoticeId(o),orderId:o.id,clientId:o.clientId,title:phase==='decision-overdue'?'СРОЧНО: курьер у двери — решение задерживается':phase==='claim-overdue'?'СРОЧНО: отказ у двери ещё не взят в работу':door.claimedAt?'Отказ у двери · обращение взято в работу':'СРОЧНО: отказ у двери · курьер ждёт',text:(door.claimedName?'В работе: '+door.claimedName:'Ожидается ответ оператора')+' · '+o.courier!.workReason+(late?' · Требуется помощь руководителя или администратора':''),at:phase==='decision-overdue'?(o.reworkDeadline&&o.reworkDeadline<door.decisionDueAt?o.reworkDeadline:door.decisionDueAt):phase==='claim-overdue'?door.claimDueAt:door.claimedAt||door.at,due:door.decisionDueAt});
   }
   if(!o.courier||!(e.id===o.courier.id||['admin','logistic','chief_logistic'].includes(e.role)))continue;
   const action=e.id===o.courier.id?courierPendingAction(o):undefined;
   if(action&&!existing.some(r=>r.kind==='courier'&&r.orderId===o.id&&courierReminderNeedsAction(r,o)))courierNotices.push({kind:'courier',id:`courier-task:${o.id}:${courierStage(o)}:${action.at}`,orderId:o.id,clientId:o.clientId,title:action.title,text:o.id,at:action.at});
   const deadline=courierDeadline(o),warning=(s.settings.orderPolicy||defaultOrderPolicy).courierWarningHours;
   if(deadline&&Date.now()>=Date.parse(deadline)-warning*3600000)courierNotices.push({kind:'courier-warning',id:`courier-warning:${o.id}:${deadline}`,orderId:o.id,clientId:o.clientId,title:'Заказ скоро вернётся оператору',text:o.id+' · срок подтверждения подходит к концу',at:new Date(Date.parse(deadline)-warning*3600000).toISOString(),due:deadline});
   const date=o.courier.postponement;
   if(date?.state==='approved'&&courierStage(o)==='delivery'&&Date.now()>=Date.parse(date.at))courierNotices.push({kind:'courier-delivery',id:`courier-delivery:${o.id}:${date.at}`,orderId:o.id,clientId:o.clientId,title:'Наступило согласованное время доставки',text:o.id+' · '+date.reason+' · Согласовал: '+date.name,at:date.at,due:date.at});
  }
  const requests:Reminder[]=s.clients.filter(c=>c.orderRequest?.status==='pending'&&(e.role==='admin'||e.role==='department_head'&&!!e.department&&c.orderRequest.department===e.department)).map(c=>({id:'request:'+c.orderRequest!.id,requestId:c.orderRequest!.id,clientId:c.id,title:'Запрос на повторный заказ',text:c.name+' · '+(s.employees.find(x=>x.id===c.orderRequest!.manager)?.login||''),at:c.orderRequest!.at}));
  const decisions=s.clients.filter(c=>c.orderRequest?.actorId===e.id).map(c=>orderDecisionReminder(c,s.employees)).filter((r):r is Reminder=>!!r);
  const generated=[...calls,...drafts,...requests,...decisions,...courierNotices];
  for(const r of generated)writes.push(d.prepare(r.kind==='call'?'INSERT INTO reminders(employee_id,id,data,at) VALUES(?,?,?,?) ON CONFLICT(employee_id,id) DO UPDATE SET data=excluded.data,at=excluded.at WHERE excluded.at>=reminders.at':'INSERT OR IGNORE INTO reminders(employee_id,id,data,at) VALUES(?,?,?,?)').bind(e.id,r.id,JSON.stringify(r),r.at));
  // Keep every current task, plus 20 history records. Only prune the inspected snapshot.
  const combined=new Map([...existing,...generated].map(r=>[r.id,r]));
  const expired=[...combined.values()].filter(r=>!activeReminder(r,s,e)).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id)).slice(20).map(r=>r.id);
  if(expired.length)writes.push(d.prepare('DELETE FROM reminders WHERE employee_id=? AND id IN (SELECT value FROM json_each(?))').bind(e.id,JSON.stringify(expired)));
 }
 if(writes.length)await d.batch(writes);
}
export async function employeeReminders(s:State,e:Employee){
 const activeCalls=new Set(scheduledCalls(s.orders,e,s.employees).map(o=>`call:${o.id}:${o.due}`));
 const rows=await db().prepare('SELECT data,read_at FROM reminders WHERE employee_id=? ORDER BY at DESC,id DESC').bind(e.id).all<{data:string;read_at:string|null}>();
 return rows.results.map(r=>({...JSON.parse(r.data),readAt:r.read_at||undefined}) as Reminder).filter(r=>{
  // A personal receipt remains available after recall removes the courier's access to the order.
  if(r.kind==='courier-receipt')return e.role==='courier';
  if(r.kind==='cdek-deletion'&&!['admin','chief_logistic'].includes(e.role))return false;
  if(r.orderId){const o=s.orders.find(o=>o.id===r.orderId);return !!o&&seesOrder(e,o,s.employees);}
  const c=s.clients.find(c=>c.id===r.clientId);return !!c&&ownsClient(e,c,s.employees);
 }).map(r=>{
  if(r.id.startsWith('call:'))return {...r,resolved:!activeCalls.has(r.id)};
  if(r.kind==='courier-door'){const o=s.orders.find(o=>o.id===r.orderId);return {...r,resolved:!o||r.id!==courierDoorNoticeId(o)};}
  if(r.kind==='courier-warning')return {...r,resolved:courierDeadline(s.orders.find(o=>o.id===r.orderId)!)!==r.due};
  if(r.kind==='courier-delivery'){const o=s.orders.find(o=>o.id===r.orderId)!;return {...r,resolved:courierStage(o)!=='delivery'||o.courier?.postponement?.state!=='approved'||o.courier.postponement.at!==r.due};}
  if(r.kind!=='draft')return r;
  const order=s.orders.find(o=>o.id===r.orderId)!;const resolved=draftDeadline(order)!==r.due;
  return {...r,resolved,...(resolved?{text:order.status==='refused'?'Заказ отменён':order.status==='draft'?'Напоминание больше не актуально':'Заказ передан логисту'}:{})};
 });
}

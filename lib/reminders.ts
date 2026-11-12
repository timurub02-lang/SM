import {maintainReminders} from './reminder-maintenance';
import {courierDoorNoticeId,courierDeadline,courierStage} from './courier.ts';
import {draftDeadline,scheduledCalls,type State,type Employee} from './crm';
import {db} from './db';
import {initReminderStore} from './reminder-store.ts';
import {seesOrder,ownsClient} from './permissions';
export type Reminder={incomingId?:string;kind?:"order-paid"|"order-cancellation"|"incoming"|"task"|"call"|"draft"|"order-decision"|"cdek-deletion"|"courier"|"courier-door"|"courier-receipt"|"courier-warning"|"courier-delivery";decision?:"approved"|"rejected";resolved?:boolean;id:string;clientId:string;orderId?:string;requestId?:string;title:string;text:string;at:string;due?:string;readAt?:string};
export async function initReminders(){await initReminderStore(db());}
export {orderDecisionReminder} from './reminder-maintenance';
export async function saveReminders(s:State,employeeId?:string,clientId?:string){return maintainReminders(db(),s,employeeId,clientId);}
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
  if(r.kind==='order-cancellation'){const o=s.orders.find(o=>o.id===r.orderId);return {...r,resolved:o?.cancellationRequest?.status!=='pending'||r.id!==`cancel:${o.cancellationRequest.id}:pending`};}
  if(r.id.startsWith('call:'))return {...r,resolved:!activeCalls.has(r.id)};
  if(r.kind==='courier-door'){const o=s.orders.find(o=>o.id===r.orderId);return {...r,resolved:!o||r.id!==courierDoorNoticeId(o)};}
  if(r.kind==='courier-warning')return {...r,resolved:courierDeadline(s.orders.find(o=>o.id===r.orderId)!)!==r.due};
  if(r.kind==='courier-delivery'){const o=s.orders.find(o=>o.id===r.orderId)!;return {...r,resolved:courierStage(o)!=='delivery'||o.courier?.postponement?.state!=='approved'||o.courier.postponement.at!==r.due};}
  if(r.kind!=='draft')return r;
  const order=s.orders.find(o=>o.id===r.orderId)!;const resolved=draftDeadline(order)!==r.due;
  return {...r,resolved,...(resolved?{text:order.status==='refused'?'Заказ отменён':order.status==='draft'?'Напоминание больше не актуально':'Заказ передан логисту'}:{})};
 });
}

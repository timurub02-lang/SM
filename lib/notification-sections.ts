import type {Reminder} from './reminders.ts';
export type NotificationTab='tasks'|'planned'|'events'|'incoming'|'paid'|'acknowledge';
export const isIncomingNotification=(r:Reminder)=>r.kind==='incoming'||r.id.startsWith('task:incoming:');
export function notificationSections(tasks:Reminder[],events:Reminder[],now=Date.now(),head=false,admin=false){
 const future=(r:Reminder)=>r.kind==='call'&&!!r.due&&Date.parse(r.due)>now;
 const planned=tasks.filter(future).filter(r=>!head||!events.some(e=>e.id===`call:${r.orderId}:${r.due}`&&e.acknowledgedAt));
 const incoming=tasks.filter(isIncomingNotification);
 return {acknowledge:admin?events.filter(r=>r.kind==='cash-change'&&!r.acknowledgedAt):[],planned,paid:events.filter(r=>r.kind==='order-paid').slice(0,20),tasks:[...tasks.filter(r=>!isIncomingNotification(r)&&!future(r)),...events.filter(r=>!admin&&r.kind==='cash-change'&&!r.acknowledgedAt||r.id==='task:return-reconciliation-batch')],incoming:[...incoming,...events.filter(isIncomingNotification).filter(r=>!incoming.some(t=>t.id===r.id||!!r.incomingId&&r.incomingId===t.incomingId))],events:events.filter(r=>!isIncomingNotification(r)&&r.kind!=='cash-change'&&r.id!=='task:return-reconciliation-batch').slice(0,20)};
}
export function notificationPopupTab(fresh:Reminder[],tasks:Reminder[]):NotificationTab{
 if(fresh.length&&fresh.every(r=>r.kind==='cash-change'))return 'acknowledge';
 if(fresh.every(isIncomingNotification))return 'incoming';
 return fresh.some(r=>r.kind==='cash-change'||r.id==='task:return-reconciliation-batch'||!isIncomingNotification(r)&&tasks.some(t=>t.id===r.id))?'tasks':'events';
}

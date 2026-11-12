import type {Reminder} from './reminders.ts';
export type NotificationTab='tasks'|'events'|'incoming';
export const isIncomingNotification=(r:Reminder)=>r.kind==='incoming'||r.id.startsWith('task:incoming:');
export function notificationSections(tasks:Reminder[],events:Reminder[]){
 const incoming=tasks.filter(isIncomingNotification);
 return {tasks:tasks.filter(r=>!isIncomingNotification(r)),incoming:[...incoming,...events.filter(isIncomingNotification).filter(r=>!incoming.some(t=>t.id===r.id||!!r.incomingId&&r.incomingId===t.incomingId))],events:events.filter(r=>!isIncomingNotification(r)).slice(0,20)};
}
export function notificationPopupTab(fresh:Reminder[],tasks:Reminder[]):NotificationTab{
 if(fresh.every(isIncomingNotification))return 'incoming';
 return fresh.some(r=>!isIncomingNotification(r)&&tasks.some(t=>t.id===r.id))?'tasks':'events';
}

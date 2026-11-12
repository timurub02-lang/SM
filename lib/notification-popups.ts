import type {Reminder} from './reminders.ts';

export function popupNotifications(tasks:Reminder[],events:Reminder[]){
 const ordinary=(r:Reminder)=>!r.resolved&&!['call','courier-door'].includes(r.kind||'');
 const active=tasks.filter(ordinary);
 return [...active,...events.filter(r=>ordinary(r)&&!r.readAt&&(r.kind==='order-paid'||!tasks.some(t=>r.orderId?t.orderId===r.orderId:t.clientId===r.clientId)))];
}

// The first loaded snapshot is a baseline, so entering or refreshing CRM never replays old work.
export class NotificationPopups {
 private actor='';
 private previous:Set<string>|null=null;
 update(actor:string,notifications:Reminder[]){
  if(this.actor!==actor){this.actor=actor;this.previous=null;}
  const current=new Set(notifications.map(r=>r.id));
  const fresh=this.previous?notifications.filter(r=>!this.previous!.has(r.id)):[];
  this.previous=current;
  return fresh;
 }
}

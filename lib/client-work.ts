import type {Client} from './crm.ts';
import type {ClientReminder} from './client-reminders.ts';
export const clientWorkLabels={reached:'Дозвонился',missed:'Недозвон',callback:'Перезвон'};
export type ClientWork={clientId:string;outcome:keyof typeof clientWorkLabels;at:string;version:number;comment?:string;author?:string;source?:'call'|'manual'|'incoming'};
export function clientWorkStatus(c:Client,work:ClientWork|undefined,reminders:ClientReminder[],now=Date.now()){
 const valid=(at:string)=>Number.isFinite(Date.parse(at))&&(!c.assignmentStartedAt||Date.parse(at)>=Date.parse(c.assignmentStartedAt));
 const last=work&&valid(work.at)?work:undefined;
 const pending=reminders.filter(r=>r.clientId===c.id&&valid(r.createdAt)&&Number.isFinite(Date.parse(r.due))).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
 const due=pending[0]?.due;
 const day=(at:number)=>new Date(at+10800000).toISOString().slice(0,10);
 const group=due?(Date.parse(due)<=now?'needed':'planned'):last&&day(Date.parse(last.at))===day(now)?'done':'needed';
 return {group,last,due,overdue:!!due&&Date.parse(due)<=now,expiresBeforeCall:!!due&&!!c.assignedUntil&&Date.parse(c.assignedUntil)<=Date.parse(due)};
}

// Today's missed calls go behind untouched clients; due reminders keep their priority.
export function clientWorkQueueOrder(c:Client,work:ClientWork|undefined,reminders:ClientReminder[],now=Date.now()){
 const s=clientWorkStatus(c,work,reminders,now);
 if(s.last?.outcome!=='missed'||s.overdue)return 0;
 const at=Date.parse(s.last.at);
 return new Date(at+10800000).toISOString().slice(0,10)===new Date(now+10800000).toISOString().slice(0,10)?at:0;
}

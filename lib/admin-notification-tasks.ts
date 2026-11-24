import type {ActivityDb} from './activity-store.ts';
import type {Reminder} from './reminders.ts';
import {replacementTasks} from './phone-replacement.ts';

export async function adminNotificationTasks(d:ActivityDb):Promise<Reminder[]>{
 const tasks=await replacementTasks(d);
 if(!await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sk_order_transfers'").first())return tasks;
 const pending=(await d.prepare("SELECT id,data,reason,created_at FROM sk_order_transfers WHERE state='pending' ORDER BY created_at DESC LIMIT 500").all()).results as {id:string;data:string;reason:string;created_at:string}[];
 return [...tasks,...pending.map(row=>({kind:'task' as const,id:'task:sk-permission:'+row.id,clientId:'',title:'Заказ из '+(JSON.parse(row.data).source==='CRMCalls'?'CRMCalls':'СК')+' требует разрешения',text:[JSON.parse(row.data).name,row.reason].filter(Boolean).join(' · '),at:row.created_at}))];
}

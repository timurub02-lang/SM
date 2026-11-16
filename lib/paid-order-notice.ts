import type {ActivityDb} from './activity-store.ts';
import {total,type Order} from './crm.ts';
import type {Reminder} from './reminders.ts';
import {initReminderStore} from './reminder-store.ts';

// Share the order mutation guard: a failed or repeated status update cannot send a notice.
export async function paidOrderNoticeStatements(d:ActivityDb,before:Order,after:Order,mutation:string,at:string){
 if(before.status==='redeemed'||after.status!=='redeemed'||after.testOnly)return [];
 await initReminderStore(d);
 const client=await d.prepare('SELECT data FROM clients WHERE id=?').bind(after.clientId).first();
 const name=client?JSON.parse(client.data).name:after.id;
 const notice={kind:'order-paid',id:'order-paid:'+after.id,clientId:after.clientId,orderId:after.id,title:'🎉 Клиент выкупил заказ!',text:`${name} · ${after.id} · ${total(after).toLocaleString('ru-RU')} ₽`,at};
 return [d.prepare(`INSERT OR IGNORE INTO reminders(employee_id,id,data,at)
 SELECT id,?,?,? FROM employees WHERE (id=? OR json_extract(data,'$.role')='admin' OR (json_extract(data,'$.role')='department_head' AND json_extract(data,'$.department')<>'' AND json_extract(data,'$.department')=(SELECT json_extract(data,'$.department') FROM employees WHERE id=?)))
 AND EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)`).bind(notice.id,JSON.stringify(notice),at,after.manager,after.manager,after.id,mutation)];
}

// Existing purchase events fill the admin tab without replaying old success popups.
export async function recentPaidOrderNotices(d:ActivityDb):Promise<Reminder[]>{
 const rows=(await d.prepare("SELECT data,MAX(at) AS at FROM reminders WHERE json_extract(data,'$.kind')='order-paid' GROUP BY id ORDER BY at DESC,id DESC LIMIT 20").all()).results as {data:string;at:string}[];
 return rows.map(r=>({...JSON.parse(r.data),readAt:r.at}));
}

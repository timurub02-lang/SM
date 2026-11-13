import type {ActivityDb} from './activity-store.ts';
import type {Client,Order,Event} from './crm.ts';
import {initReminderStore} from './reminder-store.ts';

// The event is inserted by the guarded mutation in the same batch; stale edits send nothing.
async function noticeStatements(d:ActivityDb,manager:string,event:Event,kind:'order-cancelled'|'client-released',title:string,text:string){
 if(!manager)return [];
 await initReminderStore(d);
 const notice={kind,id:kind+':'+event.id,clientId:event.clientId,orderId:event.orderId||undefined,title,text,at:event.at};
 return [d.prepare(`INSERT OR IGNORE INTO reminders(employee_id,id,data,at)
 SELECT id,?,?,? FROM employees WHERE (id=? AND json_extract(data,'$.role')='operator' OR json_extract(data,'$.role')='department_head' AND json_extract(data,'$.department')<>'' AND json_extract(data,'$.department')=(SELECT json_extract(data,'$.department') FROM employees WHERE id=?))
 AND EXISTS(SELECT 1 FROM events WHERE id=?)`).bind(notice.id,JSON.stringify(notice),event.at,manager,manager,event.id)];
}
export async function cancelledOrderNotices(d:ActivityDb,before:Order,after:Order,event:Event){
 if(before.status==='refused'||after.status!=='refused'||after.testOnly)return [];
 const row=await d.prepare('SELECT data FROM clients WHERE id=?').bind(after.clientId).first();
 const name=row?JSON.parse(row.data).name:after.clientId;
 return noticeStatements(d,after.manager,event,'order-cancelled','Заказ отменён',`${name} · ${after.id} · Причина: ${after.reason||event.text}`);
}
export async function releasedClientNotices(d:ActivityDb,before:Client,after:Client,event:Event,orders:Order[],reason:string){
 if(!before.owner||before.owner===after.owner)return [];
 const related=orders.filter(o=>o.clientId===before.id&&o.manager===before.owner&&!o.testOnly).map(o=>o.id);
 return noticeStatements(d,before.owner,event,'client-released','Клиент откреплён',`${before.name} · ${reason}${related.length?' · Заказы: '+related.join(', '):' · Без заказов'}`);
}

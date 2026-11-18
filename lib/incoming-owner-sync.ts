import type {ActivityDb} from './activity-store.ts';
import {initReminderStore} from './reminder-store.ts';

// Only a handoff explicitly recorded while the known client was free follows a new owner.
// Older handoffs have no such evidence and remain untouched.
export async function reconcileIncomingOwners(d:ActivityDb,clientId='',now=new Date().toISOString()){
 if(!await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='incoming_calls'").first())return 0;
 const eligible=`i.closed_at IS NULL AND i.spam=0 AND json_valid(i.handoff) AND json_extract(i.handoff,'$.freeClient')=1
  AND json_extract(a.data,'$.role')='operator' AND json_extract(e.data,'$.role')='operator'
  AND EXISTS(SELECT 1 FROM auth_accounts WHERE employee_id=e.id AND enabled=1)
  AND EXISTS(SELECT 1 FROM orders o WHERE o.client_id=c.id AND json_extract(o.data,'$.manager')=e.id AND json_extract(o.data,'$.status') NOT IN ('redeemed','refused','returned') AND julianday(json_extract(o.data,'$.createdAt'))>=julianday(json_extract(i.handoff,'$.at')))`;
 const rows=(await d.prepare(`SELECT i.id,i.client_id,i.assignee_id,i.department_id,i.shared_queue,i.handoff,
  c.data client_data,json_extract(c.data,'$.name') client_name,e.id owner_id,json_extract(e.data,'$.name') owner_name,json_extract(e.data,'$.department') owner_department
  FROM incoming_calls i JOIN clients c ON c.id=i.client_id JOIN employees a ON a.id=i.assignee_id JOIN employees e ON e.id=json_extract(c.data,'$.owner')
  WHERE ${eligible}${clientId?' AND c.id=?':''}`).bind(...(clientId?[clientId]:[])).all()).results;
 if(!rows.length)return 0;
 await initReminderStore(d);let changed=0;
 for(const row of rows){
  const moved=row.assignee_id!==row.owner_id,eventId='INCOMING-OWNER-'+crypto.randomUUID(),sync={at:now,from:row.assignee_id,to:row.owner_id};
  const handoff=JSON.stringify({...JSON.parse(row.handoff),freeClient:false,...(moved?{ownerSync:sync}:{})});
  const event={id:eventId,clientId:row.client_id,orderId:'',at:now,actor:'Система',text:'Входящее обращение '+row.id+' автоматически передано владельцу клиента · '+row.owner_name+' · После появления нового заказа'};
  const notice={kind:'incoming-owner',id:'incoming-owner:'+eventId,clientId:row.client_id,title:'Входящий передан владельцу клиента',text:row.client_name+' · Обращение передано '+row.owner_name+' после появления нового заказа. Вам обрабатывать его больше не нужно.',at:now};
  const result=await d.batch([
   d.prepare(`UPDATE incoming_calls SET assignee_id=?,department_id=COALESCE((SELECT json_extract(data,'$.department') FROM employees WHERE id=?),''),shared_queue=0,handoff=?,missed_until=CASE WHEN ?=1 THEN '' ELSE missed_until END
    WHERE id=? AND assignee_id=? AND department_id=? AND shared_queue=? AND handoff=? AND EXISTS(
     SELECT 1 FROM incoming_calls i JOIN clients c ON c.id=i.client_id JOIN employees a ON a.id=i.assignee_id JOIN employees e ON e.id=json_extract(c.data,'$.owner')
     WHERE i.id=incoming_calls.id AND c.data=? AND e.id=? AND ${eligible})`).bind(row.owner_id,row.owner_id,handoff,moved?1:0,row.id,row.assignee_id,row.department_id,row.shared_queue,row.handoff,row.client_data,row.owner_id),
   d.prepare('INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE changes()>0 AND ?=1').bind(eventId,row.client_id,'',now,JSON.stringify(event),moved?1:0),
   d.prepare('INSERT OR IGNORE INTO reminders(employee_id,id,data,at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE id=?)').bind(row.assignee_id,notice.id,JSON.stringify(notice),now,eventId)
  ]);
  if(moved)changed+=result[0].meta.changes||0;
 }
 return changed;
}

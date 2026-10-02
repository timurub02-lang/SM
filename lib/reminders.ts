import {visibleActivityEmployee} from './activity';
import {scheduledCalls,type State,type Employee} from './crm';
import {db} from './db';
import {seesOrder,ownsClient} from './permissions';
export type Reminder={id:string;clientId:string;activityEmployeeId?:string;orderId?:string;requestId?:string;title:string;text:string;at:string;due?:string;readAt?:string};
export async function saveReminders(s:State){
 const d=db();await d.prepare('CREATE TABLE IF NOT EXISTS reminders(employee_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,read_at TEXT,PRIMARY KEY(employee_id,id))').run();
 const exists=await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_incidents'").first();
 const incidents=exists?(await d.prepare('SELECT id,employee_id,detected_at,ended_at,reason FROM activity_incidents ORDER BY detected_at DESC LIMIT 500').all<{id:string;employee_id:string;detected_at:string;ended_at:string|null;reason:string}>()).results:[];
 const writes=[];
 for(const e of s.employees){
  const calls:Reminder[]=scheduledCalls(s.orders,e).map(o=>({id:`call:${o.id}:${o.due}`,orderId:o.id,clientId:o.clientId,title:s.clients.find(c=>c.id===o.clientId)?.name||o.id,text:(o.contact==='missed'?'Недозвон — повторная попытка':'Перезвон')+(o.reason?' · '+o.reason:''),at:o.updatedAt,due:o.due}));
  const requests:Reminder[]=s.clients.filter(c=>c.orderRequest?.status==='pending'&&(e.role==='admin'||e.role==='department_head'&&!!e.department&&c.orderRequest.department===e.department)).map(c=>({id:'request:'+c.orderRequest!.id,requestId:c.orderRequest!.id,clientId:c.id,title:'Запрос на повторный заказ',text:c.name+' · '+(s.employees.find(x=>x.id===c.orderRequest!.manager)?.login||''),at:c.orderRequest!.at}));
  const activity:Reminder[]=incidents.filter(i=>{const target=s.employees.find(x=>x.id===i.employee_id);return !!target&&visibleActivityEmployee(e,target);}).slice(0,20).map(i=>({id:'activity:'+i.id,clientId:'',activityEmployeeId:i.employee_id,title:s.employees.find(x=>x.id===i.employee_id)!.name,text:i.reason,at:i.detected_at,readAt:i.detected_at}));
  for(const r of [...calls,...requests,...activity])writes.push(d.prepare('INSERT OR IGNORE INTO reminders(employee_id,id,data,at,read_at) VALUES(?,?,?,?,?)').bind(e.id,r.id,JSON.stringify(r),r.at,r.readAt||null));
  writes.push(d.prepare('DELETE FROM reminders WHERE employee_id=? AND id NOT IN (SELECT id FROM reminders WHERE employee_id=? ORDER BY at DESC,id DESC LIMIT 20)').bind(e.id,e.id));
 }
 if(writes.length)await d.batch(writes);
}
export async function employeeReminders(s:State,e:Employee){
 const rows=await db().prepare('SELECT data,read_at FROM reminders WHERE employee_id=? ORDER BY at DESC,id DESC').bind(e.id).all<{data:string;read_at:string|null}>();
 return rows.results.map(r=>({...JSON.parse(r.data),readAt:r.read_at||undefined}) as Reminder).filter(r=>{
  if(r.activityEmployeeId){const target=s.employees.find(x=>x.id===r.activityEmployeeId);return !!target&&visibleActivityEmployee(e,target);}
  if(r.orderId){const o=s.orders.find(o=>o.id===r.orderId);return !!o&&seesOrder(e,o,s.employees);}
  const c=s.clients.find(c=>c.id===r.clientId);return !!c&&ownsClient(e,c,s.employees);
 });
}

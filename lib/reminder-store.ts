import type {ActivityDb as Db} from './activity-store.ts';
export async function initReminderStore(d:Db){await d.prepare('CREATE TABLE IF NOT EXISTS reminders(employee_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,read_at TEXT,PRIMARY KEY(employee_id,id))').run();}

// Insert with the order mutation in the same transaction; a stale edit never sends a notice.
export async function courierReminderStatements(d:Db,before:import('./crm.ts').Order,after:import('./crm.ts').Order,event:import('./crm.ts').Event,mutation:string,staff:import('./crm.ts').Employee[]){
 if(after.delivery!=='moscow_courier'||!after.courier)return [];
 const changed=before.status!==after.status||before.courier?.phase!==after.courier.phase||before.courier?.acceptedAt!==after.courier.acceptedAt||JSON.stringify(before.courier?.postponement)!==JSON.stringify(after.courier.postponement);
 if(!changed)return [];
 await initReminderStore(d);
 const department=staff.find(e=>e.id===after.manager)?.department;
 const recipients=staff.filter(e=>e.id===after.manager||e.id===after.courier!.id||['admin','logistic','chief_logistic'].includes(e.role)||e.role==='department_head'&&!!department&&e.department===department);
 const reminder={kind:'courier',id:'courier:'+event.id,orderId:after.id,clientId:after.clientId,title:event.text,text:event.actor,at:event.at};
 return recipients.map(e=>d.prepare("INSERT OR IGNORE INTO reminders(employee_id,id,data,at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(e.id,reminder.id,JSON.stringify(reminder),event.at,after.id,mutation));
}

import {z} from 'zod';
import type {ActivityDb} from './activity-store.ts';
import type {Employee,State} from './crm.ts';
import {canOpenClientCard,visibleState} from './permissions.ts';
import type {Reminder} from './reminders.ts';
export type ClientReminder={id:string;clientId:string;due:string;text:string;createdAt:string};
export const canRemindClient=(s:State,e:Employee,clientId:string)=>!['courier','purchasing'].includes(e.role)&&visibleState(s,e).clients.some(c=>c.id===clientId&&canOpenClientCard(e,c));
export async function initClientReminders(d:ActivityDb){
 await d.prepare('CREATE TABLE IF NOT EXISTS client_reminders(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,due TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,resolution TEXT)').run();
 await d.prepare('CREATE INDEX IF NOT EXISTS client_reminders_employee ON client_reminders(employee_id,completed_at,due)').run();
}
export async function personalClientReminders(d:ActivityDb,s:State,e:Employee):Promise<ClientReminder[]>{
 await initClientReminders(d);
 const rows=(await d.prepare('SELECT id,client_id AS clientId,due,text,created_at AS createdAt FROM client_reminders WHERE employee_id=? AND completed_at IS NULL ORDER BY due').bind(e.id).all()).results as ClientReminder[];
 const accessible=new Set(visibleState(s,e).clients.filter(c=>canOpenClientCard(e,c)).map(c=>c.id));
 return rows.filter(r=>accessible.has(r.clientId));
}
export function clientReminderTasks(rows:ClientReminder[],s:State,now=Date.now()):Reminder[]{
 return rows.filter(r=>Date.parse(r.due)<=now).map(r=>({kind:'task',id:'task:client-reminder:'+r.id,clientId:r.clientId,title:'Напоминание на клиента',text:[s.clients.find(c=>c.id===r.clientId)?.name,r.text].filter(Boolean).join(' · '),at:r.createdAt,due:r.due}));
}
export async function changeClientReminder(d:ActivityDb,s:State,e:Employee,p:any,now=new Date().toISOString()){
 if(!canRemindClient(s,e,p.clientId))throw Error('Нет доступа к клиенту');
 await initClientReminders(d);
 if(p.action==='createClientReminder'){
  const due=z.string().datetime().parse(p.due),text=z.string().trim().min(1,'Укажите, о чём напомнить').max(1000).parse(p.text);
  if(Date.parse(due)<=Date.parse(now))throw Error('Выберите будущее время напоминания');
  const id=z.string().uuid().parse(p.reminderId);
  await d.prepare('INSERT OR IGNORE INTO client_reminders(id,employee_id,client_id,due,text,created_at) VALUES(?,?,?,?,?,?)').bind(id,e.id,p.clientId,due,text,now).run();
 }else{
  const resolution=z.enum(['done','cancelled']).parse(p.resolution);
  const result=await d.prepare('UPDATE client_reminders SET completed_at=?,resolution=? WHERE id=? AND employee_id=? AND client_id=? AND completed_at IS NULL').bind(now,resolution,z.string().uuid().parse(p.reminderId),e.id,p.clientId).run();
  if(!result.meta.changes)throw Error('Напоминание уже закрыто или недоступно');
 }
}

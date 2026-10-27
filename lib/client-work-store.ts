import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import type {Employee,State} from './crm.ts';
import {initClientReminders} from './client-reminders.ts';
import {initPhone} from './phone-store.ts';
import {clientWorkLabels,type ClientWork} from './client-work.ts';
export async function initClientWork(d:Db){
 await initClientReminders(d);
 await d.prepare('CREATE TABLE IF NOT EXISTS client_work(employee_id TEXT NOT NULL,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(employee_id,client_id))').run();
}
export async function readClientWork(d:Db,e:Employee):Promise<ClientWork[]>{
 if(e.role!=='operator')return [];
 await initClientWork(d);await initPhone(d);
 const manual=(await d.prepare("SELECT w.data,w.version FROM client_work w JOIN clients c ON c.id=w.client_id WHERE w.employee_id=? AND json_extract(c.data,'$.owner')=?").bind(e.id,e.id).all()).results;
 const map=new Map<string,ClientWork>(manual.map((r:any)=>{const v={...JSON.parse(r.data),version:r.version,source:JSON.parse(r.data).source==='incoming'?'incoming':'manual'};return [v.clientId,v];}));
 const calls=(await d.prepare(`SELECT client_id,ended_at,answered_at,status FROM (SELECT p.*,ROW_NUMBER() OVER(PARTITION BY p.client_id ORDER BY p.ended_at DESC,p.seq DESC) rank FROM phone_calls p JOIN clients c ON c.id=p.client_id WHERE p.actor_id=? AND json_extract(c.data,'$.owner')=? AND p.ended_at IS NOT NULL AND p.status IN ('completed','busy','no_answer') AND julianday(p.ended_at)>=julianday(COALESCE(json_extract(c.data,'$.assignmentStartedAt'),'1970-01-01'))) WHERE rank=1`).bind(e.id,e.id).all()).results;
 for(const r of calls){const previous=map.get(r.client_id);if(!previous||Date.parse(r.ended_at)>Date.parse(previous.at))map.set(r.client_id,{clientId:r.client_id,at:r.ended_at,outcome:r.answered_at?'reached':'missed',source:'call',version:previous?.version||0});}
 return [...map.values()];
}
export async function saveClientWork(d:Db,s:State,e:Employee,input:any,at=new Date().toISOString()){
 const p=z.object({clientId:z.string().min(1),outcome:z.enum(['reached','missed','callback']),due:z.string().datetime().optional(),version:z.number().int().nonnegative()}).parse(input);
 const c=s.clients.find(c=>c.id===p.clientId);if(e.role!=='operator'||!c||c.owner!==e.id)throw Error('Результат можно сохранить только для своего клиента');
 if(p.outcome==='callback'&&(!p.due||Date.parse(p.due)<=Date.parse(at)))throw Error('Выберите будущее время перезвона');
 await initClientWork(d);
 const old=await d.prepare('SELECT data FROM client_work WHERE employee_id=? AND client_id=?').bind(e.id,c.id).first();
 const reminderId=p.outcome==='callback'?crypto.randomUUID():undefined,mutation=crypto.randomUUID();
 const data={clientId:c.id,outcome:p.outcome,at,reminderId,mutation};
 const guard="EXISTS(SELECT 1 FROM client_work w JOIN clients c ON c.id=w.client_id WHERE w.employee_id=? AND w.client_id=? AND json_extract(w.data,'$.mutation')=? AND json_extract(c.data,'$.owner')=?)";
 const args=[e.id,c.id,mutation,e.id];
 const statements=[d.prepare(`INSERT INTO client_work(employee_id,client_id,data,version) SELECT ?,?,?,1 WHERE ?=0 AND EXISTS(SELECT 1 FROM clients WHERE id=? AND json_extract(data,'$.owner')=?) ON CONFLICT(employee_id,client_id) DO NOTHING`).bind(e.id,c.id,JSON.stringify(data),p.version,c.id,e.id),d.prepare(`UPDATE client_work SET data=?,version=version+1 WHERE employee_id=? AND client_id=? AND version=? AND ?>0 AND EXISTS(SELECT 1 FROM clients WHERE id=? AND json_extract(data,'$.owner')=?)`).bind(JSON.stringify(data),e.id,c.id,p.version,p.version,c.id,e.id)];
 // Only close reminders from this control or already-due personal reminders. Future unrelated reminders stay intact.
 statements.push(d.prepare(`UPDATE client_reminders SET completed_at=?,resolution='done' WHERE employee_id=? AND client_id=? AND completed_at IS NULL AND (julianday(due)<=julianday(?) OR id=?) AND ${guard}`).bind(at,e.id,c.id,at,old?JSON.parse(old.data).reminderId||'':'',...args));
 if(reminderId)statements.push(d.prepare(`INSERT INTO client_reminders(id,employee_id,client_id,due,text,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(reminderId,e.id,c.id,p.due,'Перезвон клиенту',at,...args));
 const text='Работа с клиентом: '+clientWorkLabels[p.outcome]+(p.outcome==='callback'?' · '+new Date(p.due!).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'');
 const event={id:mutation,clientId:c.id,orderId:'',at,actor:e.name,actorId:e.id,text};
 statements.push(d.prepare(`INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,'',?,? WHERE ${guard}`).bind(mutation,c.id,at,JSON.stringify(event),...args));
 const result=await d.batch(statements);if(!result[0].meta.changes&&!result[1].meta.changes)throw Error('Результат или закрепление изменились. Обновите карточку');
}

// These statements run in the same batch as closing the incoming request.
export async function incomingClientWorkStatements(d:Db,clientId:string,ownerId:string,e:Employee,incomingId:string,at:string,comment:string){
 await initClientWork(d);
 const gate="EXISTS(SELECT 1 FROM incoming_calls i JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.client_id=? AND i.closed_by=? AND i.closed_at=? AND json_extract(c.data,'$.owner')=?) AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.client_id=? AND json_extract(o.data,'$.status') NOT IN ('redeemed','refused','returned'))";
 const args=[incomingId,clientId,e.id,at,ownerId,clientId];
 const data={clientId,outcome:'reached',source:'incoming',incomingId,at,comment,author:e.name,authorId:e.id};
 return [
  d.prepare(`INSERT INTO client_work(employee_id,client_id,data,version) SELECT ?,?,?,1 WHERE ${gate} ON CONFLICT(employee_id,client_id) DO UPDATE SET data=excluded.data,version=client_work.version+1 WHERE julianday(json_extract(client_work.data,'$.at'))<=julianday(?)`).bind(ownerId,clientId,JSON.stringify(data),...args,at),
  d.prepare(`UPDATE client_reminders SET completed_at=?,resolution='done' WHERE employee_id=? AND client_id=? AND completed_at IS NULL AND julianday(due)<=julianday(?) AND ${gate}`).bind(at,ownerId,clientId,at,...args)
 ];
}

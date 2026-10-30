import type {ActivityDb} from './activity-store.ts';

// Membership is independent of the client's sheet and owner. Nothing consumes
// this queue automatically or sends its members to a dialing task.
export async function initOktellFollowup(d:ActivityDb){
 await d.prepare(`CREATE TABLE IF NOT EXISTS oktell_followup(
  task_id TEXT NOT NULL,client_id TEXT NOT NULL,reason TEXT NOT NULL,
  command_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id,client_id))`).run();
}
export function followupReason(outcome:string){
 const value=outcome.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').replace(/\s*-\s*/g,'-');
 return value==='нет ответа'?'Нет ответа':value==='робот-защитник'?'Робот-защитник':null;
}
export async function readOktellFollowup(d:ActivityDb,page=0){
 await initOktellFollowup(d);
 const total=Number((await d.prepare('SELECT COUNT(*) n FROM oktell_followup').first())?.n||0);
 const rows=(await d.prepare(`SELECT q.*,json_extract(c.data,'$.name') name,
  json_extract(c.data,'$.phone') phone FROM oktell_followup q
  LEFT JOIN clients c ON c.id=q.client_id ORDER BY q.updated_at DESC,q.task_id,q.client_id LIMIT 50 OFFSET ?`).bind(page*50).all()).results;
 return {total,page,rows};
}

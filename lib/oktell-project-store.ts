import {randomUUID} from 'node:crypto';
import {settingsCommand,type ProjectDraft,type ProjectHistory} from './oktell-project-settings.ts';

type Database={prepare:(sql:string)=>any;batch:(statements:any[])=>Promise<any[]>};
const conflict=()=>Object.assign(Error('Проект изменён в другом окне. Сохраните свой текст и загрузите актуальную версию.'),{status:409});
export async function initProjectDrafts(d:Database){
 await d.batch([
  d.prepare("CREATE TABLE IF NOT EXISTS oktell_project_drafts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,settings TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL,write_token TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS oktell_project_draft_history(project_id TEXT NOT NULL,revision INTEGER NOT NULL,settings TEXT NOT NULL,at TEXT NOT NULL,actor TEXT NOT NULL,PRIMARY KEY(project_id,revision))"),
 ]);
}
function draft(r:any):ProjectDraft{return {id:r.id,revision:r.revision,settings:JSON.parse(r.settings),createdAt:r.created_at,updatedAt:r.updated_at,updatedBy:r.updated_by,status:'draft'};}
export async function readProjectDrafts(d:Database):Promise<ProjectDraft[]>{
 await initProjectDrafts(d);
 return (await d.prepare('SELECT * FROM oktell_project_drafts ORDER BY updated_at DESC,id LIMIT 200').all()).results.map(draft);
}
export async function readProjectHistory(d:Database,id:string):Promise<ProjectHistory[]>{
 await initProjectDrafts(d);
 return (await d.prepare('SELECT revision,settings,at,actor FROM oktell_project_draft_history WHERE project_id=? ORDER BY revision DESC LIMIT 20').bind(id).all()).results.map((r:any)=>({...r,settings:JSON.parse(r.settings)}));
}
export async function saveProjectDraft(d:Database,actor:string,raw:unknown):Promise<ProjectDraft>{
 const b=settingsCommand.parse(raw);await initProjectDrafts(d);
 const json=JSON.stringify(b.settings),at=new Date().toISOString(),token=randomUUID();
 const statements=b.action==='create'?
 [d.prepare('INSERT INTO oktell_project_drafts SELECT ?,1,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM oktell_project_drafts WHERE id=?) AND (SELECT count(*) FROM oktell_project_drafts)<200').bind(b.id,json,at,at,actor,token,b.id)]:
 [d.prepare('UPDATE oktell_project_drafts SET revision=revision+1,settings=?,updated_at=?,updated_by=?,write_token=? WHERE id=? AND revision=?').bind(json,at,actor,token,b.id,b.revision)];
 // The token ties history to this successful CAS, inside the same database transaction.
 statements.push(d.prepare('INSERT INTO oktell_project_draft_history SELECT id,revision,settings,updated_at,updated_by FROM oktell_project_drafts WHERE id=? AND write_token=?').bind(b.id,token));
 await d.batch(statements);
 const row=await d.prepare('SELECT * FROM oktell_project_drafts WHERE id=?').bind(b.id).first();
 if(!row)throw Object.assign(Error('Достигнут предел 200 проектов. Новый проект не создан.'),{status:409});
 if(row.write_token!==token){
  // A retry after a lost response returns the existing version without another write.
  if(row.updated_by===actor&&row.settings===json&&(b.action==='create'||row.revision===b.revision+1))return draft(row);
  throw conflict();
 }
 return draft(row);
}

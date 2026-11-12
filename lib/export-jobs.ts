import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';

export type ExportKind='base'|'premium';
export type ExportJob={id:string;actor_id:string;scope:string;kind:ExportKind;parameter:string;request_key:string;state:'pending'|'running'|'ready'|'failed';attempts:number;claim:string;lease_until:number;created_at:number;updated_at:number;expires_at:number;error:string};
export const exportLifetime=24*60*60*1000;
const initialized=new WeakMap<ActivityDb,Promise<void>>();
export function exportScope(actor:Employee){return JSON.stringify([actor.role,actor.department||'',actor.baseAccess||'']);}
export function mayExport(actor:Employee,kind:ExportKind){return actor.role==='admin'||kind==='premium'&&actor.role==='department_head';}
export function initExportJobs(d:ActivityDb){
 let pending=initialized.get(d);if(pending)return pending;
 pending=d.batch([
  d.prepare("CREATE TABLE IF NOT EXISTS crm_export_jobs(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,scope TEXT NOT NULL,kind TEXT NOT NULL,parameter TEXT NOT NULL,request_key TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,claim TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '',UNIQUE(actor_id,request_key))"),
  d.prepare('CREATE TABLE IF NOT EXISTS crm_export_health(id INTEGER PRIMARY KEY,at INTEGER NOT NULL)'),
  d.prepare('CREATE INDEX IF NOT EXISTS idx_crm_export_pending ON crm_export_jobs(state,created_at)'),
 ]).then(()=>{}).catch(error=>{initialized.delete(d);throw error;});initialized.set(d,pending);return pending;
}
export async function queueExport(d:ActivityDb,actor:Employee,kind:ExportKind,parameter:string,key:string,now=Date.now()):Promise<ExportJob>{
 if(!mayExport(actor,kind)||!/^[\w:-]{1,160}$/.test(key)||!(kind==='base'?/^[MJ]$/:/^\d{4}-\d{2}-[12]$/).test(parameter))throw Error('Выгрузка недоступна');
 await initExportJobs(d);const scope=exportScope(actor),id=crypto.randomUUID();
 // Retries with one request key cannot silently change parameters or permissions.
 await d.prepare("INSERT OR IGNORE INTO crm_export_jobs(id,actor_id,scope,kind,parameter,request_key,created_at,updated_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM crm_export_jobs WHERE actor_id=? AND state IN ('pending','running') AND expires_at>?)<5 AND (SELECT COUNT(*) FROM crm_export_jobs WHERE state IN ('pending','running') AND expires_at>?)<50 AND (SELECT COUNT(*) FROM crm_export_jobs WHERE expires_at>?)<100").bind(id,actor.id,scope,kind,parameter,key,now,now,now+exportLifetime,actor.id,now,now,now).run();
 const job=await d.prepare('SELECT * FROM crm_export_jobs WHERE actor_id=? AND request_key=?').bind(actor.id,key).first() as ExportJob;
 if(!job)throw Error('Очередь выгрузок заполнена. Дождитесь готовности предыдущих файлов.');
 if(job.scope!==scope||job.kind!==kind||job.parameter!==parameter||job.expires_at<=now)throw Error('Параметры выгрузки изменились. Создайте новую выгрузку.');
 return job;
}
export async function authorizedExport(d:ActivityDb,actor:Employee,id:string,now=Date.now()):Promise<ExportJob|null>{
 if(!/^[a-f0-9-]{36}$/.test(id))return null;
 await initExportJobs(d);const job=await d.prepare('SELECT * FROM crm_export_jobs WHERE id=? AND actor_id=?').bind(id,actor.id).first() as ExportJob|null;
 return job&&job.expires_at>now&&job.scope===exportScope(actor)&&mayExport(actor,job.kind)?job:null;
}
export async function claimExport(d:ActivityDb,now=Date.now()):Promise<ExportJob|null>{
 await initExportJobs(d);
 await d.prepare("UPDATE crm_export_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,claim='',lease_until=0,error='Исполнитель был остановлен',updated_at=? WHERE state='running' AND lease_until<=?").bind(now,now).run();
 const claim=crypto.randomUUID();
 // The UPDATE and global single-consumer guard are one SQLite statement, including across processes.
 return d.prepare("UPDATE crm_export_jobs SET state='running',claim=?,attempts=attempts+1,lease_until=?,updated_at=?,error='' WHERE id=(SELECT id FROM crm_export_jobs WHERE state='pending' AND expires_at>? ORDER BY created_at,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM crm_export_jobs WHERE state='running') RETURNING *").bind(claim,now+180000,now,now).first();
}
export async function finishExport(d:ActivityDb,job:ExportJob,ok:boolean,now=Date.now()){
 const result=await d.prepare("UPDATE crm_export_jobs SET state=?,lease_until=0,updated_at=?,error=? WHERE id=? AND state='running' AND claim=? AND lease_until>?").bind(ok?'ready':'failed',now,ok?'':'Не удалось подготовить выгрузку. Повторите попытку.',job.id,job.claim,now).run();
 return result.meta.changes===1;
}
export async function exportWorkerHealthy(d:ActivityDb,now=Date.now()){
 await initExportJobs(d);const row=await d.prepare('SELECT at FROM crm_export_health WHERE id=1').first();
 return row&&now-row.at>=0&&now-row.at<30000;
}

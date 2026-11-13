import type {ActivityDb} from './activity-store.ts';
import {initWorkspaceClock} from './crm-workspace-clock.ts';

export type PreparedModel<T>={status:'ready'|'stale'|'pending'|'error';data?:T;sourceRevision?:string;computedAt?:string;schemaVersion:number;message?:string};
export type PreparedWrite={kind:string;scope:string;data:unknown;sourceRevision:string;accessRevision:string;computedAt:number;validUntil:number};
export const preparedModelsEnabled=()=>process.env.CRM_SUMMARIES_WORKER==='1';
const initialized=new WeakMap<ActivityDb,{schema:number;pending?:Promise<void>}>();
const scopeRevisionSql=(scope:string)=>`(SELECT c.epoch||':'||m.epoch||':'||COALESCE((SELECT revision FROM crm_workspace_clock WHERE scope='*' AND area='workspace'),0)||':'||COALESCE((SELECT revision FROM crm_workspace_clock WHERE scope=${scope} AND area='workspace'),0) FROM crm_change_clock c CROSS JOIN crm_model_source m WHERE c.id=1 AND m.id=1)`;
export async function initPreparedModels(d:ActivityDb){
 await initWorkspaceClock(d);
 const schema=Number(await d.prepare('PRAGMA schema_version').first('schema_version')),saved=initialized.get(d);
 if(saved?.pending)return saved.pending;if(saved?.schema===schema)return;
 const state:{schema:number;pending?:Promise<void>}={schema:-1};initialized.set(d,state);
 state.pending=(async()=>{
  await d.batch([
   d.prepare('CREATE TABLE IF NOT EXISTS crm_model_source(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL,access INTEGER NOT NULL DEFAULT 0,finance INTEGER NOT NULL DEFAULT 0)'),
   d.prepare('INSERT OR IGNORE INTO crm_model_source(id,epoch) VALUES(1,?)').bind(crypto.randomUUID()),
   d.prepare('CREATE TABLE IF NOT EXISTS crm_read_models(kind TEXT NOT NULL,scope TEXT NOT NULL,schema_version INTEGER NOT NULL,source_revision TEXT NOT NULL,access_revision TEXT NOT NULL,computed_at INTEGER NOT NULL,valid_until INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,scope))'),
   d.prepare('CREATE TABLE IF NOT EXISTS crm_model_demand(employee_id TEXT PRIMARY KEY,requested_at INTEGER NOT NULL)'),
   d.prepare("CREATE TABLE IF NOT EXISTS crm_model_worker(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,heartbeat INTEGER NOT NULL DEFAULT 0,ok INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '')"),
   d.prepare('INSERT OR IGNORE INTO crm_model_worker(id) VALUES(1)'),
   d.prepare('CREATE TABLE IF NOT EXISTS crm_model_publish_guard(id INTEGER PRIMARY KEY CHECK(id=1),allowed INTEGER NOT NULL CONSTRAINT crm_model_fence CHECK(allowed=1))'),
   d.prepare('INSERT OR IGNORE INTO crm_model_publish_guard VALUES(1,1)'),
  ]);
  if(!(await d.prepare('PRAGMA table_info(crm_read_models)').all()).results.some((r:{name:string})=>r.name==='scope_revision')){
   try{await d.prepare("ALTER TABLE crm_read_models ADD COLUMN scope_revision TEXT NOT NULL DEFAULT ''").run();}
   catch(error){if(!String(error).includes('duplicate column name: scope_revision'))throw error;}
  }
  const tables=new Set((await d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r:{name:string})=>r.name));
  const triggers=new Map((await d.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all()).results.map((r:{name:string;sql:string})=>[r.name,r.sql]));
  const statements=[];
  for(const table of ['clients','orders','employees','auth_accounts','incoming_calls','settings'].filter(t=>tables.has(t))){
   for(const op of ['INSERT','UPDATE','DELETE']){
    let access='1',finance=['orders','employees','settings'].includes(table)?'1':'0';
    if(op==='UPDATE'){
     if(table==='clients')access="json_extract(OLD.data,'$.owner') IS NOT json_extract(NEW.data,'$.owner')";
     if(table==='orders')access="OLD.client_id IS NOT NEW.client_id OR json_extract(OLD.data,'$.manager') IS NOT json_extract(NEW.data,'$.manager')";
     if(table==='incoming_calls')access=['client_id','assignee_id','department_id','shared_queue','spam','closed_at'].map(c=>`OLD.${c} IS NOT NEW.${c}`).join(' OR ');
     if(table==='employees')access='OLD.data IS NOT NEW.data OR OLD.version IS NOT NEW.version';
     if(table==='auth_accounts')access='OLD.enabled IS NOT NEW.enabled OR OLD.password_hash IS NOT NEW.password_hash';
     if(table==='employees')finance='OLD.data IS NOT NEW.data';
     if(table==='orders')finance=['id','manager','status','testOnly','priorPremiumPaid','legacyLv','importedPayment','delivery','paymentReceivedAt','paymentReceipt','paymentReceivedAmount','cdekRemittances','cdekHistoryRecovery','premiumStage'].map(key=>`json_extract(OLD.data,'$.${key}') IS NOT json_extract(NEW.data,'$.${key}')`).join(' OR ');
    }
    if(table==='settings'){
     access='0';
     const row=op==='DELETE'?'OLD':'NEW';
     finance=`(${row}.id='premium-ledger' OR ${row}.id GLOB 'premium-draft:*' OR ${row}.id GLOB 'cdek-shipment-*')`;
     if(op==='UPDATE')finance+=` AND (${String(triggers.get('crm_clock_settings_UPDATE')).match(/ WHEN (.*?) BEGIN /)?.[1]||'OLD.data IS NOT NEW.data'})`;
    }
    const name=`crm_model_source_${table}_${op}`,sql=`CREATE TRIGGER ${name} AFTER ${op} ON ${table} BEGIN UPDATE crm_model_source SET access=access+CASE WHEN (${access}) THEN 1 ELSE 0 END,finance=finance+CASE WHEN (${finance}) THEN 1 ELSE 0 END WHERE id=1; END`;
    if(triggers.get(name)!==sql){if(triggers.has(name))statements.push(d.prepare('DROP TRIGGER '+name));statements.push(d.prepare(sql));}
   }
  }
  if(statements.length)await d.batch([...statements,d.prepare('UPDATE crm_model_source SET access=access+1,finance=finance+1 WHERE id=1')]);
  state.schema=Number(await d.prepare('PRAGMA schema_version').first('schema_version'));
 })().finally(()=>{state.pending=undefined;});
 return state.pending;
}
export async function readModelSource(d:ActivityDb){
 await initPreparedModels(d);
 const row=await d.prepare('SELECT m.epoch AS model_epoch,m.access,m.finance,c.epoch,c.revision FROM crm_model_source m CROSS JOIN crm_change_clock c WHERE m.id=1 AND c.id=1').first();
 const epoch=row.epoch+':'+row.model_epoch;
 return {epoch,revision:epoch+':'+row.revision,accessRevision:epoch+':'+row.access,financeRevision:epoch+':'+row.finance};
}
export async function requestPreparedWorkspace(d:ActivityDb,employeeId:string,now=Date.now()){
 await initPreparedModels(d);
 // Even a no-op UPSERT takes SQLite's writer lock; active readers must not wait for publication.
 if(await d.prepare('SELECT 1 FROM crm_model_demand WHERE employee_id=? AND requested_at>=?').bind(employeeId,now-30000).first())return;
 await d.prepare('INSERT INTO crm_model_demand(employee_id,requested_at) VALUES(?,?) ON CONFLICT(employee_id) DO UPDATE SET requested_at=excluded.requested_at WHERE requested_at<?').bind(employeeId,now,now-30000).run();
}
export async function readPreparedModel<T>(d:ActivityDb,kind:string,scope:string,sourceRevision?:string,now=Date.now(),jsonPath='$'):Promise<PreparedModel<T>>{
 await initPreparedModels(d);
 const row=await d.prepare(`SELECT c.epoch||':'||m.epoch||':'||m.access AS current_access_revision,${scopeRevisionSql('r.scope')} AS current_scope_revision,r.scope_revision,r.schema_version,r.source_revision,r.access_revision,r.computed_at,r.valid_until,CASE WHEN json_valid(r.data) THEN json_extract(r.data,?) ELSE NULL END AS data,w.ok AS worker_ok,w.heartbeat AS worker_heartbeat FROM crm_model_source m JOIN crm_change_clock c ON c.id=1 LEFT JOIN crm_read_models r ON r.kind=? AND r.scope=? LEFT JOIN crm_model_worker w ON w.id=1 WHERE m.id=1`).bind(jsonPath,kind,scope).first();
 const healthy=row?.worker_ok===1&&now-row.worker_heartbeat>=0&&now-row.worker_heartbeat<10000;
 // Only an unchanged scope observed in this same SQL snapshot can survive a foreign access change.
 const unchangedScope=(kind==='context'||kind==='summary')&&row?.scope_revision&&row.scope_revision===row.current_scope_revision;
 if(!row||row.schema_version!==1||(row.access_revision!==row.current_access_revision&&!unchangedScope))return {status:healthy?'pending':'error',schemaVersion:1,message:healthy?'Сводка готовится':'Обработчик сводок недоступен. Ожидаем готовые данные.'};
 try{
  if(row.data===null)throw Error('Missing or damaged prepared value');
  const data=JSON.parse(row.data) as T;
  const stale=!healthy||row.valid_until<=now||sourceRevision!==undefined&&row.source_revision!==sourceRevision;
  return {status:stale?'stale':'ready',schemaVersion:1,sourceRevision:row.source_revision,computedAt:new Date(row.computed_at).toISOString(),data,...(stale?{message:'Показана последняя готовая сводка. Обновление ожидается.'}:{})};
 }catch{return {status:'error',schemaVersion:1,message:'Готовая сводка повреждена. Ожидаем восстановления обработчиком.'};}
}
export async function publishPreparedModels(d:ActivityDb,rows:PreparedWrite[],extraStatements:any[]=[],token?:string,expectedRevision?:string){
 if(!rows.length)return false;
 const source=await readModelSource(d);if(rows.some(r=>r.accessRevision!==source.accessRevision))return false;
 const guards=["EXISTS(SELECT 1 FROM crm_model_source m CROSS JOIN crm_change_clock c WHERE m.id=1 AND c.id=1 AND c.epoch||':'||m.epoch||':'||m.access=?)"],args:any[]=[source.accessRevision];
 if(token){guards.push('EXISTS(SELECT 1 FROM crm_model_worker WHERE id=1 AND token=? AND lease_until>?)');args.push(token,Date.now());}
 if(expectedRevision){guards.push("EXISTS(SELECT 1 FROM crm_model_source m CROSS JOIN crm_change_clock c WHERE m.id=1 AND c.id=1 AND c.epoch||':'||m.epoch||':'||c.revision=?)");args.push(expectedRevision);}
 for(const r of rows){
  if(r.kind==='finance'||r.kind==='finance-meta'){guards.push("EXISTS(SELECT 1 FROM crm_model_source m CROSS JOIN crm_change_clock c WHERE m.id=1 AND c.id=1 AND c.epoch||':'||m.epoch||':'||m.finance=?)");args.push(r.sourceRevision);}
  guards.push('NOT EXISTS(SELECT 1 FROM crm_read_models WHERE kind=? AND scope=? AND computed_at>?)');args.push(r.kind,r.scope,r.computedAt);
 }
 // A failed fence aborts the entire SQLite transaction, including stage deltas.
 // Filtering individual INSERTs would still allow unguarded stage changes to commit.
 try{
  await d.batch([d.prepare(`UPDATE crm_model_publish_guard SET allowed=CASE WHEN ${guards.join(' AND ')} THEN 1 ELSE 0 END WHERE id=1`).bind(...args),...rows.map(r=>d.prepare(`INSERT INTO crm_read_models(kind,scope,schema_version,source_revision,access_revision,computed_at,valid_until,data,scope_revision) VALUES(?,?,1,?,?,?,?,?,${scopeRevisionSql('?')}) ON CONFLICT(kind,scope) DO UPDATE SET schema_version=1,source_revision=excluded.source_revision,access_revision=excluded.access_revision,computed_at=excluded.computed_at,valid_until=excluded.valid_until,data=excluded.data,scope_revision=excluded.scope_revision`).bind(r.kind,r.scope,r.sourceRevision,r.accessRevision,r.computedAt,r.validUntil,JSON.stringify(r.data),r.scope)),...extraStatements]);return true;
 }catch(error){if(String(error).includes('crm_model_fence'))return false;throw error;}
}

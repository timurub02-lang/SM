import {distributionCandidates,dailyDistributionCount} from './base-dispatch.ts';
import type {ActivityDb as Db} from './activity-store.ts';
import {readBaseDestination} from './base-destination.ts';
import {moscowDate,workDate} from './base-distribution.ts';
import {CRMCallsHttpError,crmcallsApi,crmcallsContact,crmcallsPlan,crmcallsProjects,type CRMCallsSchedule} from './crmcalls.ts';

type Config={apiKey:string;revision:string;checkedAt:string};
type Schedule=CRMCallsSchedule&{revision:string;startedAt:string;dailyLimit:number;planning?:'daily'};
export async function initCRMCalls(d:Db){
 await d.prepare("CREATE TABLE IF NOT EXISTS crmcalls_days(project TEXT NOT NULL,day TEXT NOT NULL,distribution_date TEXT NOT NULL,quantity INTEGER NOT NULL,PRIMARY KEY(project,day))").run();
 await d.prepare("CREATE TABLE IF NOT EXISTS crmcalls_items(project TEXT NOT NULL,client_id TEXT NOT NULL,cycle TEXT NOT NULL,day TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,batch_id TEXT,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(project,client_id))").run();
 await d.prepare("CREATE INDEX IF NOT EXISTS crmcalls_items_pending ON crmcalls_items(state,day,project)").run();
 await d.prepare("CREATE TABLE IF NOT EXISTS crmcalls_batches(id TEXT PRIMARY KEY,project TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,import_id TEXT,error TEXT NOT NULL DEFAULT '')").run();
 await d.prepare("CREATE INDEX IF NOT EXISTS crmcalls_items_client ON crmcalls_items(client_id,state,project)").run();
 await d.prepare("CREATE INDEX IF NOT EXISTS crmcalls_items_batch ON crmcalls_items(batch_id)").run();
 await d.prepare("CREATE UNIQUE INDEX IF NOT EXISTS crmcalls_active_sheet ON settings(json_extract(data,'$.base'),json_extract(data,'$.sheet')) WHERE id LIKE 'crmcalls-project-%' AND json_extract(data,'$.enabled')=1").run();
 // A write with an unknown outcome must be reconciled before the client can be claimed.
 await d.prepare(`CREATE TRIGGER IF NOT EXISTS crmcalls_owner_guard BEFORE UPDATE OF data ON clients WHEN COALESCE(json_extract(NEW.data,'$.owner'),'')<>'' AND EXISTS(SELECT 1 FROM crmcalls_items WHERE client_id=NEW.id AND state IN ('sending','submitted','unknown')) BEGIN SELECT RAISE(ABORT,'Клиент отправляется в CRMCalls. Дождитесь проверки отправки'); END`).run();
 if(await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='base_dispatch_items'").first()){
  await d.prepare("CREATE TRIGGER IF NOT EXISTS crmcalls_sk_guard BEFORE INSERT ON base_dispatch_items WHEN EXISTS(SELECT 1 FROM crmcalls_items WHERE client_id=NEW.client_id AND state IN ('sending','submitted','unknown')) BEGIN SELECT RAISE(IGNORE); END").run();
  await d.prepare("CREATE TRIGGER IF NOT EXISTS crmcalls_claim_guard BEFORE UPDATE OF state ON crmcalls_items WHEN NEW.state='sending' AND EXISTS(SELECT 1 FROM base_dispatch_items WHERE client_id=NEW.client_id AND state IN ('pending','sending','unknown')) BEGIN SELECT RAISE(IGNORE); END").run();
 }
}
async function setting<T>(d:Db,id:string):Promise<T|null>{const row=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first();return row?JSON.parse(row.data):null;}
export const readCRMCalls=(d:Db)=>setting<Config>(d,'crmcalls-connection');
export async function saveCRMCallsKey(d:Db,key:string,revision:string,request:typeof fetch=fetch){
 const old=await readCRMCalls(d);if((old?.revision||'')!==revision)throw Error('Настройки изменились. Обновите раздел.');
 const apiKey=key||old?.apiKey;if(!apiKey)throw Error('Введите API-ключ CRMCalls');
 const projects=await crmcallsProjects(crmcallsApi(apiKey,request));
 const schedules=await crmcallsSchedules(d);if(schedules.some(s=>!projects.some(p=>p.id===s.projectId)))throw Error('Этот ключ не видит настроенные проекты. Подключение не изменено.');
 const next={apiKey,revision:crypto.randomUUID(),checkedAt:new Date().toISOString()};
 const result=await d.prepare("INSERT INTO settings(id,data) VALUES('crmcalls-connection',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE COALESCE(json_extract(settings.data,'$.revision'),'')=?").bind(JSON.stringify(next),revision).run();
 if(!result.meta.changes)throw Error('Настройки изменились. Обновите раздел.');
}
export async function crmcallsSchedules(d:Db):Promise<Schedule[]>{return (await d.prepare("SELECT data FROM settings WHERE id LIKE 'crmcalls-project-%'").all()).results.map((r:any)=>JSON.parse(r.data));}
async function candidates(d:Db,s:CRMCallsSchedule,now:Date,ids?:string[]){
 const {config}=await readBaseDestination(d);if(!config[s.base].sheets.some(sheet=>sheet.name===s.sheet))throw Error('Лист не найден');
 return distributionCandidates(d,s.base,s.sheet,moscowDate(now),ids);
}
async function availableInProject(d:Db,project:string,rows:any[]){
 const done=new Set((await d.prepare("SELECT client_id FROM crmcalls_items WHERE project=? AND state NOT IN ('pending','skipped')").bind(project).all()).results.map((r:any)=>r.client_id));
 return rows.filter(r=>!done.has(r.id));
}
export async function previewCRMCalls(d:Db,s:CRMCallsSchedule,now=new Date()){
 const rows=await candidates(d,s,now),today=moscowDate(now),time=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 const start=time>=s.sendTime?workDate(today,1):today;
 const available=await availableInProject(d,s.projectId,rows);
 return {rows:available,total:rows.length,dailyCount:dailyDistributionCount(rows.length,s.cycleDays),plan:crmcallsPlan(rows.length,s.cycleDays,start)};
}
export async function saveCRMCallsSchedule(d:Db,s:CRMCallsSchedule,revision:string,now=new Date(),request:typeof fetch=fetch){
 const id='crmcalls-project-'+s.projectId,old=await setting<Schedule>(d,id);if((old?.revision||'')!==revision)throw Error('Настройки проекта изменились. Обновите раздел.');
 if(await d.prepare("SELECT id FROM crmcalls_batches WHERE project=? AND state IN ('sending','submitted','unknown')").bind(s.projectId).first())throw Error('Дождитесь проверки текущей отправки проекта');
 const conflicts=s.enabled?(await crmcallsSchedules(d)).filter(other=>other.projectId!==s.projectId&&other.enabled&&other.base===s.base&&other.sheet===s.sheet):[];
 if(conflicts.length){
  const connection=await readCRMCalls(d);if(!connection?.apiKey)throw Error('Сначала подключите CRMCalls');
  const projects=await crmcallsProjects(crmcallsApi(connection.apiKey,request));
  if(!projects.some(p=>p.id===s.projectId&&p.status!=='finished'))throw Error('Проект недоступен для загрузки');
  if(conflicts.some(other=>projects.some(p=>p.id===other.projectId)))throw Error('Этот лист уже включён в другом проекте CRMCalls. Сначала выключите его расписание.');
  // Only a complete provider response proves absence; keep uncertain imports reserved.
  for(const other of conflicts)await saveCRMCallsSchedule(d,{...other,enabled:false},other.revision,now,request);
 }
 if(s.enabled){
  const {config}=await readBaseDestination(d),sheet=config[s.base].sheets.find(v=>v.name===s.sheet);
  if(config.dispatchTarget==='skorozvon'&&sheet?.automatic&&sheet.projectId)throw Error('Для этого листа включена выгрузка в СК. Сначала выключите её.');
 }
 const {plan,dailyCount}=await previewCRMCalls(d,s,now),cycle=crypto.randomUUID(),next={...s,revision:cycle,startedAt:now.toISOString(),dailyLimit:dailyCount,planning:'daily'};
 const statements=[d.prepare("INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE COALESCE(json_extract(settings.data,'$.revision'),'')=?").bind(id,JSON.stringify(next),revision),
 d.prepare("UPDATE crmcalls_items SET state='skipped',error='Расписание изменено' WHERE project=? AND state='pending' AND (SELECT json_extract(data,'$.revision') FROM settings WHERE id=?)=?").bind(s.projectId,id,cycle)];
 const results=await d.batch(statements);if(!results[0].meta.changes)throw Error('Настройки проекта изменились. Обновите раздел.');
 return {queued:0,plan};
}
export async function crmcallsDashboard(d:Db){
 await initCRMCalls(d);const connection=await readCRMCalls(d),{config}=await readBaseDestination(d);
 return {connection:{configured:!!connection?.apiKey,revision:connection?.revision||'',checkedAt:connection?.checkedAt||''},schedules:await crmcallsSchedules(d),
 sheets:{M:config.M.sheets.filter(s=>!['К','ЧС','ПВ'].includes(s.name)).map(s=>s.name),J:config.J.sheets.filter(s=>!['К','ЧС','ПВ'].includes(s.name)).map(s=>s.name)},
 counts:(await d.prepare("SELECT project,state,COUNT(*) AS count FROM crmcalls_items GROUP BY project,state").all()).results,
 plan:(await d.prepare("SELECT project,day,COUNT(*) AS count FROM crmcalls_items WHERE state='pending' GROUP BY project,day ORDER BY day").all()).results,
 batches:(await d.prepare("SELECT * FROM crmcalls_batches ORDER BY created_at DESC LIMIT 30").all()).results,
 health:await setting(d,'crmcalls-health')};
}
export async function runCRMCalls(d:Db,request:typeof fetch=fetch,now=new Date()){
 const connection=await readCRMCalls(d);if(!connection?.apiKey)return;
 await initCRMCalls(d);const api=crmcallsApi(connection.apiKey,request);
 // The existing sync-base service is single-instance; a crashed POST is never replayed.
 await d.batch([d.prepare("UPDATE crmcalls_items SET state='unknown',error='Результат отправки неизвестен' WHERE batch_id IN (SELECT id FROM crmcalls_batches WHERE state='sending')"),d.prepare("UPDATE crmcalls_batches SET state='unknown',error='Отправка прервана. Проверьте импорт в CRMCalls; повторная отправка заблокирована.' WHERE state='sending'")]);
 const active=await d.prepare("SELECT * FROM crmcalls_batches WHERE state='submitted' ORDER BY created_at LIMIT 1").first();
 if(active){
  const result=(await api('/contacts/import/'+encodeURIComponent(active.import_id))).data;
  if(['queued','processing'].includes(result?.state))return;
  if(!['completed','completed_with_errors','failed'].includes(result?.state))throw Error('Неизвестный статус импорта CRMCalls');
  const items=(await d.prepare("SELECT * FROM crmcalls_items WHERE batch_id=?").bind(active.id).all()).results;
  if(result.state!=='completed'||Number(result.invalid_count)!==0||Number(result.processed_count)!==items.length||Number(result.project?.failed)!==0||Number(result.project?.added)+Number(result.project?.already_in_project)!==items.length){
   await d.batch([d.prepare("UPDATE crmcalls_batches SET state='unknown',error='Импорт требует сверки: ошибки строк или добавления в проект. Автоповтор запрещён.' WHERE id=?").bind(active.id),d.prepare("UPDATE crmcalls_items SET state='unknown' WHERE batch_id=?").bind(active.id)]);return;
  }
  const contacts:any[]=[],seen=new Set<string>();let finished=false;
  for(let page=1;page<=5;page++){
   const reply=await api('/contacts?import_id='+encodeURIComponent(active.import_id)+'&per_page=200&page='+page);
   if(!Array.isArray(reply.data))throw Error('CRMCalls не вернул контакты импорта');
   for(const c of reply.data){if(!c?.id||seen.has(c.id))throw Error('CRMCalls повторил контакт');seen.add(c.id);contacts.push(c);}
   if(reply.pagination&&Number.isInteger(reply.pagination.total_pages)&&page>=reply.pagination.total_pages){finished=true;break;}
  }
  if(!finished||contacts.length!==items.length)throw Error('Количество контактов импорта не совпало');
  for(const item of items){const expected=JSON.parse(item.data),matches=contacts.filter(c=>String(c.external_id)===expected.external_id);const c=matches[0];
   if(matches.length!==1||c.full_name!==expected.full_name||c.address!==expected.address&&!(c.address==null&&expected.address==='')||c.city!==expected.city&&!(c.city==null&&expected.city==='')||!Array.isArray(c.phones)||expected.phones.some((phone:string)=>!c.phones.includes(phone)))throw Error('ФИО, телефон или адрес не прошли проверку CRMCalls');
  }
  await d.batch([...items.map((item:any)=>d.prepare("UPDATE clients SET data=json_set(data,'$.distributedAt',?),version=version+1 WHERE id=?").bind(item.day,item.client_id)),d.prepare("UPDATE crmcalls_batches SET state='verified',error='' WHERE id=?").bind(active.id),d.prepare("UPDATE crmcalls_items SET state='sent',error='' WHERE batch_id=?").bind(active.id)]);return;
 }
 const today=moscowDate(now),weekday=new Date(today+'T12:00:00Z').getUTCDay();if(weekday===0||weekday===6)return;
 const time=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 const last=await d.prepare('SELECT created_at FROM crmcalls_batches ORDER BY created_at DESC LIMIT 1').first();if(last&&now.getTime()-Date.parse(last.created_at)<30000)return;
 for(const s of await crmcallsSchedules(d)){
  if(!s.enabled||s.sendTime>time||await d.prepare("SELECT id FROM crmcalls_batches WHERE project=? AND state='unknown'").bind(s.projectId).first())continue;
  // Legacy snapshot schedules must be explicitly saved before switching their meaning.
  if(s.planning!=='daily')continue;
  if(Date.parse(s.startedAt)>=Date.parse(today+'T'+s.sendTime+':00+03:00'))continue;
  let day=await d.prepare("SELECT quantity FROM crmcalls_days WHERE project=? AND day=?").bind(s.projectId,today).first();
  if(!day){
   const rows=await candidates(d,s,now),quantity=dailyDistributionCount(rows.length,s.cycleDays),available=await availableInProject(d,s.projectId,rows),date=workDate(today,1),cycle=crypto.randomUUID();
   const selected=available.slice(0,quantity).map((r:any)=>r.id);
   await d.batch([
    d.prepare("INSERT OR IGNORE INTO crmcalls_days(project,day,distribution_date,quantity) SELECT ?,?,?,? WHERE (SELECT json_extract(data,'$.revision') FROM settings WHERE id=?)=?").bind(s.projectId,today,date,quantity,'crmcalls-project-'+s.projectId,s.revision),
    d.prepare("INSERT INTO crmcalls_items(project,client_id,cycle,day,state,data) SELECT ?,value,?,?,'pending','{}' FROM json_each(?) WHERE (SELECT json_extract(data,'$.revision') FROM settings WHERE id=?)=? ON CONFLICT(project,client_id) DO UPDATE SET cycle=excluded.cycle,day=excluded.day,state='pending',data='{}',batch_id=NULL,error='' WHERE crmcalls_items.state='skipped'").bind(s.projectId,cycle,date,JSON.stringify(selected),'crmcalls-project-'+s.projectId,s.revision)
   ]);
   day={quantity};
  }
  const used=await d.prepare("SELECT COUNT(*) AS n FROM crmcalls_items i JOIN crmcalls_batches b ON b.id=i.batch_id WHERE i.project=? AND date(b.created_at,'+3 hours')=? AND b.state<>'rejected'").bind(s.projectId,today).first();
  const allowance=Math.min(1000,Math.max(0,Number(day.quantity)-Number(used.n)));if(!allowance)continue;
  const pending=(await d.prepare("SELECT * FROM crmcalls_items WHERE project=? AND state='pending' AND day<=? ORDER BY day,client_id LIMIT ?").bind(s.projectId,workDate(today,1),allowance).all()).results;if(!pending.length)continue;
  const project=(await crmcallsProjects(api)).find(p=>p.id===s.projectId);if(!project||project.status==='finished')throw Error('Проект CRMCalls недоступен для загрузки');
  const allowed=new Map((await candidates(d,s,now,pending.map((i:any)=>i.client_id))).map((r:any)=>[r.id,r]));
  const batch=crypto.randomUUID(),at=now.toISOString();
  const writes=[d.prepare("INSERT INTO crmcalls_batches(id,project,state,created_at) SELECT ?,?,'sending',? WHERE (SELECT json_extract(data,'$.revision') FROM settings WHERE id=?)=?").bind(batch,s.projectId,at,'crmcalls-project-'+s.projectId,s.revision)];
  for(const item of pending){const row:any=allowed.get(item.client_id);
   writes.push(row?d.prepare("UPDATE crmcalls_items SET state='sending',batch_id=?,data=? WHERE project=? AND client_id=? AND state='pending' AND EXISTS(SELECT 1 FROM crmcalls_batches WHERE id=?) AND EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM orders WHERE client_id=crmcalls_items.client_id AND json_extract(data,'$.status') NOT IN ('refused','redeemed','returned'))").bind(batch,JSON.stringify(crmcallsContact(JSON.parse(row.data))),s.projectId,item.client_id,batch,item.client_id,row.version):d.prepare("UPDATE crmcalls_items SET state='skipped',error='Клиент больше не доступен для выгрузки' WHERE project=? AND client_id=? AND state='pending'").bind(s.projectId,item.client_id));
  }
  const claimed=await d.batch(writes);if(!claimed[0].meta.changes)return;
  const items=(await d.prepare("SELECT data FROM crmcalls_items WHERE batch_id=? AND state='sending'").bind(batch).all()).results;
  if(!items.length){await d.prepare("UPDATE crmcalls_batches SET state='verified' WHERE id=?").bind(batch).run();return;}
  try{
   const reply=await api('/contacts/import',{project_id:s.projectId,contacts:items.map((r:any)=>JSON.parse(r.data)),deduplication:{mode:'update',on_multiple_phone_matches:'error'}});
   const id=reply.data?.import_id;if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw Error('CRMCalls не подтвердил ID импорта');
   await d.batch([d.prepare("UPDATE crmcalls_batches SET state='submitted',import_id=? WHERE id=?").bind(id,batch),d.prepare("UPDATE crmcalls_items SET state='submitted' WHERE batch_id=?").bind(batch)]);
  }catch(e){
   const rejected=e instanceof CRMCallsHttpError&&[400,401,403,404,409,422,429].includes(e.status),retry=e instanceof CRMCallsHttpError&&e.status===429;
   await d.batch([d.prepare("UPDATE crmcalls_batches SET state=?,error=? WHERE id=?").bind(rejected?'rejected':'unknown',e instanceof Error?e.message:'Ошибка отправки',batch),d.prepare("UPDATE crmcalls_items SET state=?,error=? WHERE batch_id=?").bind(retry?'pending':rejected?'skipped':'unknown',e instanceof Error?e.message:'Ошибка отправки',batch)]);
  }
  return;
 }
}

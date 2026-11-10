import {readBaseDestination,oktellDispatchPending} from './base-destination.ts';
import {type ActivityDb as Db} from './activity-store.ts';
import {skorozvonToken} from './skorozvon.ts';
import {distributionEligible,moscowDate,workDate,normalizedPhone} from './base-distribution.ts';
export async function initBaseDispatch(d:Db){
 await d.prepare(`CREATE TABLE IF NOT EXISTS base_dispatch_jobs(id TEXT PRIMARY KEY,base TEXT NOT NULL,sheet TEXT NOT NULL,project TEXT NOT NULL,distribution_date TEXT NOT NULL,created_at TEXT NOT NULL,automatic_key TEXT UNIQUE)`).run();
 await d.prepare(`CREATE TABLE IF NOT EXISTS base_dispatch_items(job_id TEXT NOT NULL,client_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(job_id,client_id))`).run();
 await d.prepare(`CREATE TABLE IF NOT EXISTS base_dispatch_imports(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,project TEXT NOT NULL,distribution_date TEXT NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,upload_id TEXT,error TEXT NOT NULL DEFAULT '')`).run();
 await d.prepare("CREATE UNIQUE INDEX IF NOT EXISTS base_dispatch_one_active ON base_dispatch_items(client_id) WHERE state IN ('pending','sending','unknown')").run();
 // Keep a client free throughout an external dispatch, including an uncertain API outcome.
 await d.prepare(`CREATE TRIGGER IF NOT EXISTS base_dispatch_owner_guard BEFORE UPDATE OF data ON clients WHEN COALESCE(json_extract(NEW.data,'$.owner'),'')<>'' AND EXISTS(SELECT 1 FROM base_dispatch_items WHERE client_id=NEW.id AND state IN ('pending','sending','unknown')) BEGIN SELECT RAISE(ABORT,'Клиент отправляется в Скорозвон. Дождитесь завершения отправки'); END`).run();
}
export async function queueBaseDispatch(d:Db,p:{base:'M'|'J';sheet:string;project:string;count?:number;automaticKey?:string},now=new Date()){
 await initBaseDispatch(d);
 if(['К','ЧС','ПВ'].includes(p.sheet)||!/^\d+$/.test(p.project))throw Error('Выберите доступный лист и числовой ID проекта');
 const {config}=await readBaseDestination(d);
 if(config.dispatchTarget==='oktell')throw Error(oktellDispatchPending);
 const sheet=config[p.base].sheets.find(s=>s.name===p.sheet);if(!sheet)throw Error('Лист не найден');
 const today=moscowDate(now),date=p.automaticKey?workDate(today,1):today;
 const rows=(await d.prepare(`SELECT id,data,version FROM clients WHERE COALESCE(json_extract(data,'$.baseType'),'M')=? AND json_extract(data,'$.sheet')=? AND COALESCE(json_extract(data,'$.owner'),'')='' AND NOT EXISTS(SELECT 1 FROM base_dispatch_items WHERE client_id=clients.id AND state IN ('pending','sending','unknown')) ORDER BY COALESCE(json_extract(data,'$.distributedAt'),''),id`).bind(p.base,p.sheet).all()).results;
 const eligible=rows.filter((r:any)=>distributionEligible(JSON.parse(r.data),today)&&normalizedPhone(JSON.parse(r.data).phone));
 const count=p.automaticKey?Math.floor(eligible.length/sheet.cycleDays):p.count||0;
 if(!Number.isInteger(count)||count<0||(!p.automaticKey&&(count<1||count>100000)))throw Error('Укажите количество от 1 до 100000');
 const id='BD-'+crypto.randomUUID(),at=now.toISOString();
 const results=await d.batch([d.prepare("INSERT INTO base_dispatch_jobs(id,base,sheet,project,distribution_date,created_at,automatic_key) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT json_extract(data,'$.config.dispatchTarget') FROM settings WHERE id='base-settings'),'skorozvon')='skorozvon'").bind(id,p.base,p.sheet,p.project,date,at,p.automaticKey||null),...eligible.slice(0,count).map((r:any)=>d.prepare(`INSERT INTO base_dispatch_items(job_id,client_id,updated_at) SELECT ?,id,? FROM clients WHERE id=? AND version=? AND COALESCE(json_extract(data,'$.owner'),'')='' AND EXISTS(SELECT 1 FROM base_dispatch_jobs WHERE id=?)`).bind(id,at,r.id,r.version,id))]);
 if(!results[0].meta.changes)throw Error('Направление отправки изменилось. Обновите страницу.');
 return {id,queued:results.slice(1).reduce((n:number,r:any)=>n+(r.meta.changes||0),0),date};
}
export async function runBaseDispatch(d:Db,request:typeof fetch=fetch,now=new Date()){
 await initBaseDispatch(d);
 // The systemd worker is single-instance. A stopped process leaves sending rows for review, never silently repeats a write.
 await d.prepare("UPDATE base_dispatch_items SET state='unknown',error='Отправка прервана. Требуется проверка результата в СК' WHERE state='sending' AND updated_at<? AND NOT EXISTS(SELECT 1 FROM base_dispatch_imports b,json_each(b.data) r WHERE b.job_id=base_dispatch_items.job_id AND json_extract(r.value,'$.clientId')=base_dispatch_items.client_id AND b.state IN ('sending','submitted'))").bind(new Date(now.getTime()-10*60000).toISOString()).run();
 const today=moscowDate(now),weekday=new Date(today+'T12:00:00Z').getUTCDay(),time=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 const {config}=await readBaseDestination(d);
 if(config.dispatchTarget==='oktell')return {sent:0,paused:true,reason:oktellDispatchPending};
 if(weekday!==0&&weekday!==6)for(const base of ['M','J'] as const)for(const s of config[base].sheets){if(!s.automatic||!s.projectId||s.sendTime>time||['К','ЧС','ПВ'].includes(s.name))continue;const key=JSON.stringify([today,base,s.name]);if(!await d.prepare('SELECT id FROM base_dispatch_jobs WHERE automatic_key=?').bind(key).first())await queueBaseDispatch(d,{base,sheet:s.name,project:s.projectId,automaticKey:key},now);}
 const active=(await d.prepare("SELECT * FROM base_dispatch_imports WHERE state IN ('sending','submitted') ORDER BY created_at LIMIT 1").first()) as any;
 const pending=active?[]:(await d.prepare("SELECT i.*,j.project,j.distribution_date,c.data FROM base_dispatch_items i JOIN base_dispatch_jobs j ON j.id=i.job_id JOIN clients c ON c.id=i.client_id WHERE i.state='pending' AND i.job_id=(SELECT job_id FROM base_dispatch_items WHERE state='pending' ORDER BY updated_at LIMIT 1) ORDER BY i.client_id LIMIT 1000").all()).results;
 if(!active&&!pending.length)return {sent:0};
 const credentials=await d.prepare("SELECT data FROM settings WHERE id='skorozvon'").first();if(!credentials)throw Error('Подключение Скорозвона не настроено');const token=await skorozvonToken(JSON.parse(credentials.data),request);
 async function api(path:string,body?:unknown){const r=await request('https://api.skorozvon.ru/api/v2'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)throw Error('Скорозвон вернул ошибку '+r.status);const text=await r.text();return text?JSON.parse(text):null;}
 async function pages(query:string){const result:any[]=[],seen=new Set<string>();for(let page=1;page<=1000;page++){const data=await api(`/leads?${query}&order[column]=leads.id&order[direction]=asc&length=100&page=${page}`);const rows=Array.isArray(data)?data:data?.data;if(!Array.isArray(rows))throw Error('Неожиданный ответ списка СК');if(!rows.length)return result;for(const row of rows){if(!row.id||seen.has(String(row.id)))throw Error('СК повторил карточки при проверке');seen.add(String(row.id));result.push(row);}if(Array.isArray(data))return result;}throw Error('Не удалось проверить полный список СК');}
 let batch:any=active;
 if(batch?.state==='sending'){
  await d.batch([d.prepare("UPDATE base_dispatch_imports SET state='unknown',error='Неизвестен результат импорта. Повторная загрузка запрещена' WHERE id=?").bind(batch.id),d.prepare("UPDATE base_dispatch_items SET state='unknown',error='Неизвестен результат импорта. Требуется проверка в СК' WHERE job_id=? AND state='sending' AND client_id IN (SELECT json_extract(value,'$.clientId') FROM json_each(?))").bind(batch.job_id,batch.data)]);return {sent:0};
 }
 if(!batch){
  const rows:{clientId:string;phone:string;name:string;city:string}[]=pending.map((item:any)=>{const c=JSON.parse(item.data);return {clientId:item.client_id,phone:normalizedPhone(c.phone),name:c.name||normalizedPhone(c.phone),city:c.city||''};});
  const first=pending[0] as any,id='BI-'+crypto.randomUUID(),at=new Date().toISOString();
  const changes=await d.batch([d.prepare("INSERT INTO base_dispatch_imports(id,job_id,project,distribution_date,data,state,created_at) SELECT ?,?,?,?,?,'sending',? WHERE COALESCE((SELECT json_extract(data,'$.config.dispatchTarget') FROM settings WHERE id='base-settings'),'skorozvon')='skorozvon'").bind(id,first.job_id,first.project,first.distribution_date,JSON.stringify(rows),at),...rows.map(row=>d.prepare("UPDATE base_dispatch_items SET state='sending',updated_at=? WHERE job_id=? AND client_id=? AND state='pending' AND EXISTS(SELECT 1 FROM base_dispatch_imports WHERE id=?)").bind(at,first.job_id,row.clientId,id))]);
  if(!changes[0].meta.changes)return {sent:0};
  batch={id,job_id:first.job_id,project:first.project,distribution_date:first.distribution_date,data:JSON.stringify(rows)};
  try{
   const uploaded=await api('/leads/import',{call_project_id:Number(batch.project),duplicates:'ignore',data:rows.map(row=>({name:row.name,phones:['+'+row.phone],city:row.city}))});
   if(!uploaded?.id||!/^\d+$/.test(String(uploaded.id)))throw Error('СК не подтвердил ID импорта');
   await d.prepare("UPDATE base_dispatch_imports SET state='submitted',upload_id=? WHERE id=?").bind(String(uploaded.id),id).run();batch.upload_id=String(uploaded.id);
  }catch(e){const error=e instanceof Error?e.message:'Ошибка импорта';await d.batch([d.prepare("UPDATE base_dispatch_imports SET state='unknown',error=? WHERE id=?").bind(error,id),d.prepare("UPDATE base_dispatch_items SET state='unknown',error=? WHERE job_id=? AND state='sending' AND client_id IN (SELECT json_extract(value,'$.clientId') FROM json_each(?))").bind(error,batch.job_id,batch.data)]);return {sent:0};}
 }
 try{
  const status=await api('/leads/import/'+batch.upload_id);if(status?.state!=='loaded')return {sent:0};
  const expected=JSON.parse(batch.data) as {clientId:string;phone:string;name:string;city:string}[];
  const uploaded=await pages('stored_file_id='+batch.upload_id),members=await pages('call_project_id='+batch.project),memberIds=new Set(members.map(r=>String(r.id))),found=new Map<string,string>();
  const tidy=(v:unknown)=>String(v||'').trim().replace(/\s+/g,' ');
  for(const lead of uploaded){const raw=typeof lead.phones==='string'?lead.phones.split(','):lead.phones;if(!Array.isArray(raw)||raw.length!==1)throw Error('СК вернул неожиданные телефоны партии');const phone=normalizedPhone(raw[0]),row=expected.find(r=>r.phone===phone);if(!row||found.has(phone)||tidy(lead.name)!==tidy(row.name)||tidy(lead.city)!==tidy(row.city)||!memberIds.has(String(lead.id)))throw Error('Карточка или проект не прошли проверку');found.set(phone,String(lead.id));}
  if(Number(status.inserted_count)!==found.size)throw Error('Количество карточек ещё не совпадает с результатом импорта');
  const at=new Date().toISOString();
  await d.batch([...expected.flatMap(row=>{const leadId=found.get(row.phone);return leadId?[d.prepare("UPDATE clients SET data=json_set(data,'$.distributedAt',?,'$.skLeadId',?,'$.skProjectId',?),version=version+1 WHERE id=?").bind(batch.distribution_date,leadId,String(batch.project),row.clientId),d.prepare("UPDATE base_dispatch_items SET state='sent',error='',updated_at=? WHERE job_id=? AND client_id=? AND state='sending'").bind(at,batch.job_id,row.clientId)]:[d.prepare("UPDATE base_dispatch_items SET state='failed',error='СК не включил клиента в завершённый импорт',updated_at=? WHERE job_id=? AND client_id=? AND state='sending'").bind(at,batch.job_id,row.clientId)];}),d.prepare("UPDATE base_dispatch_imports SET state='verified',error='' WHERE id=?").bind(batch.id)]);
  return {sent:found.size};
 }catch(e){await d.prepare('UPDATE base_dispatch_imports SET error=? WHERE id=?').bind(e instanceof Error?e.message:'Ошибка проверки',batch.id).run();throw e;}
}

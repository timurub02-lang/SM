import {type ActivityDb as Db} from './activity-store.ts';
import {skorozvonToken} from './skorozvon.ts';
import {distributionEligible,moscowDate,workDate,normalizedPhone} from './base-distribution.ts';
import {initialBaseSettings,baseSettingsSchema} from './base-policy.ts';
export async function initBaseDispatch(d:Db){
 await d.prepare(`CREATE TABLE IF NOT EXISTS base_dispatch_jobs(id TEXT PRIMARY KEY,base TEXT NOT NULL,sheet TEXT NOT NULL,project TEXT NOT NULL,distribution_date TEXT NOT NULL,created_at TEXT NOT NULL,automatic_key TEXT UNIQUE)`).run();
 await d.prepare(`CREATE TABLE IF NOT EXISTS base_dispatch_items(job_id TEXT NOT NULL,client_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(job_id,client_id))`).run();
 await d.prepare("CREATE UNIQUE INDEX IF NOT EXISTS base_dispatch_one_active ON base_dispatch_items(client_id) WHERE state IN ('pending','sending','unknown')").run();
 // Keep a client free throughout an external dispatch, including an uncertain API outcome.
 await d.prepare(`CREATE TRIGGER IF NOT EXISTS base_dispatch_owner_guard BEFORE UPDATE OF data ON clients WHEN COALESCE(json_extract(NEW.data,'$.owner'),'')<>'' AND EXISTS(SELECT 1 FROM base_dispatch_items WHERE client_id=NEW.id AND state IN ('pending','sending','unknown')) BEGIN SELECT RAISE(ABORT,'Клиент отправляется в Скорозвон. Дождитесь завершения отправки'); END`).run();
}
export async function queueBaseDispatch(d:Db,p:{base:'M'|'J';sheet:string;project:string;count?:number;automaticKey?:string},now=new Date()){
 await initBaseDispatch(d);
 if(['К','ЧС','ПВ'].includes(p.sheet)||!/^\d+$/.test(p.project))throw Error('Выберите доступный лист и числовой ID проекта');
 const saved=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first();const config=baseSettingsSchema.parse(saved?JSON.parse(saved.data).config:initialBaseSettings());
 const sheet=config[p.base].sheets.find(s=>s.name===p.sheet);if(!sheet)throw Error('Лист не найден');
 const today=moscowDate(now),date=p.automaticKey?workDate(today,1):today;
 const rows=(await d.prepare(`SELECT id,data,version FROM clients WHERE COALESCE(json_extract(data,'$.baseType'),'M')=? AND json_extract(data,'$.sheet')=? AND COALESCE(json_extract(data,'$.owner'),'')='' AND NOT EXISTS(SELECT 1 FROM base_dispatch_items WHERE client_id=clients.id AND state IN ('pending','sending','unknown')) ORDER BY COALESCE(json_extract(data,'$.distributedAt'),''),id`).bind(p.base,p.sheet).all()).results;
 const eligible=rows.filter((r:any)=>distributionEligible(JSON.parse(r.data),today)&&normalizedPhone(JSON.parse(r.data).phone));
 const count=p.automaticKey?Math.floor(eligible.length/sheet.cycleDays):p.count||0;
 if(!Number.isInteger(count)||count<0||(!p.automaticKey&&(count<1||count>100000)))throw Error('Укажите количество от 1 до 100000');
 const id='BD-'+crypto.randomUUID(),at=now.toISOString();
 const results=await d.batch([d.prepare('INSERT INTO base_dispatch_jobs(id,base,sheet,project,distribution_date,created_at,automatic_key) VALUES(?,?,?,?,?,?,?)').bind(id,p.base,p.sheet,p.project,date,at,p.automaticKey||null),...eligible.slice(0,count).map((r:any)=>d.prepare(`INSERT INTO base_dispatch_items(job_id,client_id,updated_at) SELECT ?,id,? FROM clients WHERE id=? AND version=? AND COALESCE(json_extract(data,'$.owner'),'')=''`).bind(id,at,r.id,r.version))]);
 return {id,queued:results.slice(1).reduce((n:number,r:any)=>n+(r.meta.changes||0),0),date};
}
export async function runBaseDispatch(d:Db,request:typeof fetch=fetch,now=new Date()){
 await initBaseDispatch(d);
 // The systemd worker is single-instance. A stopped process leaves sending rows for review, never silently repeats a write.
 await d.prepare("UPDATE base_dispatch_items SET state='unknown',error='Отправка прервана. Требуется проверка результата в СК' WHERE state='sending' AND updated_at<?").bind(new Date(now.getTime()-10*60000).toISOString()).run();
 const today=moscowDate(now),weekday=new Date(today+'T12:00:00Z').getUTCDay(),time=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 const saved=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first();const config=baseSettingsSchema.parse(saved?JSON.parse(saved.data).config:initialBaseSettings());
 if(weekday!==0&&weekday!==6)for(const base of ['M','J'] as const)for(const s of config[base].sheets){if(!s.automatic||!s.projectId||s.sendTime>time||['К','ЧС','ПВ'].includes(s.name))continue;const key=JSON.stringify([today,base,s.name]);if(!await d.prepare('SELECT id FROM base_dispatch_jobs WHERE automatic_key=?').bind(key).first())await queueBaseDispatch(d,{base,sheet:s.name,project:s.projectId,automaticKey:key},now);}
 const pending=(await d.prepare("SELECT i.*,j.project,j.distribution_date,c.data FROM base_dispatch_items i JOIN base_dispatch_jobs j ON j.id=i.job_id JOIN clients c ON c.id=i.client_id WHERE i.state='pending' ORDER BY j.created_at,i.client_id LIMIT 50").all()).results;
 if(!pending.length)return {sent:0};
 const credentials=await d.prepare("SELECT data FROM settings WHERE id='skorozvon'").first();if(!credentials)throw Error('Подключение Скорозвона не настроено');const token=await skorozvonToken(JSON.parse(credentials.data),request);
 async function api(path:string,body?:unknown){const r=await request('https://api.skorozvon.ru/api/v2'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)throw Error('Скорозвон вернул ошибку '+r.status);const text=await r.text();return text?JSON.parse(text):null;}
 let sent=0;
 for(const item of pending){
 const claim=await d.prepare("UPDATE base_dispatch_items SET state='sending',updated_at=? WHERE job_id=? AND client_id=? AND state='pending'").bind(new Date().toISOString(),item.job_id,item.client_id).run();if(!claim.meta.changes)continue;
 let wrote=false;
 try{const c=JSON.parse(item.data),phone=normalizedPhone(c.phone);const result=await api('/leads?length=100&filter_phones='+encodeURIComponent(phone));const leads=Array.isArray(result)?result:result?.data;
 if(!Array.isArray(leads))throw Error('Неожиданный ответ поиска клиента');if(leads.length>1)throw Error('В СК несколько клиентов с этим телефоном; требуется проверка');
 let lead=leads[0];if(lead&&(!Array.isArray(lead.phones)||!lead.phones.some((p:unknown)=>normalizedPhone(p)===phone)))throw Error('СК вернул контакт с другим телефоном; отправка остановлена');
 if(!lead){wrote=true;const created=await api('/leads',{name:c.name||phone,phones:[`+${phone}`],call_project_id:Number(item.project)});lead=created?.data||created;if(!lead?.id)throw Error('СК не вернул идентификатор созданного клиента');}
 else {wrote=true;await api('/call_projects/'+item.project+'/assign_leads',{lead_ids:[lead.id]});await api('/call_projects/'+item.project+'/update_leads',{leads:{[lead.id]:'new'}});}
 // A successful API acknowledgement is the dispatch event; the remote dialer processes it asynchronously.
 await d.batch([d.prepare("UPDATE clients SET data=json_set(data,'$.distributedAt',?,'$.skLeadId',?,'$.skProjectId',?),version=version+1 WHERE id=?").bind(item.distribution_date,String(lead.id),String(item.project),item.client_id),d.prepare("UPDATE base_dispatch_items SET state='sent',error='',updated_at=? WHERE job_id=? AND client_id=?").bind(new Date().toISOString(),item.job_id,item.client_id)]);sent++;
 }catch(e){await d.prepare('UPDATE base_dispatch_items SET state=?,error=?,updated_at=? WHERE job_id=? AND client_id=?').bind(wrote?'unknown':'failed',e instanceof Error?e.message:'Ошибка отправки',new Date().toISOString(),item.job_id,item.client_id).run();}
 }
 return {sent};
}

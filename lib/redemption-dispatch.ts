import type {ActivityDb as Db} from './activity-store.ts';
import {archiveRedemption,redemptionRows,redemptionConfig,dayOf,dayPlus,closedTime,inWorkday,awaitingReturn} from './redemption.ts';
import {normalizePhone} from './crm.ts';
import {cdekStatuses} from './cdek-statuses.ts';
import {skorozvonToken} from './skorozvon.ts';
export function redemptionLeads(rows:any[],day:string,origin:string){
 return rows.filter(r=>!r.testOnly&&!['delivered','returned'].includes(r.result)&&(inWorkday(r,day)||awaitingReturn(r))).map(r=>{
  const phone=normalizePhone(r.phone).replace('+','');if(!/^7\d{10}$/.test(phone)||!r.track)throw Error('У заказа '+r.order_id+' нет корректного телефона или трека СДЭК');
  const link=new URL('/?redemption='+encodeURIComponent(r.order_id),origin).href;
  return {name:r.clientName,phones:[phone],external_id:r.track,comment:r.comments.map((c:any)=>c.text).join('\n'),homepage:link,custom_fields:{FIELD_50000022935:r.login,FIELD_50000022937:r.order_id,FIELD_50000022936:cdekStatuses.find(s=>s.code===r.status)?.label||r.status,FIELD_50000022933:String(r.total),FIELD_50000027175:'https://www.cdek.ru/ru/tracking/?order_id='+encodeURIComponent(r.track),FIELD_50000027174:link}};
 });
}
export async function runRedemptionDay(d:Db,now=new Date(),request:typeof fetch=fetch,pause=(ms:number)=>new Promise(r=>setTimeout(r,ms))){
 await archiveRedemption(d,now);if(!closedTime(now))return;
 const day=dayOf(now),tomorrow=dayPlus(day,1),cfg=await redemptionConfig(d);
 let job=await d.prepare('SELECT * FROM redemption_dispatch WHERE day=?').bind(tomorrow).first();
 if(!job){
  const rows=await redemptionRows(d);
  await d.prepare("INSERT OR IGNORE INTO redemption_dispatch(day,state,data,updated_at) VALUES(?,'prepared',?,?)").bind(tomorrow,JSON.stringify({rows,projectId:cfg.projectId,enabled:cfg.automatic}),now.toISOString()).run();
  job=await d.prepare('SELECT * FROM redemption_dispatch WHERE day=?').bind(tomorrow).first();
 }
 // Explicit opt-in and a user-selected project are both required. Test data never leaves CRM.
 if(!cfg.automatic||!cfg.projectId||new Date(now.getTime()+10800000).toISOString().slice(11,16)<'20:00'||job.state!=='prepared')return;
 const snapshot=JSON.parse(job.data);if(!snapshot.enabled||snapshot.projectId!==cfg.projectId)return;
 const claimed=await d.prepare("UPDATE redemption_dispatch SET state='running',updated_at=? WHERE day=? AND state='prepared'").bind(now.toISOString(),tomorrow).run();if(!claimed.meta.changes)return;
 const journal=async(state:string,error='',extra={})=>{Object.assign(snapshot,extra);await d.prepare('UPDATE redemption_dispatch SET state=?,data=?,error=?,updated_at=? WHERE day=?').bind(state,JSON.stringify(snapshot),error,new Date().toISOString(),tomorrow).run();};
 try{
  const leads=redemptionLeads(snapshot.rows,tomorrow,process.env.CRM_PUBLIC_URL||'https://crm.smanalytics.ru');
  const credentials=await d.prepare("SELECT data FROM settings WHERE id='skorozvon'").first();if(!credentials)throw Error('Скорозвон не подключён');
  const token=await skorozvonToken(JSON.parse(credentials.data),request);
  async function api(path:string,body?:any){const r=await request('https://api.skorozvon.ru/api/v2/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)throw Error('Скорозвон: ошибка '+r.status);return await r.json() as any;}
  async function pages(path:string){const out:any[]=[],seen=new Set();for(let page=1;page<=10000;page++){const v=await api(path+(path.includes('?')?'&':'?')+'length=100&page='+page),rows=Array.isArray(v)?v:v.data;if(!Array.isArray(rows))throw Error('Неверный список СК');for(const row of rows){if(seen.has(String(row.id)))throw Error('Повтор страницы СК');seen.add(String(row.id));out.push(row);}if(rows.length<100||v.pagination&&page>=Number(v.pagination.total_pages))return out;}throw Error('Список СК слишком большой');}
  const projects=await pages('call_projects');if(!projects.some(p=>String(p.id)===cfg.projectId))throw Error('Выбранный проект СК не найден');
  const old=await pages('leads?call_project_id='+cfg.projectId),ids=new Set(old.map(x=>String(x.id)));
  // Bulk deletion affects a contact everywhere. Never delete a contact shared by another project.
  if(ids.size)for(const project of projects){if(String(project.id)===cfg.projectId)continue;const other=await pages('leads?call_project_id='+project.id);if(other.some(x=>ids.has(String(x.id))))throw Error('В проекте есть общие контакты с другим проектом. Очистка остановлена');}
  const beforeWrite=async()=>{const current=await redemptionConfig(d);if(!current.automatic||current.projectId!==cfg.projectId)throw Error('Отправка остановлена в настройках');};
  async function poll(path:string,finished:string,states:string[]){for(let i=0;i<120;i++){const v=await api(path);if(v.errors?.length)throw Error('СК сообщил об ошибке обработки');if(v.state===finished)return v;if(!states.includes(v.state))throw Error('Неизвестное состояние задания СК');await pause(5000);}throw Error('Обработка СК не завершена. Повторная отправка заблокирована');}
  await journal('running','',{leads,oldIds:[...ids],imports:[]});
  if(old.length){await beforeWrite();await journal('deleting');const deleted=await api('leads/bulk_deletes',{ids:old.map(x=>x.id)});if(!deleted.id)throw Error('СК не подтвердил удаление');await journal('deleting','',{deleteId:deleted.id});await poll('bulk_deletes/'+deleted.id,'finished',['created','processing']);}
  if((await pages('leads?call_project_id='+cfg.projectId)).length)throw Error('Проект не очищен');
  for(let i=0;i<leads.length;i+=100){if(i)await pause(31000);await beforeWrite();await journal('sending','',{batch:i});const uploaded=await api('leads/import',{call_project_id:cfg.projectId,duplicates:'ignore',data:leads.slice(i,i+100)});if(!uploaded.id)throw Error('СК не подтвердил импорт');snapshot.imports.push(uploaded.id);await journal('waiting');const status=await poll('leads/import/'+uploaded.id,'loaded',['enqueued','processing','duplicates','indexing']);if(Number(status.invalid_count)||Number(status.duplicates_count))throw Error('Часть контактов СК не принята');}
  const actual=await pages('leads?call_project_id='+cfg.projectId);if(actual.length!==leads.length)throw Error('Количество заказов в СК не совпало');
  const expected=new Map(leads.map(x=>[x.custom_fields.FIELD_50000022937,x]));
  for(const row of actual){const wanted=expected.get(String(row.custom_fields?.FIELD_50000022937));if(!wanted||row.homepage!==wanted.homepage||Object.entries(wanted.custom_fields).some(([k,v])=>String(row.custom_fields?.[k]??'')!==v))throw Error('Поля заказа в СК не совпали');expected.delete(wanted.custom_fields.FIELD_50000022937);}
  await journal('done');
 }catch(e){await journal('attention',e instanceof Error?e.message:'Ошибка отправки');throw e;}
}

import type {ActivityDb as Db} from './activity-store.ts';
import {normalizePhone} from './crm.ts';

// Temporary read-only LV bridge. Closing an imported request never reopens it on a later poll.
export async function syncLvIncoming(d:Db,request:typeof fetch=fetch,now=new Date().toISOString()){
 const read=async(id:string)=>{const row=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first();return row?JSON.parse(row.data):null;};
 const config=await read('lv-incoming-import');if(!config?.enabled)return {enabled:false};
 const health=async(value:unknown)=>d.prepare("INSERT INTO settings(id,data) VALUES('lv-incoming-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(value)).run();
 try{
  const credentials=await read('lv-warehouse');
  if(!/^[a-z0-9-]+\.leadvertex\.ru$/.test(credentials?.host||'')||!credentials?.token||!/^\d+$/.test(String(config.statusId)))throw Error('Проверьте настройки входящих ЛВ');
  await d.prepare('CREATE TABLE IF NOT EXISTS lv_incoming_imports(id TEXT PRIMARY KEY,request_id TEXT,at TEXT NOT NULL)').run();
  const api=async(method:string,params:Record<string,string>={})=>{
   const url=new URL(`https://${credentials.host}/api/admin/${method}.html`);url.search=new URLSearchParams({token:credentials.token,...params}).toString();
   const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('ЛВ: ошибка '+response.status);
   const data=await response.json() as any;if(!data||typeof data!=='object'||data.error||data.errors)throw Error('ЛВ вернул некорректный ответ');return data;
  };
  const ids=await api('getOrdersIdsInStatus',{status:String(config.statusId)});
  if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>!/^\d+$/.test(String(id))))throw Error('Некорректный список входящих ЛВ');
  const excluded=new Set((config.excludeIds||[]).map(String));
  const pending=[];for(const id of new Set<string>(ids.map(String)))if(!excluded.has(id)&&!await d.prepare('SELECT id FROM lv_incoming_imports WHERE id=?').bind(id).first())pending.push(id);
  const staff=(await d.prepare('SELECT data FROM employees').all()).results.map((r:any)=>JSON.parse(r.data));
  const operators=pending.length?await api('getFullOperatorsData'):{};
  let created=0,merged=0;const review:{id:string;reason:string}[]=[];
  for(let offset=0;offset<pending.length;offset+=100){
   const batch=pending.slice(offset,offset+100),orders=await api('getOrdersByIds',{ids:batch.join(',')});
   for(const id of batch){
    const o=orders[id];if(!o)throw Error('Неполный ответ ЛВ');
    if(String(o.status)!==String(config.statusId))continue;
    const phone=normalizePhone(String(o.phone||''));
    if(!/^\+7\d{10}$/.test(phone)){review.push({id,reason:'Некорректный телефон'});continue;}
    const clients=(await d.prepare('SELECT c.data FROM clients c WHERE c.id IN (SELECT client_id FROM client_phone_index WHERE phone=?)').bind(phone.slice(1)).all()).results;
    if(clients.length>1){review.push({id,reason:'Телефон связан с несколькими клиентами'});continue;}
    const client=clients.length?JSON.parse(clients[0].data):null;
    const words=(s:string)=>s.toLocaleLowerCase('ru').replace(/ё/g,'е').split(/[^а-яa-z]+/).filter(Boolean);
    const a=words(String(o.fio||'')),b=words(client?.name||'');
    if(a.length&&b.length&&!a.every(x=>b.includes(x))&&!b.every(x=>a.includes(x))){review.push({id,reason:'Разные ФИО по одному телефону'});continue;}
    let login=operators[String(o.operatorID)]?.login;
    if(login==='POD_Tatyana.Volkova_23.10')login='POD_Volkova.Tatyana_23.10';
    const matches=staff.filter((e:any)=>client?.owner?e.id===client.owner:login&&e.login===login);
    if(matches.length>1||((client?.owner||login)&&matches.length!==1)){review.push({id,reason:'Оператор не сопоставлен'});continue;}
    const owner=matches[0];
    const at=typeof o.datetime==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(o.datetime)?new Date(o.datetime.replace(' ','T')+'+03:00').toISOString():null;
    if(!at){review.push({id,reason:'Не указана дата обращения'});continue;}
    const existing=await d.prepare('SELECT id FROM incoming_calls WHERE id=?').bind('LV-IN-'+id).first();
    if(existing){await d.prepare('INSERT INTO lv_incoming_imports(id,request_id,at) VALUES(?,?,?)').bind(id,existing.id,now).run();continue;}
    const open=await d.prepare('SELECT id,assignee_id,client_id FROM incoming_calls WHERE phone=? AND closed_at IS NULL ORDER BY at,id LIMIT 1').bind(phone).first();
    if(open&&(open.assignee_id!==(owner?.id||null)||open.client_id!==(client?.id||null))){review.push({id,reason:'У существующего обращения другое назначение'});continue;}
    const requestId=open?.id||'LV-IN-'+id;
    await d.batch([
     d.prepare('INSERT INTO lv_incoming_imports(id,request_id,at) VALUES(?,?,?)').bind(id,requestId,now),
     open?d.prepare('UPDATE incoming_calls SET call_count=call_count+1,last_at=MAX(at,last_at,?) WHERE id=?').bind(at,requestId):
      d.prepare('INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number,shared_queue,call_count,last_at) VALUES(?,?,?,?,?,?,?,?,1,?)').bind(requestId,client?.id||null,owner?.id||null,owner?.department||'',at,phone,'',owner?0:1,at)
    ]);
    if(open)merged++;else created++;
   }
  }
  await health({ok:true,at:now,created,merged,review});return {created,merged,review};
 }catch{await health({ok:false,at:now,message:'Не удалось обновить входящие ЛВ. Повторная попытка при следующем запуске.'});throw Error('LV incoming sync failed; see lv-incoming-health');}
}

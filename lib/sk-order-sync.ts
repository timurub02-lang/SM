import {normalizePhone} from './crm.ts';
import {skorozvonToken} from './skorozvon.ts';
import {acceptSkOrder,initSkOrders,type SkOrderInput} from './sk-order-import.ts';
import type {ActivityDb as Db} from './activity-store.ts';
export function skClientPhone(call:{direction?:string;phone?:string;source?:string},lead:{lead_phones?:unknown;phones?:unknown}){
 const values=Array.isArray(lead.lead_phones)?lead.lead_phones:typeof lead.phones==='string'?lead.phones.split(/[,;\n]/):[];
 const phones=[...new Set(values.filter((v):v is string=>typeof v==='string').map(normalizePhone).filter(Boolean))];
 // Incoming phone is the SK line, source is the caller. Match against the lead before importing.
 const called=normalizePhone((call.direction==='in'?call.source:call.phone)||'');
 return phones.includes(called)?called:phones.length===1?phones[0]:'';
}
export async function syncSkOrders(d:Db,request:typeof fetch=fetch,now=Date.now(),wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){
 await initSkOrders(d);
 const read=async(id:string)=>{const r=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first();return r?JSON.parse(r.data):null;};
 const put=async(v:unknown)=>d.prepare("INSERT INTO settings(id,data) VALUES('sk-order-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(v)).run();
 const config=await read('sk-order-import');if(!config?.enabled)return {enabled:false};
 const old=await read('sk-order-health'),at=new Date(now).toISOString();
 const activity=await read('activity-health');
 if([old?.retryAt,activity?.retryAt].some(value=>Date.parse(value||'')>now))return {deferred:true};
 const started=Date.now();let retryAt='';
 try{
  const credentials=await read('skorozvon');if(!credentials)throw Error('Скорозвон не подключён');
  const token=await skorozvonToken(credentials,request);
  async function api(path:string,body?:unknown){
   await wait(250);const r=await request('https://api.skorozvon.ru'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(r.status===429){
    const limitedAt=now+Date.now()-started,header=r.headers.get('Retry-After'),delay=header===null?60000:/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-limitedAt;
    retryAt=new Date(limitedAt+Math.max(60000,Number.isFinite(delay)?delay:60000)).toISOString();await r.body?.cancel();
   }
   if(!r.ok)throw Error('Скорозвон: ошибка '+r.status);return await r.json() as any;
  }
  const users:any[]=[];for(let page=1;page<=100;page++){const r=await api('/api/v2/users?length=100&page='+page);const list=Array.isArray(r)?r:r.data;if(!Array.isArray(list))throw Error('Не удалось прочитать сотрудников СК');users.push(...list);if(list.length<100||r.total_pages&&page>=r.total_pages)break;if(page===100)throw Error('Список сотрудников СК неполный');}
  const start=Math.max(Date.parse(config.enabledAt), (Date.parse(old?.lastSuccessAt||'')||Date.parse(config.enabledAt))-86400000);
  if(!Number.isFinite(start)||!Array.isArray(config.resultIds)||!config.resultIds.length)throw Error('Настройка приёма СК некорректна');
  let pages=1,imported=0,pending=0;const review=new Map<string,{callId:string;leadId:string;reason:string}>((old?.review||[]).map((r:{callId:string;leadId:string;reason:string})=>[r.callId,r]));
  for(let page=1;page<=pages;page++){
   const report=await api('/api/reports/calls_total.json',{filter:{types:'all',results_ids:config.resultIds},selected_fields:['id','user','scenario_result','comment'],start_time:Math.floor(start/1000),end_time:Math.floor(now/1000),page,length:100});
   if(!Array.isArray(report.data)||!Number.isInteger(report.total_pages)||report.total_pages>100)throw Error('Отчёт СК неполный');pages=report.total_pages;
   for(const row of report.data){
    if(!config.resultIds.includes(row.scenario_result?.id))throw Error('СК вернул неожиданный результат');
    const prior=await d.prepare('SELECT state FROM sk_order_transfers WHERE id=?').bind(String(row.id)).first();if(prior){review.delete(String(row.id));continue;}
    const raw=await api('/api/v2/calls/'+encodeURIComponent(row.id)),call=raw.data||raw;
    if(!config.resultIds.includes(call.result_id)||!call.ended_at)continue;
    const user=users.find(u=>u.id===call.user_id);if(!user?.name)throw Error('Не удалось определить сотрудника СК');
    const rawLead=await api('/api/v2/leads/'+encodeURIComponent(call.lead_id)),lead=rawLead.data||rawLead;
    const phone=skClientPhone(call,lead);
    if(!phone){review.set(String(call.id),{callId:String(call.id),leadId:String(lead.id),reason:'В карточке СК нет однозначного телефона клиента'});pending++;continue;}
    review.delete(String(call.id));
    const input:SkOrderInput={callId:String(call.id),leadId:String(lead.id),email:user.email||'',userName:user.name||'',userNameUnique:users.filter(u=>String(u.name||'').trim().toLowerCase().replace(/\s+/g,' ')===String(user.name||'').trim().toLowerCase().replace(/\s+/g,' ')).length===1,name:typeof lead.name==='string'?lead.name:'',phone,address:typeof lead.address==='string'?lead.address:'',city:typeof lead.city==='string'?lead.city:'',comment:typeof row.comment==='string'?row.comment:''};
    const r=await acceptSkOrder(d,input,undefined,at);r.state==='imported'?imported++:pending++;
   }
  }
  await put({ok:review.size===0,at,lastSuccessAt:at,message:review.size?'Есть заказы СК с неоднозначным телефоном клиента: '+review.size:'Приём заказов из Скорозвона работает',imported,pending,review:[...review.values()]});return {imported,pending};
 }catch(e){await put({ok:false,at,lastSuccessAt:old?.lastSuccessAt||'',...(retryAt?{retryAt}:{}),message:e instanceof Error?e.message:'Ошибка приёма заказов СК'});throw e;}
}

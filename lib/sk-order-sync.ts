import {normalizePhone} from './crm.ts';
import {skorozvonToken} from './skorozvon.ts';
import {acceptSkOrder,initSkOrders,type SkOrderInput} from './sk-order-import.ts';
import type {ActivityDb as Db} from './activity-store.ts';
import {initSkOrderEvents} from './sk-order-events.ts';
import {skProviderRequest,SkProviderDeferred} from './sk-provider-request.ts';
const sessions=new WeakMap<Db,{credentials:string;request:typeof fetch;token:string;users:any[];at:number}>();
export function skClientPhone(call:{direction?:string;phone?:string;source?:string},lead:{lead_phones?:unknown;phones?:unknown}){
 const values=Array.isArray(lead.lead_phones)?lead.lead_phones:typeof lead.phones==='string'?lead.phones.split(/[,;\n]/):[];
 const phones=[...new Set(values.filter((v):v is string=>typeof v==='string').map(normalizePhone).filter(Boolean))];
 // Incoming phone is the SK line, source is the caller. Match against the lead before importing.
 const called=normalizePhone((call.direction==='in'?call.source:call.phone)||'');
 return phones.includes(called)?called:phones.length===1?phones[0]:'';
}
export async function syncSkOrders(d:Db,request:typeof fetch=fetch,now=Date.now(),wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms)),eventsOnly=false){
 if(eventsOnly){await initSkOrderEvents(d);if(!await d.prepare('SELECT call_id FROM sk_order_events WHERE done_at IS NULL AND next_at<=? AND lease_until<=? LIMIT 1').bind(now,now).first())return {imported:0,pending:0};}
 await initSkOrders(d);
 const read=async(id:string)=>{const r=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first();return r?JSON.parse(r.data):null;};
 const put=async(v:unknown)=>eventsOnly?d.prepare('INSERT INTO sk_order_event_health(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(JSON.stringify(v)).run():d.prepare("INSERT INTO settings(id,data) VALUES('sk-order-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(v)).run();
 const config=await read('sk-order-import');if(!config?.enabled)return {enabled:false};
 const old=await read('sk-order-health'),at=new Date(now).toISOString();
 const eventHealth=eventsOnly?await d.prepare('SELECT data FROM sk_order_event_health WHERE id=1').first():null,previous=eventsOnly?(eventHealth?JSON.parse(eventHealth.data):null):old;
 const activity=await read('activity-health');
 if([old?.retryAt,activity?.retryAt].some(value=>Date.parse(value||'')>now))return {deferred:true};
 const started=Date.now();let retryAt='',virtualNow=now;
 const clock=()=>Math.max(now+Date.now()-started,virtualNow),pause=async(ms:number)=>{virtualNow=clock()+ms;await wait(ms);};
 const paced:typeof fetch=(url,init)=>skProviderRequest(d,request,String(url),init||{},clock,pause);
 try{
  const credentials=await read('skorozvon');if(!credentials)throw Error('Скорозвон не подключён');
  const saved=sessions.get(d),cached=eventsOnly&&saved?.request===request&&saved.credentials===JSON.stringify(credentials)&&now-saved.at>=0&&now-saved.at<30000?saved:null;
  const token=cached?.token||await skorozvonToken(credentials,paced);
  async function api(path:string,body?:unknown){
   const r=await paced('https://api.skorozvon.ru'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(r.status===429){
    const limitedAt=clock(),header=r.headers.get('Retry-After'),delay=header===null?60000:/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-limitedAt;
    retryAt=new Date(limitedAt+Math.max(60000,Number.isFinite(delay)?delay:60000)).toISOString();await r.body?.cancel();
   }
   if(!r.ok)throw Error('Скорозвон: ошибка '+r.status);return await r.json() as any;
  }
  const users:any[]=cached?.users||[];if(!cached)for(let page=1;page<=100;page++){const r=await api('/api/v2/users?length=100&page='+page);const list=Array.isArray(r)?r:r.data;if(!Array.isArray(list))throw Error('Не удалось прочитать сотрудников СК');users.push(...list);if(list.length<100||r.total_pages&&page>=r.total_pages)break;if(page===100)throw Error('Список сотрудников СК неполный');}
  if(eventsOnly&&!cached)sessions.set(d,{credentials:JSON.stringify(credentials),request,token,users,at:now});
  const start=Math.max(Date.parse(config.enabledAt), (Date.parse(old?.lastSuccessAt||'')||Date.parse(config.enabledAt))-86400000);
  if(!Number.isFinite(start)||!Array.isArray(config.resultIds)||!config.resultIds.length)throw Error('Настройка приёма СК некорректна');
  let pages=1,imported=0,pending=0;const review=new Map<string,{callId:string;leadId:string;reason:string}>((previous?.review||[]).map((r:{callId:string;leadId:string;reason:string})=>[r.callId,r]));
  async function accept(row:{id:string|number;comment?:unknown}){
    const prior=await d.prepare('SELECT state,reason FROM sk_order_transfers WHERE id=?').bind(String(row.id)).first();if(prior&&(!eventsOnly||prior.state!=='pending'||prior.reason)){review.delete(String(row.id));return true;}
    const raw=await api('/api/v2/calls/'+encodeURIComponent(row.id)),call=raw.data||raw;
    if(!config.resultIds.includes(call.result_id))return true;
    if(!call.ended_at)return false;
    if(String(call.id)!==String(row.id))throw Error('СК вернул другой звонок');
    if(eventsOnly){
     const value=String(call.started_at||''),normalized=value.replace(/^(\d{2})\.(\d{2})\.(\d{4}) /,'$3-$2-$1T').replace(' ','T'),time=Date.parse(/Z$|[+-]\d\d:\d\d$/.test(normalized)?normalized:normalized+'Z');
     if(!Number.isFinite(time))throw Error('СК не вернул дату звонка');
     if(time<Date.parse(config.enabledAt))return true;
    }
    const user=users.find(u=>u.id===call.user_id);if(!user?.name)throw Error('Не удалось определить сотрудника СК');
    const rawLead=await api('/api/v2/leads/'+encodeURIComponent(call.lead_id)),lead=rawLead.data||rawLead;
    if(String(lead.id)!==String(call.lead_id))throw Error('СК вернул другой контакт');
    const phone=skClientPhone(call,lead);
    if(!phone){review.set(String(call.id),{callId:String(call.id),leadId:String(lead.id),reason:'В карточке СК нет однозначного телефона клиента'});pending++;return false;}
    review.delete(String(call.id));
    const input:SkOrderInput={callId:String(call.id),leadId:String(lead.id),email:user.email||'',userName:user.name||'',userNameUnique:users.filter(u=>String(u.name||'').trim().toLowerCase().replace(/\s+/g,' ')===String(user.name||'').trim().toLowerCase().replace(/\s+/g,' ')).length===1,name:typeof lead.name==='string'?lead.name:'',phone,address:typeof lead.address==='string'?lead.address:'',city:typeof lead.city==='string'?lead.city:'',comment:typeof row.comment==='string'?row.comment:''};
    const r=await acceptSkOrder(d,input,undefined,at);r.state==='imported'?imported++:pending++;
    return true;
  }
  if(eventsOnly){
   // Claim one at a time so another worker/restart cannot outlive a batch lease.
   for(let count=0;count<5;count++){
    const token=crypto.randomUUID(),at=clock();
    const event=await d.prepare("UPDATE sk_order_events SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE call_id=(SELECT call_id FROM sk_order_events WHERE done_at IS NULL AND next_at<=? AND lease_until<=? ORDER BY received_at,call_id LIMIT 1) RETURNING *").bind(token,at+120000,at,at).first();if(!event)break;
    try{
     const done=await accept({id:event.call_id,comment:event.comment});
     await d.prepare("UPDATE sk_order_events SET done_at=?,next_at=?,lease_token='',lease_until=0,last_error=? WHERE call_id=? AND lease_token=?").bind(done?clock():null,clock()+Math.min(30000,1000*2**Math.min(event.attempts,5)),done?'':'Ожидаются завершение звонка или однозначный телефон',event.call_id,token).run();
    }catch(error){
     const next=error instanceof SkProviderDeferred?error.retryAt:clock()+Math.min(300000,1000*2**Math.min(event.attempts,8));
     await d.prepare("UPDATE sk_order_events SET next_at=?,lease_token='',lease_until=0,last_error='Не удалось проверить событие; повтор запланирован' WHERE call_id=? AND lease_token=?").bind(next,event.call_id,token).run();throw error;
    }
   }
  }else for(let page=1;page<=pages;page++){
   const report=await api('/api/reports/calls_total.json',{filter:{types:'all',results_ids:config.resultIds},selected_fields:['id','user','scenario_result','comment'],start_time:Math.floor(start/1000),end_time:Math.floor(now/1000),page,length:100});
   if(!Array.isArray(report.data)||!Number.isInteger(report.total_pages)||report.total_pages>100)throw Error('Отчёт СК неполный');pages=report.total_pages;
   for(const row of report.data){if(!config.resultIds.includes(row.scenario_result?.id))throw Error('СК вернул неожиданный результат');await accept(row);}
  }
  await put({ok:review.size===0,at,lastSuccessAt:at,message:review.size?'Есть заказы СК с неоднозначным телефоном клиента: '+review.size:'Приём заказов из Скорозвона работает',imported,pending,review:[...review.values()]});return {imported,pending};
 }catch(e){sessions.delete(d);if(e instanceof SkProviderDeferred)return {deferred:true};await put({ok:false,at,lastSuccessAt:previous?.lastSuccessAt||'',...(retryAt?{retryAt}:{}),message:e instanceof Error&&e.message.startsWith('СК')?e.message:'Ошибка приёма заказов СК'});throw e;}
}

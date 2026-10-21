import {skorozvonToken} from './skorozvon.ts';
import {acceptSkOrder,initSkOrders,type SkOrderInput} from './sk-order-import.ts';
import type {ActivityDb as Db} from './activity-store.ts';
export async function syncSkOrders(d:Db,request:typeof fetch=fetch,now=Date.now(),wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){
 await initSkOrders(d);
 const read=async(id:string)=>{const r=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first();return r?JSON.parse(r.data):null;};
 const put=async(v:unknown)=>d.prepare("INSERT INTO settings(id,data) VALUES('sk-order-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(v)).run();
 const config=await read('sk-order-import');if(!config?.enabled)return {enabled:false};
 const old=await read('sk-order-health'),at=new Date(now).toISOString();
 try{
  const credentials=await read('skorozvon');if(!credentials)throw Error('Скорозвон не подключён');
  const token=await skorozvonToken(credentials,request);
  async function api(path:string,body?:unknown){await wait(250);const r=await request('https://api.skorozvon.ru'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Скорозвон: ошибка '+r.status);return await r.json() as any;}
  const users:any[]=[];for(let page=1;page<=100;page++){const r=await api('/api/v2/users?length=100&page='+page);const list=Array.isArray(r)?r:r.data;if(!Array.isArray(list))throw Error('Не удалось прочитать сотрудников СК');users.push(...list);if(list.length<100||r.total_pages&&page>=r.total_pages)break;if(page===100)throw Error('Список сотрудников СК неполный');}
  const start=Math.max(Date.parse(config.enabledAt), (Date.parse(old?.lastSuccessAt||'')||Date.parse(config.enabledAt))-86400000);
  if(!Number.isFinite(start)||!Array.isArray(config.resultIds)||!config.resultIds.length)throw Error('Настройка приёма СК некорректна');
  let pages=1,imported=0,pending=0;
  for(let page=1;page<=pages;page++){
   const report=await api('/api/reports/calls_total.json',{filter:{types:'all',results_ids:config.resultIds},selected_fields:['id','user','scenario_result','comment'],start_time:Math.floor(start/1000),end_time:Math.floor(now/1000),page,length:100});
   if(!Array.isArray(report.data)||!Number.isInteger(report.total_pages)||report.total_pages>100)throw Error('Отчёт СК неполный');pages=report.total_pages;
   for(const row of report.data){
    if(!config.resultIds.includes(row.scenario_result?.id))throw Error('СК вернул неожиданный результат');
    const prior=await d.prepare('SELECT state FROM sk_order_transfers WHERE id=?').bind(String(row.id)).first();if(prior)continue;
    const raw=await api('/api/v2/calls/'+encodeURIComponent(row.id)),call=raw.data||raw;
    if(!config.resultIds.includes(call.result_id)||!call.ended_at)continue;
    const user=users.find(u=>u.id===call.user_id);if(!user?.name)throw Error('Не удалось определить сотрудника СК');
    const rawLead=await api('/api/v2/leads/'+encodeURIComponent(call.lead_id)),lead=rawLead.data||rawLead;
    const input:SkOrderInput={callId:String(call.id),leadId:String(lead.id),email:user.email||'',userName:user.name||'',userNameUnique:users.filter(u=>String(u.name||'').trim().toLowerCase().replace(/\s+/g,' ')===String(user.name||'').trim().toLowerCase().replace(/\s+/g,' ')).length===1,name:typeof lead.name==='string'?lead.name:'',phone:call.phone||'',address:typeof lead.address==='string'?lead.address:'',city:typeof lead.city==='string'?lead.city:'',comment:typeof row.comment==='string'?row.comment:''};
    const r=await acceptSkOrder(d,input,undefined,at);r.state==='imported'?imported++:pending++;
   }
  }
  await put({ok:true,at,lastSuccessAt:at,message:'Приём заказов из Скорозвона работает',imported,pending});return {imported,pending};
 }catch(e){await put({ok:false,at,lastSuccessAt:old?.lastSuccessAt||'',message:e instanceof Error?e.message:'Ошибка приёма заказов СК'});throw e;}
}

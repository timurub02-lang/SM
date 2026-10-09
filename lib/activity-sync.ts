import {skorozvonToken,type SkCredentials} from './skorozvon.ts';
import {initActivity,recordActivityIncidents,type ActivityDb} from './activity-store.ts';
import {shiftWindow,type ActivitySample,type WorkSchedule} from './activity.ts';
const iso=(v:unknown)=>{if(typeof v!=='string'||!v)return '';const s=/Z$|[+-]\d\d:\d\d$/.test(v)?v:v.replace(' ','T')+'Z';return Number.isFinite(Date.parse(s))?new Date(s).toISOString():'';};
export async function syncActivity(d:ActivityDb,request:typeof fetch=fetch,now=Date.now(),wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))){
 await initActivity(d);
 await d.prepare('CREATE TABLE IF NOT EXISTS activity_calls(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,duration INTEGER NOT NULL)').run();
 await d.prepare('CREATE INDEX IF NOT EXISTS activity_calls_employee_time ON activity_calls(employee_id,started_at)').run();
 const read=async(id:string)=>{const r=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first();return r?JSON.parse(r.data):null;};
 const put=async(id:string,data:unknown)=>d.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(id,JSON.stringify(data)).run();
 const at=new Date(now).toISOString(),day=new Date(now+10800000).toISOString().slice(0,10),dayStart=Date.parse(day+'T00:00:00+03:00');
 const health=await read('activity-health');
 if(Date.parse(health?.retryAt||'')>now)return {employees:0,callsImported:0,deferred:true};
 const started=Date.now(),clock=()=>now+Date.now()-started;let retryAt='';
 try{
  const config=await read('skorozvon') as SkCredentials|null;if(!config)throw Error('Скорозвон не подключён');
  const mapping=await read('activity-sk-map') as Record<string,number>|null;if(!mapping||!Object.keys(mapping).length)throw Error('Сотрудники Скорозвона не сопоставлены');
  const token=await skorozvonToken(config,request);
  const api=async(path:string,body?:unknown):Promise<any>=>{
   for(let attempt=0;;attempt++){
    // Stay below SK's 10 requests/second; a busy report can also return 429.
    await wait(200);
    const r=await request('https://api.skorozvon.ru'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),redirect:'error'});
    if(r.status!==429){if(!r.ok)throw Error(`Скорозвон: запрос не выполнен (${r.status})`);return await r.json();}
    const limitedAt=clock(),header=r.headers.get('Retry-After'),advised=header===null?NaN:/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-limitedAt;
    const delay=Math.max(1000,Number.isFinite(advised)?advised:[5000,15000,60000][attempt]);
    await r.body?.cancel();
    retryAt=new Date(limitedAt+delay).toISOString();
    if(attempt===2||delay>15000)throw Error('Скорозвон временно ограничил запросы. Обновление автоматически повторится после паузы.');
    await wait(delay);retryAt='';
   }
  };
  const staff=(await d.prepare('SELECT data FROM employees').all()).results.map((r:{data:string})=>JSON.parse(r.data));
  const ids=Object.entries(mapping).filter(([id])=>staff.some((e:any)=>e.id===id)).map(([,id])=>id),reverse=new Map(Object.entries(mapping).map(([id,sk])=>[sk,id]));
  if(new Set(ids).size!==ids.length)throw Error('Повторяющиеся связи сотрудников Скорозвона');
  const usersRaw=await api('/api/v2/users?length=100'),users=Array.isArray(usersRaw)?usersRaw:usersRaw.data;if(!Array.isArray(users))throw Error('Скорозвон: неожиданный список сотрудников');
  if(ids.some(id=>!users.some((u:any)=>u.id===id)))throw Error('Скорозвон: не все связанные сотрудники доступны');
  const previous=await read('activity-samples')||{},schedules=await read('activity-schedules')||{};
  const firstSample=ids.some(skId=>previous[reverse.get(skId)!]?.day!==day);
  const cursor=firstSample?dayStart:Math.max(dayStart,(Date.parse(health?.lastSuccessAt||'')||dayStart)-900000);
  let pages=1;const calls:any[]=[];
  for(let page=1;page<=pages;page++){
   const response=await api('/api/reports/calls_total.json',{filter:{users_ids:ids,types:'all'},selected_fields:['id','started_at','user','duration'],start_time:Math.floor(cursor/1000),end_time:Math.floor(now/1000),page,length:100});
   if(!Array.isArray(response.data)||!Number.isInteger(response.total_pages)||response.total_pages>100)throw Error('Скорозвон: отчёт звонков неполный');
   pages=response.total_pages;
   for(const c of response.data){const employeeId=reverse.get(c.user?.id),start=iso(c.started_at);if(!employeeId||!start||!Number.isFinite(Number(c.duration)))throw Error('Скорозвон: неожиданные данные звонка');if(Date.parse(start)>now||Date.parse(start)<dayStart)continue;calls.push({id:String(c.id),employeeId,start,duration:Math.max(0,Number(c.duration))});}
  }
  // Fetch exact end time only for each employee's latest call; no audio or customer contacts are retained.
  const latest=new Map<string,any>();for(const c of calls)if(!latest.has(c.employeeId)||c.start>latest.get(c.employeeId).start)latest.set(c.employeeId,c);
  const exact=new Map<string,{end:string;active:boolean}>();
  for(const c of latest.values()){const raw=await api('/api/v2/calls/'+encodeURIComponent(c.id)),v=raw.data||raw;const end=iso(v.ended_at);if(Number(v.user_id)!==mapping[c.employeeId])throw Error('Скорозвон: владелец звонка изменился');exact.set(c.id,{end,active:!end});}
  if(calls.length)await d.batch(calls.map(c=>d.prepare('INSERT INTO activity_calls(id,employee_id,started_at,ended_at,duration) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at,duration=excluded.duration').bind(c.id,c.employeeId,c.start,exact.get(c.id)?.end||c.start,c.duration)));
  const bootstrapUrl=(await read('activity-provider-bootstrap'))?.url;
  function providerUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||!u.hostname.endsWith('.skorozvon.ru')||u.username||u.password||u.port)throw Error('Скорозвон: недопустимый адрес сервиса статусов');return u;}
  const bootstrap=await request(providerUrl(bootstrapUrl),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!bootstrap.ok)throw Error('Скорозвон: источник текущих статусов недоступен');
  const info=await bootstrap.json() as {phone_bus_uri?:string};
  const presenceUrl=providerUrl(info.phone_bus_uri||'');presenceUrl.pathname='/postman/user_states';presenceUrl.search='';presenceUrl.hash='';
  const presenceResponse=await request(presenceUrl,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!presenceResponse.ok)throw Error('Скорозвон: текущие статусы недоступны');
  const presence=await presenceResponse.json() as any[];if(!Array.isArray(presence))throw Error('Скорозвон: неожиданный формат статусов');
  await d.prepare('CREATE TABLE IF NOT EXISTS activity_presence(employee_id TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,PRIMARY KEY(employee_id,started_at))').run();
  const samples:Record<string,ActivitySample>={};
  for(const [employeeId,skId] of Object.entries(mapping)){
   const employee=staff.find((e:any)=>e.id===employeeId);if(!employee)continue;
   const old:ActivitySample|undefined=previous[employeeId]?.day===day?previous[employeeId]:undefined;
   const user=users.find((u:any)=>u.id===skId),live=presence.find((r:any)=>r.user_id===user.uuid);
   const statusAt=iso(live?.status_changed_at),serverTime=iso(live?.current_time);
   const freshLive=!!serverTime&&Math.abs(now-Date.parse(serverTime))<180000&&!!statusAt&&Date.parse(statusAt)<=now+60000;
   const status=freshLive?String(live.status).replace(/^custom_(\w+)_\w+$/,'$1'):'unknown';
   const recent=old&&now-Date.parse(old.observedAt)<180000;
   const shift=shiftWindow(schedules[employee.department] as WorkSchedule|undefined,now);
   if(freshLive){
    if(recent&&old.statusAt!==statusAt&&old.status!=='unknown')await d.prepare('UPDATE activity_presence SET ended_at=? WHERE employee_id=? AND started_at=?').bind(statusAt,employeeId,old.statusAt).run();
    await d.prepare('INSERT INTO activity_presence(employee_id,status,started_at,ended_at) VALUES(?,?,?,?) ON CONFLICT(employee_id,started_at) DO UPDATE SET ended_at=excluded.ended_at').bind(employeeId,status,statusAt,at).run();
   }
   const intervals=(await d.prepare("SELECT started_at,ended_at FROM activity_presence WHERE employee_id=? AND status='away' AND ended_at>=?").bind(employeeId,new Date(dayStart).toISOString()).all()).results;
   const breakSeconds=shift?.workday?intervals.reduce((total:number,i:any)=>total+Math.max(0,Math.min(now,shift.end,Date.parse(i.ended_at))-Math.max(shift.start,Date.parse(i.started_at)))/1000,0):0;
   const last=await d.prepare('SELECT started_at,ended_at FROM activity_calls WHERE employee_id=? AND started_at>=? ORDER BY started_at DESC LIMIT 1').bind(employeeId,new Date(dayStart).toISOString()).first();
   const totals=await d.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(duration),0) AS duration FROM activity_calls WHERE employee_id=? AND started_at>=?').bind(employeeId,new Date(dayStart).toISOString()).first();
   samples[employeeId]={employeeId,skId,day,locked:!!user.locked,calls:totals.count,lastCallAt:last?.started_at||'',lastCallEnd:last?.ended_at||'',callSeconds:totals.duration,observedAt:at,status,statusAt:freshLive?statusAt:'',lastBusyAt:freshLive&&['speaking','ringing'].includes(status)?at:old?.lastBusyAt||'',breakEndedAt:freshLive&&recent&&old.status==='away'&&status!=='away'?statusAt:old?.breakEndedAt||'',breakSeconds,breakObservedSince:old?.breakObservedSince||at};
  }
  await put('activity-samples',samples);await put('activity-health',{ok:true,checkedAt:at,lastSuccessAt:at,message:'Звонки и текущие статусы Скорозвона подключены.'});
  await recordActivityIncidents(d,now);return {employees:Object.keys(samples).length,callsImported:calls.length};
 }catch(e){const old=await read('activity-health');await put('activity-health',{ok:false,checkedAt:at,lastSuccessAt:old?.lastSuccessAt||'',...(retryAt?{retryAt}:{}),message:e instanceof Error&&e.message.startsWith('Скорозвон')?e.message:'Не удалось обновить данные Скорозвона'});throw Error('Синхронизация активности не завершена');}
}

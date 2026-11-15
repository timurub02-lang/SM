import type {ActivityDb} from './activity-store.ts';
import {skorozvonToken,type SkCredentials} from './skorozvon.ts';
import {skProviderRequest} from './sk-provider-request.ts';
import type {Employee} from './crm';
import type {PremiumPeriod} from './premium-periods';
import type {PartnerMinutes} from './partner-minutes';
export async function readPartnerMinutes(calendar:PremiumPeriod,d:ActivityDb,fetcher:typeof fetch=fetch,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<PartnerMinutes>{
 const read=async(id:string)=>{const row=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first<{data:string}>();return row?JSON.parse(row.data):null;};
 const credentials=await read('skorozvon') as SkCredentials|null,mapping=await read('activity-sk-map') as Record<string,number>|null;
 if(!credentials||!mapping)throw Error('Скорозвон не подключён или сотрудники не сопоставлены');
 const employees=(await d.prepare('SELECT data FROM employees').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Employee).filter(e=>e.role==='operator'&&e.department==='5');
 const rows=employees.filter(e=>Number.isInteger(mapping[e.id])).map(e=>({employeeId:e.id,login:e.login,billed:0,seconds:0}));
 const reverse=new Map(rows.map(r=>[mapping[r.employeeId],r]));
 if(reverse.size!==rows.length)throw Error('Повторяющиеся связи операторов со Скорозвоном');
 const start=Math.floor(Date.parse(calendar.from+'T00:00:00+03:00')/1000),end=Math.min(Math.floor(Date.now()/1000),Math.floor(Date.parse(calendar.cutoff+'T23:59:59+03:00')/1000));
 if(end<start)throw Error('Расчётный период ещё не начался');
 const request:typeof fetch=(url,init)=>skProviderRequest(d,fetcher,String(url),init||{},Date.now,wait);
 const token=await skorozvonToken(credentials,request),seen=new Set<string>();let pages=1,total:number|undefined;
 for(let page=1;page<=pages;page++){
  if(page>1)await wait(3000);
  // Read all users so archived SK users are included; retain only mapped department A totals.
  const response=await request('https://api.skorozvon.ru/api/reports/calls_total.json',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({filter:{users_ids:'all',types:'all'},selected_fields:['id','started_at','user','duration','durations'],start_time:start,end_time:end,page,length:1000}),signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw Error('Не удалось получить минуты Скорозвона. Повторите позже.');
  const result=await response.json() as {data:{id?:string;user?:{id?:number};duration?:number;durations?:{billed?:number}}[];total_pages:number;total:number};
  if(!Array.isArray(result.data)||!Number.isInteger(result.total_pages)||result.total_pages>100||!Number.isInteger(result.total))throw Error('Скорозвон вернул неполный отчёт минут');
  if(total!==undefined&&total!==result.total)throw Error('Отчёт Скорозвона изменился во время загрузки. Повторите обновление.');
  total=result.total;pages=result.total_pages;
  for(const call of result.data){
   const id=String(call.id??'');if(!id||seen.has(id))throw Error('Повтор звонка в отчёте Скорозвона');seen.add(id);
   const row=reverse.get(Number(call.user?.id));if(!row)continue;
   const billed=Number(call.durations?.billed),seconds=Number(call.duration);
   if(call.durations?.billed==null||call.duration==null||!Number.isFinite(billed)||!Number.isFinite(seconds)||billed<0||seconds<0)throw Error('Скорозвон не указал тарифицируемые минуты звонка');
   row.billed+=billed;row.seconds+=seconds;
  }
 }
 if(seen.size!==total)throw Error('Получены не все звонки Скорозвона');
 return {updatedAt:new Date().toISOString(),through:new Date(end*1000).toISOString(),rows,missing:employees.filter(e=>!Number.isInteger(mapping[e.id])).map(e=>e.login)};
}

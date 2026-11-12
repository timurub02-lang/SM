import {initCdekHistoryRecovery,recoverCdekHistory} from './cdek-history-recovery.ts';
import {z} from 'zod';
import {cdekToken} from './cdek.ts';
import {sameRemittance,hasRemittanceConflict,type CdekRemittance} from './cdek-remittance.ts';
import type {Order} from './crm.ts';
import type {ActivityDb as Db} from './activity-store.ts';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const number=z.union([z.string().trim().min(1).max(100),z.number().int().nonnegative().safe()]).transform(String);
const amount=z.number().finite().min(-1e9).max(1e9);
const responseSchema=z.object({errors:z.array(z.unknown()).optional(),warnings:z.array(z.unknown()).optional(),registries:z.array(z.object({registry_number:number,payment_date:day.optional(),orders:z.array(z.object({cdek_number:number,transfer_sum:amount,payment_sum:amount,basis_type:z.string().optional()}))})).optional()}).strict();
export function registryPayments(data:unknown,slot:number):CdekRemittance[]{
 const parsed=responseSchema.parse(data);
 if(parsed.errors?.length)throw Error('СДЭК не подтвердил получение реестров');
 const result:CdekRemittance[]=[];
 for(const r of parsed.registries||[])for(const o of r.orders){
  // Delivery charges, service refunds and zero rows do not prove receipt of COD proceeds.
  if(o.transfer_sum<=0||o.payment_sum<=0||o.basis_type&&o.basis_type!=='ORDER')continue;
  if(!r.payment_date)throw Error('В положительном реестре отсутствует дата перечисления');
  const receipt={slot,registry:r.registry_number,tracking:o.cdek_number,paymentDate:r.payment_date,amountCents:Math.round(o.transfer_sum*100),collectedCents:Math.round(o.payment_sum*100)};
  if(!result.some(x=>sameRemittance(x,receipt)))result.push(receipt);
 }
 return result;
}
export async function applyCdekRegistries(d:Db,slot:number,data:unknown,at=new Date().toISOString(),dryRun=false,allowedIds?:Set<string>){
 const payments=registryPayments(data,slot);
 await initCdekHistoryRecovery(d);
 const rows=(await d.prepare(`SELECT o.id,o.data,o.version,s.data shipment FROM orders o LEFT JOIN settings s ON s.id='cdek-shipment-'||o.id WHERE (json_extract(o.data,'$.delivery') IN ('cdek_pickup','cdek_courier') OR (json_extract(o.data,'$.delivery') IS NULL AND json_extract(o.data,'$.cdekHistoryRecovery') IS NOT NULL))`).all()).results;
 const byTracking=new Map<string,{id:string;data:string;version:number;shipment:string|null;order:Order;slot?:number}[]>();
 for(const row of rows){
  const order=JSON.parse(row.data) as Order,shipment=row.shipment?JSON.parse(row.shipment):null;
  const tracking=String(shipment?.number||order.cdekTrackingNumber||order.legacyLv?.track||'').trim();
  if(!tracking)continue;
  const list=byTracking.get(tracking)||[];list.push({...row,order,slot:shipment?.slot||order.cdekTariff?.slot});byTracking.set(tracking,list);
 }
 const result={recovered:0,archived:0,added:0,conflicts:0,unchanged:0,unmatched:0,ambiguous:0,races:0,orderIds:[] as string[]};
 // Group all positive evidence before writing: two positives in the same answer are never silently collapsed.
 const grouped=new Map<string,CdekRemittance[]>();
 for(const receipt of payments){const list=grouped.get(receipt.tracking)||[];list.push(receipt);grouped.set(receipt.tracking,list);}
 for(const [tracking,receipts] of grouped){
  const candidates=byTracking.get(tracking)||[];
  if(candidates.length>1){result.ambiguous++;continue;}
  if(!candidates.length&&!allowedIds){
   const recovery=await recoverCdekHistory(d,tracking,receipts,at,dryRun);
   if(recovery.status==='created'){result.recovered++;result.orderIds.push(recovery.id);if(recovery.conflict)result.conflicts++;else result.added++;continue;}
   if(recovery.status==='archived'){result.archived++;continue;}
   if(recovery.status==='ambiguous'){result.ambiguous++;continue;}
   if(recovery.status==='race'){result.races++;continue;}
  }
  const row=candidates[0];
  if(!row||row.slot&&row.slot!==slot||row.order.status!=='redeemed'||row.order.testOnly||allowedIds&&!allowedIds.has(row.id)){result.unmatched++;continue;}
  const previous:CdekRemittance[]=row.order.cdekRemittances||[];
  const next=[...previous];for(const receipt of receipts)if(!next.some(x=>sameRemittance(x,receipt)))next.push(receipt);
  if(next.length===previous.length){result.unchanged++;continue;}
  const conflict=hasRemittanceConflict({cdekRemittances:next});
  const mutation=crypto.randomUUID(),text=conflict?'СДЭК: несколько положительных перечислений по заказу — требуется проверка администратора':`СДЭК: деньги получены, реестр №${next[0].registry}, дата перечисления ${next[0].paymentDate}${next.length>1?' · дубль сохранён без повторного начисления':''}`;
  if(!dryRun){
   const event={id:mutation,orderId:row.id,clientId:row.order.clientId,at,actor:'СДЭК',text};
   const updated={...row.order,cdekRemittances:next,updatedAt:at,_mutation:mutation};
   const batch=await d.batch([
    d.prepare(`UPDATE orders SET data=json_set(data,'$.cdekRemittances',json(?),'$.updatedAt',?,'$._mutation',?),version=version+1 WHERE id=? AND version=? AND data=? AND COALESCE((SELECT data FROM settings WHERE id=?),'')=?`).bind(JSON.stringify(updated.cdekRemittances),at,mutation,row.id,row.version,row.data,'cdek-shipment-'+row.id,row.shipment||''),
    d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(mutation,row.order.clientId,row.id,at,JSON.stringify(event),row.id,mutation)
   ]);
   if(!batch[0].meta.changes){result.races++;continue;}
  }
  result.orderIds.push(row.id);if(conflict)result.conflicts++;else result.added++;
 }
 return result;
}
const datePlus=(s:string,n:number)=>new Date(Date.parse(s)+n*86400000).toISOString().slice(0,10);
export async function syncCdekRemittances(d:Db,request:typeof fetch=fetch,now=Date.now()){
 const today=new Date(now+3*3600000).toISOString().slice(0,10),at=new Date(now).toISOString();
 const accounts=(await d.prepare("SELECT id,data FROM settings WHERE id GLOB 'cdek-[1-4]'").all()).results;
 const totals={checked:0,added:0,conflicts:0,failed:0};
 // Existing shipment worker runs once a minute. Each account reads today once an hour,
 // plus one rotating historical day so late documents and newly imported orders are picked up.
 await Promise.all(accounts.map(async(a:{id:string;data:string})=>{
  const slot=Number(a.id.slice(-1)),key='cdek-registry-sync-'+slot;
  const previous=await d.prepare('SELECT data FROM settings WHERE id=?').bind(key).first();
  const state=previous?JSON.parse(previous.data):{};
  if(Date.parse(state.retryAt||'')>now)return;
  const oldest=await d.prepare(`SELECT MIN(substr(json_extract(data,'$.redeemedAt'),1,10)) day FROM orders WHERE json_extract(data,'$.delivery') IN ('cdek_pickup','cdek_courier') AND json_extract(data,'$.status')='redeemed' AND COALESCE(json_extract(data,'$.testOnly'),0)<>1`).first();
  const start=day.safeParse(oldest?.day).success&&oldest.day<=today?oldest.day:today;
  const cursor=day.safeParse(state.nextDay).success&&state.nextDay>=start&&state.nextDay<=today?state.nextDay:start;
  const todayFresh=now-Date.parse(state.todayCheckedAt||'')<3600000;
  const dates=[...new Set([...(todayFresh?[]:[today]),...(!todayFresh||cursor!==today?[cursor]:[])])];
  if(!dates.length)return;
  let retryAt=now+5*60000;
  try{
   const keys=JSON.parse(a.data);const token=await cdekToken(keys.clientId,keys.clientSecret,request);
   for(const date of dates){
    let data:unknown;
    // Retry only the read, before validation or any financial writes.
    for(let attempt=0;;attempt++){
     let response:Response;
     try{
      response=await request('https://api.cdek.ru/v2/registries?date='+date,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
      if(response.ok){data=await response.json();break;}
     }catch(e){
      if(attempt||!(e instanceof TypeError||e instanceof Error&&e.name==='TimeoutError'))throw e;
      await new Promise(r=>setTimeout(r,500));continue;
     }
     if(response.status===429){const header=response.headers.get('Retry-After'),advised=header===null?NaN:/^\d+$/.test(header)?now+Number(header)*1000:Date.parse(header);if(Number.isFinite(advised))retryAt=Math.max(retryAt,advised);}
     await response.body?.cancel();
     if(!attempt&&[502,503,504].includes(response.status)){await new Promise(r=>setTimeout(r,500));continue;}
     throw Error(`СДЭК: реестры недоступны (${response.status})`);
    }
    const result=await applyCdekRegistries(d,slot,data,at);
    totals.checked++;totals.added+=result.added;totals.conflicts+=result.conflicts;
    if(result.races)throw Error('Заказы изменились во время сверки, будет повтор');
    if(date===today)state.todayCheckedAt=at;
    if(date===cursor)state.nextDay=date>=today?start:datePlus(date,1);
   }
   state.error=undefined;state.retryAt=undefined;
  }catch(e){totals.failed++;state.retryAt=new Date(retryAt).toISOString();state.error=e instanceof Error?e.message:'Ошибка чтения реестров СДЭК';}
  state.checkedAt=at;
  await d.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(state)).run();
 }));
 return totals;
}

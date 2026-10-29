import {z} from 'zod';
import {cdekToken} from './cdek.ts';
import {sameRemittance,type CdekRemittance} from './cdek-remittance.ts';
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
 const rows=(await d.prepare(`SELECT o.id,o.data,o.version,s.data shipment FROM orders o LEFT JOIN settings s ON s.id='cdek-shipment-'||o.id WHERE json_extract(o.data,'$.delivery') IN ('cdek_pickup','cdek_courier')`).all()).results;
 const byTracking=new Map<string,{id:string;data:string;version:number;shipment:string|null;order:Order;slot?:number}[]>();
 for(const row of rows){
  const order=JSON.parse(row.data) as Order,shipment=row.shipment?JSON.parse(row.shipment):null;
  const tracking=String(shipment?.number||order.cdekTrackingNumber||order.legacyLv?.track||'').trim();
  if(!tracking)continue;
  const list=byTracking.get(tracking)||[];list.push({...row,order,slot:shipment?.slot||order.cdekTariff?.slot});byTracking.set(tracking,list);
 }
 const result={added:0,conflicts:0,unchanged:0,unmatched:0,ambiguous:0,races:0,orderIds:[] as string[]};
 // Group all positive evidence before writing: two positives in the same answer are never silently collapsed.
 const grouped=new Map<string,CdekRemittance[]>();
 for(const receipt of payments){const list=grouped.get(receipt.tracking)||[];list.push(receipt);grouped.set(receipt.tracking,list);}
 for(const [tracking,receipts] of grouped){
  const candidates=byTracking.get(tracking)||[];
  if(candidates.length>1){result.ambiguous++;continue;}
  const row=candidates[0];
  if(!row||row.slot&&row.slot!==slot||row.order.status!=='redeemed'||row.order.testOnly||allowedIds&&!allowedIds.has(row.id)){result.unmatched++;continue;}
  const previous:CdekRemittance[]=row.order.cdekRemittances||[];
  const next=[...previous];for(const receipt of receipts)if(!next.some(x=>sameRemittance(x,receipt)))next.push(receipt);
  if(next.length===previous.length){result.unchanged++;continue;}
  const mutation=crypto.randomUUID(),text=next.length>1?'СДЭК: несколько положительных перечислений по заказу — требуется проверка администратора':`СДЭК: деньги получены, реестр №${next[0].registry}, дата перечисления ${next[0].paymentDate}`;
  if(!dryRun){
   const event={id:mutation,orderId:row.id,clientId:row.order.clientId,at,actor:'СДЭК',text};
   const updated={...row.order,cdekRemittances:next,updatedAt:at,_mutation:mutation};
   const batch=await d.batch([
    d.prepare(`UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=? AND data=? AND COALESCE((SELECT data FROM settings WHERE id=?),'')=?`).bind(JSON.stringify(updated),row.id,row.version,row.data,'cdek-shipment-'+row.id,row.shipment||''),
    d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(mutation,row.order.clientId,row.id,at,JSON.stringify(event),row.id,mutation)
   ]);
   if(!batch[0].meta.changes){result.races++;continue;}
  }
  result.orderIds.push(row.id);if(next.length>1)result.conflicts++;else result.added++;
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
  const oldest=await d.prepare(`SELECT MIN(substr(json_extract(data,'$.redeemedAt'),1,10)) day FROM orders WHERE json_extract(data,'$.delivery') IN ('cdek_pickup','cdek_courier') AND json_extract(data,'$.status')='redeemed' AND COALESCE(json_extract(data,'$.testOnly'),0)<>1`).first();
  const start=day.safeParse(oldest?.day).success&&oldest.day<=today?oldest.day:today;
  const cursor=day.safeParse(state.nextDay).success&&state.nextDay>=start&&state.nextDay<=today?state.nextDay:start;
  const dates=[...new Set([...(now-Date.parse(state.todayCheckedAt||'')<3600000?[]:[today]),cursor])];
  try{
   const keys=JSON.parse(a.data);const token=await cdekToken(keys.clientId,keys.clientSecret,request);
   for(const date of dates){
    const response=await request('https://api.cdek.ru/v2/registries?date='+date,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`СДЭК: реестры недоступны (${response.status})`);
    const result=await applyCdekRegistries(d,slot,await response.json(),at);
    totals.checked++;totals.added+=result.added;totals.conflicts+=result.conflicts;
    if(result.races)throw Error('Заказы изменились во время сверки, будет повтор');
    if(date===today)state.todayCheckedAt=at;
    if(date===cursor)state.nextDay=date>=today?start:datePlus(date,1);
   }
   state.error=undefined;
  }catch(e){totals.failed++;state.error=e instanceof Error?e.message:'Ошибка чтения реестров СДЭК';}
  state.checkedAt=at;
  await d.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(state)).run();
 }));
 return totals;
}

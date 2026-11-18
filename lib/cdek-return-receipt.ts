import type {ActivityDb as Db} from './activity-store.ts';
import {cdekToken} from './cdek.ts';
import {verifiedReturn} from './cdek-return-verification.ts';
import {legacyReturnItems} from './warehouse-return.ts';
import type {Order} from './crm.ts';
export function returnDeliveredAt(data:any){
 const statuses=data.entity?.statuses;if(!Array.isArray(statuses))return undefined;
 const last=statuses.filter(s=>!s.deleted&&Number.isFinite(Date.parse(s.date_time))).sort((a,b)=>Date.parse(b.date_time)-Date.parse(a.date_time))[0];
 if(last?.code!=='DELIVERED'||!Number.isFinite(Date.parse(last.date_time)))return undefined;
 return new Date(last.date_time).toISOString();
}
export async function syncCdekReturnReceipts(d:Db,request:typeof fetch=fetch){
 const rows=(await d.prepare(`SELECT o.id,o.data,o.version,s.data shipment FROM orders o JOIN settings s ON s.id='cdek-shipment-'||o.id LEFT JOIN settings ch ON ch.id='cdek-receipt-check-'||o.id WHERE json_extract(o.data,'$.status')='returned' AND json_extract(o.data,'$.delivery') IN ('cdek_pickup','cdek_courier') AND COALESCE(json_extract(o.data,'$.warehouseReturnedAt'),'')='' AND COALESCE(json_extract(o.data,'$.cdekReturn.uuid'),'')<>'' AND (json_extract(o.data,'$.legacyLv') IS NULL OR json_extract(o.data,'$.legacyLv.trial')=0) AND COALESCE(json_extract(o.data,'$.testOnly'),0)<>1 AND COALESCE(json_extract(ch.data,'$.at'),'')<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes') ORDER BY COALESCE(json_extract(ch.data,'$.at'),''),o.id LIMIT 25`).all()).results as {id:string;data:string;version:number;shipment:string}[];
 const tokens=new Map<number,Promise<string>>();const counts={checked:0,received:0,failed:0};
 let cursor=0;
 async function worker(){while(cursor<rows.length){const row=rows[cursor++];const at=new Date().toISOString();let error='';try{
  const o=JSON.parse(row.data) as Order,s=JSON.parse(row.shipment);if(!s.uuid||!s.number||![1,2,3,4].includes(s.slot))throw Error('Нет исходной накладной СДЭК');
  if(!tokens.has(s.slot))tokens.set(s.slot,(async()=>{const a=await d.prepare('SELECT data FROM settings WHERE id=?').bind('cdek-'+s.slot).first();if(!a)throw Error('Аккаунт СДЭК не подключён');const k=JSON.parse(a.data);return cdekToken(k.clientId,k.clientSecret,request);})());
  const token=await tokens.get(s.slot);
  const get=async(path:string)=>{const r=await request('https://api.cdek.ru/v2'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Ошибка проверки СДЭК HTTP '+r.status);return r.json();};
  const original=await get('/orders/'+encodeURIComponent(s.uuid)),returned=await get('/orders/'+encodeURIComponent(o.cdekReturn!.uuid));
  if(verifiedReturn(original,returned,s.uuid,String(s.number),o.cdekReturn!.number)!==o.cdekReturn!.uuid)throw Error('СДЭК вернул другую возвратную накладную');
  const deliveredAt=returnDeliveredAt(returned);counts.checked++;if(deliveredAt){
   const mutation=crypto.randomUUID();const next={...o,warehouseReturnedAt:at,cdekReturnReceipt:{deliveredAt,detectedAt:at},updatedAt:at,_mutation:mutation};
   const items=o.legacyLv?legacyReturnItems(o,(await d.prepare('SELECT p.id,p.data,s.blocked FROM products p JOIN product_stock s ON s.id=p.id').all()).results.map((p:{id:string;data:string;blocked:number})=>({id:p.id,name:JSON.parse(p.data).name,blocked:!!p.blocked}))):[];
   for(const item of items)if(await d.prepare('SELECT id FROM stock_movements WHERE id=?').bind('legacy-return:'+o.id+':'+item.productId).first())throw Error('Возврат уже учтён в движениях склада. Требуется проверка');
   const gate="EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)";
   const event={id:mutation,clientId:o.clientId,orderId:o.id,at,actor:'СДЭК',text:'Автоматический возврат на склад · СДЭК вручил возвратную накладную '+o.cdekReturn!.number+' · '+deliveredAt+' · товары оприходованы, требуется сверка логистом'};
   const result=await d.batch([
    d.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=? AND data=? AND EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)").bind(JSON.stringify(next),o.id,row.version,row.data,'cdek-shipment-'+o.id,row.shipment),
    ...items.map(i=>d.prepare('INSERT INTO stock_movements(id,product_id,quantity,reason,actor_id,at) SELECT ?,?,?,?,?,? WHERE '+gate).bind('legacy-return:'+o.id+':'+i.productId,i.productId,i.quantity,'Физический возврат по API СДЭК '+o.id,'system',at,o.id,mutation)),
    d.prepare('INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE '+gate).bind(mutation,o.clientId,o.id,at,JSON.stringify(event),o.id,mutation)
   ]);if(result[0].meta.changes)counts.received++;
  }
 }catch(e){counts.failed++;error=e instanceof Error?e.message:'Ошибка проверки возврата';}
 await d.prepare("INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind('cdek-receipt-check-'+row.id,JSON.stringify({at,error})).run();
 }}
 await Promise.all(Array.from({length:3},()=>worker()));return counts;
}

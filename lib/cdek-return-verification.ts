import type {ActivityDb as Db} from './activity-store.ts';
import type {Order} from './crm.ts';
import {cdekToken} from './cdek.ts';
import {initRedemption} from './redemption.ts';

export function verifiedReturn(original:any,returned:any,originalUuid:string,originalNumber:string,number:string){
 const source=original.entity,target=returned.entity;
 if(source?.uuid!==originalUuid||String(source?.cdek_number)!==originalNumber)throw Error('СДЭК не подтвердил исходную накладную');
 if(String(target?.cdek_number)!==number||target?.is_return!==true||typeof target.uuid!=='string')throw Error('Номер не является возвратной накладной СДЭК');
 const forward=(Array.isArray(original.related_entities)?original.related_entities:[]).some((r:any)=>r.type==='return_order'&&r.uuid===target.uuid&&String(r.cdek_number)===number);
 const backward=(Array.isArray(returned.related_entities)?returned.related_entities:[]).some((r:any)=>r.type==='direct_order'&&r.uuid===originalUuid&&String(r.cdek_number)===originalNumber);
 if(!forward||!backward)throw Error('Возвратная накладная относится к другому заказу');
 return target.uuid as string;
}

export async function syncCdekReturns(d:Db,request:typeof fetch=fetch){
 await initRedemption(d);
 const rows=(await d.prepare(`SELECT r.order_id,r.data,r.version,o.data order_data,o.version order_version,s.data shipment FROM redemption_entries r JOIN orders o ON o.id=r.order_id LEFT JOIN settings s ON s.id='cdek-shipment-'||r.order_id WHERE json_extract(r.data,'$.result')='returned' AND COALESCE(json_extract(r.data,'$.returnWaybill'),'')<>'' AND json_extract(r.data,'$.returnCheck.state') IS NOT 'verified' AND COALESCE(json_extract(o.data,'$.testOnly'),0)<>1 ORDER BY COALESCE(json_extract(r.data,'$.returnCheck.at'),''),r.order_id LIMIT 50`).all()).results;
 const tokens=new Map<number,Promise<string>>(),counts={checked:0,verified:0,failed:0};
 let cursor=0;
 async function work(){while(cursor<rows.length){
  const row=rows[cursor++];
  const entry=JSON.parse(row.data),order=JSON.parse(row.order_data) as Order,shipment=JSON.parse(row.shipment||'{}'),at=new Date().toISOString();
  try{
   if(!shipment.uuid||!shipment.number||![1,2,3,4].includes(shipment.slot))throw Error('Нет данных исходной накладной СДЭК');
   let token=tokens.get(shipment.slot);
   if(!token){token=(async()=>{const account=await d.prepare('SELECT data FROM settings WHERE id=?').bind('cdek-'+shipment.slot).first();if(!account)throw Error('Аккаунт СДЭК не подключён');const keys=JSON.parse(account.data);return cdekToken(keys.clientId,keys.clientSecret,request);})();tokens.set(shipment.slot,token);}
   const accessToken=await token;
   async function get(path:string){const r=await request('https://api.cdek.ru/v2'+path,{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('СДЭК временно недоступен или накладная не найдена (HTTP '+r.status+')');return await r.json();}
   const original=await get('/orders/'+encodeURIComponent(shipment.uuid)),returned=await get('/orders?cdek_number='+encodeURIComponent(entry.returnWaybill));
   const uuid=verifiedReturn(original,returned,shipment.uuid,String(shipment.number),entry.returnWaybill);
   const mutation=crypto.randomUUID(),e={...entry,returnCheck:{state:'verified',at},returnVerifiedAt:at,returnVerifiedBy:'API СДЭК',updatedAt:at,changedBy:'API СДЭК',changeKind:'verify_return_api'};
   const next={...order,status:'returned',returnedAt:order.returnedAt||at,contact:'none',due:'',updatedAt:at,_mutation:mutation,cdekReturn:{number:entry.returnWaybill,uuid,originalUuid:shipment.uuid,verifiedAt:at}};
   const gate="EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)";
   const event={id:mutation,orderId:row.order_id,clientId:order.clientId,actor:'СДЭК',at,text:'Возврат подтверждён API СДЭК · возвратная накладная '+entry.returnWaybill+' связана с исходной '+shipment.number+'. Ожидается физический приём на склад.'};
   const result=await d.batch([
    d.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=? AND data=? AND EXISTS(SELECT 1 FROM redemption_entries WHERE order_id=? AND version=? AND data=?) AND EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)').bind(JSON.stringify(next),row.order_id,row.order_version,row.order_data,row.order_id,row.version,row.data,'cdek-shipment-'+row.order_id,row.shipment),
    d.prepare('UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id=? AND version=? AND '+gate).bind(JSON.stringify(e),row.order_id,row.version,row.order_id,mutation),
    d.prepare('INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE '+gate).bind(mutation,order.clientId,row.order_id,at,JSON.stringify(event),row.order_id,mutation)
   ]);
   counts.checked++;if(result[0].meta.changes)counts.verified++;
  }catch(error){
   counts.failed++;
   await d.prepare('UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id=? AND version=? AND data=?').bind(JSON.stringify({...entry,returnCheck:{state:'error',at,error:error instanceof Error?error.message:'Не удалось проверить накладную'},updatedAt:at,changedBy:'API СДЭК',changeKind:'return_check'}),row.order_id,row.version,row.data).run();
  }
 }
 }
 await Promise.all(Array.from({length:Math.min(4,rows.length)},work));
 return counts;
}

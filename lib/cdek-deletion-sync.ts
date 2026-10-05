import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import {cdekToken} from './cdek.ts';
import type {Shipment} from './cdek-shipment.ts';
import {applyCdekDeletion} from './cdek-deletion.ts';

export async function syncCdekDeletions(d:Db,request:typeof fetch=fetch){
 const rows=(await d.prepare("SELECT s.data shipment,o.data order_data,o.version FROM settings s JOIN orders o ON s.id='cdek-shipment-' || o.id WHERE json_extract(s.data,'$.state')='deleting' AND COALESCE(json_extract(o.data,'$.testOnly'),0)<>1").all()).results;
 const tokens=new Map<number,string>(),counts={checked:0,completed:0,pending:0,failed:0};
 for(const row of rows){
  try{
   const shipment=JSON.parse(row.shipment) as Shipment,order={...JSON.parse(row.order_data),version:row.version};
   const uuid=z.string().uuid().parse(shipment.uuid);
   let token=tokens.get(shipment.slot);
   if(!token){
    const account=await d.prepare('SELECT data FROM settings WHERE id=?').bind('cdek-'+shipment.slot).first();
    if(!account)throw Error('Аккаунт СДЭК не подключён');const keys=JSON.parse(account.data);
    token=await cdekToken(keys.clientId,keys.clientSecret,request);tokens.set(shipment.slot,token);
   }
   const response=await request('https://api.cdek.ru/v2/orders/'+uuid,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
   const data=await response.json() as any;
   const result=await applyCdekDeletion(d,order,shipment,row.shipment,data,false,response.status);
   counts.checked++;
   if('changed' in result&&result.changed)counts.completed++;else counts.pending++;
  }catch{
   // Network errors and competing refreshes leave the persistent queue intact for the next minute.
   counts.failed++;
  }
 }
 return counts;
}

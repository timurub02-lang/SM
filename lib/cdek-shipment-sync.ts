import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import {statuses,type Order} from './crm.ts';
import {cdekToken} from './cdek.ts';
import {cdekStatusPatch} from './cdek-sync.ts';
import {shipmentResult,cdekErrors,type Shipment} from './cdek-shipment.ts';

// The card and worker share identity checks and one atomic status/history write.
export async function applyCdekShipment(d:Db,order:Order,stored:Shipment,previous:string,data:any,uuid=stored.uuid){
 if(stored.state==='deleting')throw Error('СДЭК обрабатывает удаление');
 if(!uuid||data.entity?.uuid!==uuid)throw Error('СДЭК вернул другой идентификатор отправления');
 if(data.entity?.number!==order.id)throw Error('СДЭК не подтвердил номер заказа');
 const rules=await d.prepare("SELECT data FROM settings WHERE id='cdek-status-mapping'").first();
 const config=rules?JSON.parse(rules.data):{mapping:{},revision:''};
 const patch=cdekStatusPatch(order,data.entity,config.mapping,config.revision);
 const at=new Date().toISOString(),mutation=crypto.randomUUID(),key='cdek-shipment-'+order.id;
 const shipment:Shipment={...stored,...shipmentResult(data),checkedAt:at,syncError:undefined};
 const next=JSON.stringify(shipment),statements=[];
 if(patch)statements.push(d.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)').bind(JSON.stringify({...order,...patch,updatedAt:at,_mutation:mutation}),order.id,order.version,key,previous));
 statements.push(d.prepare(`UPDATE settings SET data=? WHERE id=? AND data=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?${patch?" AND json_extract(data,'$._mutation')=?":""})`).bind(next,key,previous,order.id,order.version+(patch?1:0),...(patch?[mutation]:[])));
 if(patch){
  const event={id:mutation,clientId:order.clientId,orderId:order.id,at,actor:'СДЭК',text:patch.status?`СДЭК: ${patch.cdekStatus?.code} → ${statuses[patch.status]}`:patch.cdekStatus?`Обновлён статус СДЭК: ${patch.cdekStatus.code}`:'Уточнена дата регистрации отправления в СДЭК'};
  statements.push(d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(event.id,event.clientId,event.orderId,at,JSON.stringify(event),order.id,mutation));
 }
 const result=await d.batch(statements);
 if(!result[0].meta.changes)throw Error('Заказ или отправление изменились. Повторите проверку статуса');
 return {shipment,changed:!!patch};
}

export async function syncCdekShipments(d:Db,request:typeof fetch=fetch){
 // A bounded oldest-first queue limits load and gives failures a turn again next cycle.
 const rows=(await d.prepare("SELECT s.id,s.data shipment,o.data order_data,o.version FROM settings s JOIN orders o ON s.id='cdek-shipment-' || o.id WHERE json_extract(s.data,'$.uuid') IS NOT NULL AND json_extract(s.data,'$.state') IN ('sending','pending','ready','unknown') AND json_extract(o.data,'$.status') NOT IN ('redeemed','returned','refused') AND COALESCE(json_extract(o.data,'$.testOnly'),0)<>1 ORDER BY COALESCE(json_extract(s.data,'$.checkedAt'),''),s.id LIMIT 200").all()).results;
 const tokens=new Map<number,Promise<string>>(),pausedSlots=new Set<number>();
 const counts={checked:0,changed:0,failed:0};let cursor=0;
 async function work(){
  while(cursor<rows.length){
   const row=rows[cursor++],shipment=JSON.parse(row.shipment) as Shipment,order={...JSON.parse(row.order_data),version:row.version} as Order;
   try{
    if(pausedSlots.has(shipment.slot))throw Error('СДЭК временно ограничил запросы аккаунта');
    const uuid=z.string().uuid().parse(shipment.uuid);
    let token=tokens.get(shipment.slot);
    if(!token){token=(async()=>{const account=await d.prepare('SELECT data FROM settings WHERE id=?').bind('cdek-'+shipment.slot).first();if(!account)throw Error('Аккаунт СДЭК не подключён');const keys=JSON.parse(account.data);return cdekToken(keys.clientId,keys.clientSecret,request);})();tokens.set(shipment.slot,token);}
    const response=await request('https://api.cdek.ru/v2/orders/'+uuid,{headers:{Authorization:'Bearer '+await token},signal:AbortSignal.timeout(20000)});
    if(response.status===429||response.status===401)pausedSlots.add(shipment.slot);
    const data=await response.json() as any;
    if(!response.ok)throw Error(cdekErrors(data)||`СДЭК: ошибка ${response.status}`);
    const result=await applyCdekShipment(d,order,shipment,row.shipment,data);
    counts.checked++;if(result.changed)counts.changed++;
   }catch(e){
    counts.failed++;
    const next={...shipment,checkedAt:new Date().toISOString(),syncError:e instanceof Error?e.message:'Не удалось проверить статус'};
    await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=?').bind(JSON.stringify(next),row.id,row.shipment).run();
   }
  }
 }
 await Promise.all(Array.from({length:Math.min(4,rows.length)},work));
 await d.prepare("INSERT INTO settings(id,data) VALUES('cdek-sync-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({...counts,at:new Date().toISOString()})).run();
 return counts;
}

import type {ActivityDb as Db} from './activity-store.ts';
import type {Order} from './crm.ts';
import {hasRemittanceConflict,type CdekRemittance} from './cdek-remittance.ts';

// Indexed source snapshots for history-only orders. They are not working orders or payroll entries.
export async function initCdekHistoryRecovery(d:Db){
 await d.prepare('CREATE TABLE IF NOT EXISTS cdek_history_recovery (external_id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),tracking TEXT NOT NULL,data TEXT NOT NULL)').run();
 await d.prepare('CREATE INDEX IF NOT EXISTS cdek_history_recovery_tracking ON cdek_history_recovery(tracking)').run();
}
export async function recoverCdekHistory(d:Db,tracking:string,receipts:CdekRemittance[],at:string,dryRun=false){
 const candidates=(await d.prepare(`SELECT r.external_id,r.client_id,r.data,c.data client,c.version FROM cdek_history_recovery r JOIN clients c ON c.id=r.client_id WHERE r.tracking=? AND EXISTS(SELECT 1 FROM json_each(c.data,'$.legacyOrderHistory') h WHERE json_extract(h.value,'$.externalId')=r.external_id AND json_extract(h.value,'$.status')='paid')`).bind(tracking).all()).results;
 if(!candidates.length)return {status:'unmatched' as const};
 if(candidates.length!==1)return {status:'ambiguous' as const};
 const row=candidates[0],order=JSON.parse(row.data) as Order,client=JSON.parse(row.client);
 if(order.id!=='LV-'+row.external_id||order.clientId!==row.client_id||order.legacyLv?.orderId!==row.external_id||order.status!=='redeemed'||!!order.delivery&&!['cdek_pickup','cdek_courier'].includes(order.delivery)||String(order.cdekTrackingNumber||order.legacyLv?.track)!==tracking||order.testOnly||order.cdekTariff?.slot&&order.cdekTariff.slot!==receipts[0].slot)return {status:'unmatched' as const};
 const existing=await d.prepare("SELECT id FROM orders WHERE id=? OR json_extract(data,'$.legacyLv.orderId')=?").bind(order.id,row.external_id).first();
 if(existing)return {status:'unmatched' as const};
 if(!order.manager||!order.legacyLv?.originalOperatorLogin)return {status:'unmatched' as const};
 const stored=await d.prepare("SELECT data FROM settings WHERE id='premium-ledger'").first();
 const ledger=stored?JSON.parse(stored.data):null;
 // Even a new registry must not revive an order from an existing payout statement.
 if(Object.values(ledger?.periods||{}).some((p:any)=>(p.orders||[]).some((o:any)=>String(o.externalId)===row.external_id)))return {status:'archived' as const};
 const index=client.legacyOrderHistory.findIndex((h:any)=>h.externalId===row.external_id&&h.status==='paid');
 if(index<0)return {status:'unmatched' as const};
 const mutation=crypto.randomUUID(),first=receipts[0];
 const restored={...order,cdekRemittances:receipts,updatedAt:at,_mutation:mutation,cdekHistoryRecovery:{at,registry:first.registry,paymentDate:first.paymentDate}};
 const conflict=hasRemittanceConflict(restored);
 if(dryRun)return {status:'created' as const,id:order.id,conflict};
 const event={id:mutation,orderId:order.id,clientId:order.clientId,at,actor:'СДЭК',text:`Заказ создан из истории согласно реестру СДЭК №${first.registry}, дата перечисления ${first.paymentDate}${conflict?' · несколько перечислений, требуется проверка администратора':''}`};
 const result=await d.batch([
  d.prepare(`INSERT INTO orders(id,client_id,data,version) SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=? AND data=?) AND COALESCE((SELECT data FROM settings WHERE id='premium-ledger'),'')=? AND NOT EXISTS(SELECT 1 FROM orders WHERE id=? OR json_extract(data,'$.legacyLv.orderId')=?)`).bind(order.id,order.clientId,JSON.stringify(restored),row.client_id,row.version,row.client,stored?.data||'',order.id,row.external_id),
  d.prepare("UPDATE clients SET data=json_set(json_remove(data,?),'$.version',version+1),version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(`$.legacyOrderHistory[${index}]`,row.client_id,order.id,mutation),
  d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(mutation,order.clientId,order.id,at,JSON.stringify(event),order.id,mutation)
 ]);
 return result[0].meta.changes?{status:'created' as const,id:order.id,conflict}:{status:'race' as const};
}

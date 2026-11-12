import type {ActivityDb as Db} from './activity-store.ts';
import type {Order} from './crm.ts';

export function skLeadUrl(value:unknown){
 const id=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
 return typeof id==='string'&&/^[1-9]\d{0,19}$/.test(id)?'https://app1.skorozvon.ru/#/leads/'+id:null;
}
export function trustedSkLeadUrl(value:unknown){
 if(typeof value!=='string'||!value.trim())return null;
 try{const u=new URL(value.trim());
  if(u.origin!=='https://app1.skorozvon.ru'||u.username||u.password||u.pathname!=='/'||u.search)return null;
  return skLeadUrl(/^#\/leads\/([1-9]\d{0,19})\/?$/.exec(u.hash)?.[1]);
 }catch{return null;}
}
export async function orderSkClientLink(d:Db,order:Order,request:typeof fetch=fetch):Promise<string|null>{
 if(order.skLeadId)return skLeadUrl(order.skLeadId);
 if(await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sk_order_transfers'").first()){
  const rows=(await d.prepare("SELECT data FROM sk_order_transfers WHERE order_id=? AND state='imported' LIMIT 2").bind(order.id).all()).results;
  if(rows.length)return rows.length===1?skLeadUrl(JSON.parse(rows[0].data).leadId):null;
 }
 if(order.legacyLv){
  const id=order.legacyLv.orderId;
  if(!/^\d+$/.test(id))return null;
  const row=await d.prepare("SELECT data FROM settings WHERE id='lv-warehouse'").first();
  if(!row)return null;
  const config=JSON.parse(row.data);
  if(!config.token||!config.host)return null;
  if(!/^[a-z0-9][a-z0-9-]*\.leadvertex\.ru$/.test(config.host))throw Error('Неверный адрес ЛВ');
  const url=new URL('https://'+config.host+'/api/admin/getOrdersByIds.html');
  url.searchParams.set('token',config.token);url.searchParams.set('ids',id);
  const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('ЛВ недоступен');
  const data=await response.json() as Record<string,{additional9?:unknown}>&{error?:unknown;errors?:unknown};
  if(!data||typeof data!=='object'||data.error||data.errors||!data[id])throw Error('Заказ не найден в ЛВ');
  const source=data[id].additional9;
  if(!source)return null;
  const link=trustedSkLeadUrl(source);
  if(!link)throw Error('В ЛВ сохранена некорректная ссылка СК');
  return link;
 }
 const client=await d.prepare('SELECT data FROM clients WHERE id=?').bind(order.clientId).first();
 return client?skLeadUrl(JSON.parse(client.data).skLeadId):null;
}

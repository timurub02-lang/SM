import type {ActivityDb as Db} from './activity-store.ts';
import type {Order} from './crm.ts';
import {normalizePhone} from './crm.ts';

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
async function lvClientLink(d:Db,ids:string[],request:typeof fetch,phones?:Set<string>,unavailable=new Set<string>()){
  ids=[...new Set(ids.filter(id=>/^\d+$/.test(id)))];
  if(!ids.length||phones&&!phones.size)return null;
  const row=await d.prepare("SELECT data FROM settings WHERE id='lv-warehouse'").first();
  if(!row)return null;
  const config=JSON.parse(row.data);
  if(!config.token||!config.host)return null;
  if(!/^[a-z0-9][a-z0-9-]*\.leadvertex\.ru$/.test(config.host))throw Error('Неверный адрес ЛВ');
  const batches:string[][]=[];for(let i=0;i<ids.length;i+=100)batches.push(ids.slice(i,i+100));
  const results=await Promise.all(batches.map(async batch=>{
   const url=new URL('https://'+config.host+'/api/admin/getOrdersByIds.html');
   url.searchParams.set('token',config.token);url.searchParams.set('ids',batch.join(','));
   const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error('ЛВ недоступен');
   const data=await response.json() as Record<string,{additional9?:unknown;phone?:unknown}>&{error?:unknown;errors?:unknown};
   if(!data||typeof data!=='object'||Array.isArray(data)||data.error||data.errors)throw Error('Заказ не найден в ЛВ');
   const links:string[]=[];
   for(const id of batch){
    const source=data[id];
    if(!source){if(!phones)throw Error('Заказ не найден в ЛВ');continue;}
    // A link inherited from another order must still belong to this client's phone.
    if(phones&&!phones.has(normalizePhone(typeof source.phone==='string'?source.phone:'')))continue;
    if(!source.additional9)continue;
    const link=trustedSkLeadUrl(source.additional9);
    if(!link)throw Error('В ЛВ сохранена некорректная ссылка СК');
    if(!unavailable.has(link.split('/').pop()!))links.push(link);
   }
   return links;
  }));
  const links=[...new Set(results.flat())];return links.length===1?links[0]:null;
}
export async function orderSkClientLink(d:Db,order:Order,request:typeof fetch=fetch):Promise<string|null>{
 const client=await d.prepare('SELECT data FROM clients WHERE id=?').bind(order.clientId).first();
 const c=client?JSON.parse(client.data):{};
 const unavailable=new Set<string>(Array.isArray(c.skUnavailableLeadIds)?c.skUnavailableLeadIds.filter((id:unknown)=>typeof id==='string'&&/^[1-9]\d{0,19}$/.test(id)):[]);
 const available=(id:unknown)=>!unavailable.has(String(id))?skLeadUrl(id):null;
 if(order.skLeadId&&!unavailable.has(String(order.skLeadId)))return skLeadUrl(order.skLeadId);
 const hasTransfers=!!await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sk_order_transfers'").first();
 if(hasTransfers){
  const rows=(await d.prepare("SELECT data FROM sk_order_transfers WHERE order_id=? AND state='imported' LIMIT 2").bind(order.id).all()).results;
  if(rows.length>1)return null;
  if(rows.length){const id=JSON.parse(rows[0].data).leadId;if(!unavailable.has(String(id)))return skLeadUrl(id);}
 }
 if(order.legacyLv){const link=await lvClientLink(d,[order.legacyLv.orderId],request);if(!link||!unavailable.has(link.split('/').pop()!))return link;}
 if(!client)return null;
 if(c.skLeadId&&!unavailable.has(String(c.skLeadId)))return skLeadUrl(c.skLeadId);
 const history:Order[]=(await d.prepare('SELECT data FROM orders WHERE client_id=? AND id<>?').bind(order.clientId,order.id).all()).results.map((r:{data:string})=>JSON.parse(r.data) as Order);
 const links=history.map(o=>available(o.skLeadId)).filter((link):link is string=>link!==null);
 if(hasTransfers){
  const rows=(await d.prepare("SELECT t.data FROM sk_order_transfers t JOIN orders o ON o.id=t.order_id WHERE o.client_id=? AND t.state='imported'").bind(order.clientId).all()).results;
  for(const row of rows){const link=available(JSON.parse(row.data).leadId);if(link)links.push(link);}
 }
 const unique=[...new Set(links)];if(unique.length)return unique.length===1?unique[0]:null;
 const phones=new Set<string>([c.phone,...(c.linkedPhones||[])].map((p:unknown)=>normalizePhone(typeof p==='string'?p:'')).filter(Boolean));
 return lvClientLink(d,history.flatMap((o:Order)=>o.legacyLv?[o.legacyLv.orderId]:[]),request,phones,unavailable);
}

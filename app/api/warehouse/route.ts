import {authenticated} from '@/lib/api-auth';
import {initInventory} from '@/lib/inventory';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {warehouseAddressSchema,productSchema} from '@/lib/warehouse';
import {z} from 'zod';
import {cdekToken} from '@/lib/cdek';
async function offices(query:URLSearchParams){
 const row=await db().prepare("SELECT data FROM settings WHERE id IN ('cdek-1','cdek-2','cdek-3','cdek-4') ORDER BY id LIMIT 1").first<{data:string}>();
 if(!row)throw Error('Подключите аккаунт СДЭК в настройках');const keys=JSON.parse(row.data);const token=await cdekToken(keys.clientId,keys.clientSecret);
 const r=await fetch('https://api.cdek.ru/v2/deliverypoints?'+query,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Не удалось загрузить ПВЗ СДЭК');const list=await r.json() as any[];if(!Array.isArray(list))throw Error('СДЭК не вернул список ПВЗ');
 return list.filter(x=>x.status==='ACTIVE'&&x.is_reception).map(x=>({code:x.code,address:x.location?.address_full||x.location?.address||x.code}));
}
async function init(){await initInventory();await db().prepare('CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)').run();await db().prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('warehouse-address',?)").bind(JSON.stringify({address:'127422',postalCode:'127422'})).run();}
async function permitted(actorId:string){const r=await db().prepare('SELECT data FROM employees WHERE id=?').bind(actorId).first<{data:string}>();return r&&['admin','logistic'].includes(JSON.parse(r.data).role);}
async function handleGET(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(new URL(req.url).searchParams.has('catalog')){await init();const rows=await db().prepare('SELECT id,data FROM products ORDER BY name_key').all<{id:string;data:string}>();return Response.json({products:rows.results.map(r=>{const p=JSON.parse(r.data);return {id:r.id,name:p.name,tag:p.tag||''};})},{headers:{'Cache-Control':'no-store'}});}
 if(!await permitted(new URL(req.url).searchParams.get('actorId')||''))return Response.json({error:'Склад доступен администратору и логисту'},{status:403});
 if(new URL(req.url).searchParams.has('movements')){await init();const r=await db().prepare(`SELECT m.id,m.quantity,m.reason,m.at,COALESCE(json_extract(e.data,'$.login'),m.actor_id) AS actor FROM stock_movements m LEFT JOIN employees e ON e.id=m.actor_id WHERE m.product_id=? ORDER BY m.at DESC LIMIT 30`).bind(new URL(req.url).searchParams.get('movements')).all();return Response.json({movements:r.results},{headers:{'Cache-Control':'no-store'}});}
 if(new URL(req.url).searchParams.has('points')){try{const postal=z.string().regex(/^\d{6}$/).parse(new URL(req.url).searchParams.get('postalCode'));return Response.json({points:await offices(new URLSearchParams({postal_code:postal,type:'PVZ',country_code:'RU',is_reception:'true'}))},{headers:{'Cache-Control':'no-store'}});}catch(e){return Response.json({error:e instanceof z.ZodError?'Укажите индекс из 6 цифр':e instanceof Error?e.message:'Не удалось загрузить ПВЗ'},{status:400});}}
 await init();const r=await db().prepare(`SELECT p.id,p.data,p.version,s.available,s.reserved,s.sold,s.supplied,EXISTS(SELECT 1 FROM orders o,json_each(o.data,'$.items') i WHERE json_extract(i.value,'$.name')=json_extract(p.data,'$.name')) AS nameLocked FROM products p JOIN product_stock s ON s.id=p.id ORDER BY p.name_key`).all<{id:string;data:string;version:number;available:number;reserved:number;sold:number;supplied:number;nameLocked:number}>();
 const addressRow=await db().prepare("SELECT data FROM settings WHERE id='warehouse-address'").first<{data:string}>();
 return Response.json({warehouseAddress:JSON.parse(addressRow!.data),products:r.results.map(x=>({...JSON.parse(x.data),id:x.id,version:x.version,nameLocked:!!x.nameLocked,stock:{available:x.available,reserved:x.reserved,sold:x.sold,supplied:x.supplied}}))},{headers:{'Cache-Control':'no-store'}});
}
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>4000)throw Error();const p=JSON.parse(raw);
  if(!await permitted(z.string().parse(p.actorId)))return Response.json({error:'Склад доступен администратору и логисту'},{status:403});
  await init();if(p.action==='stock'){
   const movement=z.object({id:z.string().uuid(),productId:z.string().min(1),quantity:z.number().int().min(1).max(1000000),kind:z.enum(['add','remove']),reason:z.string().trim().min(1,'Укажите основание движения').max(500)}).parse(p.movement);
   const quantity=movement.kind==='add'?movement.quantity:-movement.quantity;
   const existing=await db().prepare('SELECT product_id,quantity,reason,actor_id FROM stock_movements WHERE id=?').bind(movement.id).first<{product_id:string;quantity:number;reason:string;actor_id:string}>();
   if(existing&&(existing.product_id!==movement.productId||existing.quantity!==quantity||existing.reason!==movement.reason||existing.actor_id!==p.actorId))throw Error('Операция остатков уже существует с другими данными');
   await db().prepare('INSERT OR IGNORE INTO stock_movements(id,product_id,quantity,reason,actor_id,at) VALUES(?,?,?,?,?,?)').bind(movement.id,movement.productId,quantity,movement.reason,p.actorId,new Date().toISOString()).run();
   return Response.json({ok:true});
  }if(p.action==='saveAddress'){const address=warehouseAddressSchema.parse(p.address);const code=z.string().trim().max(255).parse(p.shipmentPointCode||'');let shipmentPoint=null;if(code){const list=await offices(new URLSearchParams({code,type:'PVZ',is_reception:'true'}));shipmentPoint=list.find(x=>x.code===code);if(!shipmentPoint)throw Error('Выбранный ПВЗ отправления недоступен');}const saved={...address,shipmentPoint};await db().prepare("UPDATE settings SET data=? WHERE id='warehouse-address'").bind(JSON.stringify(saved)).run();return Response.json({ok:true,warehouseAddress:saved});}const product=productSchema.parse(p.product);const nameKey=product.name.toLocaleLowerCase('ru');
  if(p.id){const id=z.string().parse(p.id),version=z.number().int().positive().parse(p.version);const r=await db().prepare('UPDATE products SET name_key=?,data=?,version=version+1 WHERE id=? AND version=?').bind(nameKey,JSON.stringify(product),id,version).run();if(!r.meta.changes)return Response.json({error:'Товар уже изменён. Обновите список и откройте его заново.'},{status:409});}
  else await db().prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').bind(crypto.randomUUID(),nameKey,JSON.stringify(product)).run();
  return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):e instanceof Error&&/ПВЗ|СДЭК|остатк|склад|Товар|товар|Операция/.test(e.message)?e.message:'Не удалось сохранить данные склада. Возможно, товар с таким названием уже существует.'},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import {inventorySQL} from './inventory-sql.ts';

export const lvConfigSchema=z.object({host:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]*\.leadvertex\.ru$/,'Укажите адрес проекта вида project.leadvertex.ru'),token:z.string().trim().min(1).max(512),enabled:z.boolean(),trackCrm:z.boolean(),links:z.record(z.string(),z.string()).default({})});
export type LvConfig=z.infer<typeof lvConfigSchema>;
type Good={id:string;name:string;available:number;active:boolean;weight:number|null;length:number|null;width:number|null;height:number|null;tag:string;price:number|null};
const integer=z.coerce.number().int().safe();
const positive=(value:unknown)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;};
export async function initLvWarehouse(d:Db){if(!await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lv_stock'").first())await d.batch(inventorySQL.map(sql=>d.prepare(sql)));}
export async function readLvConfig(d:Db):Promise<LvConfig|null>{const r=await d.prepare("SELECT data FROM settings WHERE id='lv-warehouse'").first();return r?JSON.parse(r.data):null;}
async function lvRequest(c:LvConfig,method:string,request:typeof fetch,body?:Record<string,string>){
 const url=new URL(`https://${c.host}/api/admin/${method}.html`);url.searchParams.set('token',c.token);
 const r=await request(url.toString(),{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),...(body?{headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)}:{})});
 if(!r.ok)throw Error('ЛВ вернул ошибку '+r.status+'. Проверьте подключение и историю остатков.');
 const data=await r.json() as any;
 if(!data||typeof data!=='object'||data.error||data.errors)throw Error('ЛВ не подтвердил запрос. Проверьте ключ, права API и историю остатков.');
 return data;
}
export async function fetchLvGoods(c:LvConfig,request:typeof fetch=fetch):Promise<Good[]>{
 const data=await lvRequest(c,'getOfferGoods',request);
 if(Array.isArray(data)){if(!data.length)return [];throw Error('Неизвестный формат каталога ЛВ');}
 return Object.entries(data).map(([id,value])=>{
  if(!/^\d+$/.test(id))throw Error('ЛВ не вернул каталог товаров');const p=value as any;
  if(typeof p?.name!=='string'||!p.name.trim()||p.reserve===null||p.reserve===undefined||p.reserve==='')throw Error('ЛВ не вернул название или остаток товара '+id);
  const price=Number(p.price?.['1']);
  return {id,name:p.name.trim(),available:integer.parse(p.reserve),active:p.used===true||p.used===1||p.used==='1',weight:positive(p.weightInGrams),length:positive(p.length),width:positive(p.width),height:positive(p.height),tag:String(p.categoryName||'').slice(0,80),price:p.price?.['1']!==undefined&&Number.isFinite(price)&&price>=0?price:null};
 });
}
export async function withLvLock<T>(d:Db,fn:(renew:()=>Promise<void>)=>Promise<T>):Promise<T>{
 await initLvWarehouse(d);const token=crypto.randomUUID();
 const lock=await d.prepare('INSERT INTO lv_sync_lock(id,token,until_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,until_at=excluded.until_at WHERE lv_sync_lock.until_at<?').bind(token,Date.now()+300000,Date.now()).run();
 if(!lock.meta.changes)throw Error('Обмен с ЛВ уже выполняется. Повторите через минуту.');
 const renew=async()=>{const r=await d.prepare('UPDATE lv_sync_lock SET until_at=? WHERE id=1 AND token=?').bind(Date.now()+300000,token).run();if(!r.meta.changes)throw Error('Проверка обмена с ЛВ прервана');};
 try{return await fn(renew);}finally{await d.prepare('DELETE FROM lv_sync_lock WHERE id=1 AND token=?').bind(token).run();}
}
async function importGoods(d:Db,c:LvConfig,goods:Good[]){
 let added=0;
 const writes=[];
 for(const g of goods){
  const linked=await d.prepare('SELECT * FROM lv_stock WHERE lv_id=?').bind(g.id).first();
  if(linked){
   writes.push(d.prepare("UPDATE lv_stock SET active=?,lv_name=?,available=CASE WHEN EXISTS(SELECT 1 FROM lv_stock_operations WHERE product_id=lv_stock.product_id AND state IN ('sending','unknown')) THEN available ELSE ? END,synced_at=? WHERE lv_id=?").bind(g.active?1:0,g.name,g.available,new Date().toISOString(),g.id));continue;
  }
  if(!g.active)continue;
  const explicit=c.links[g.id];
  const existing=await d.prepare(explicit?'SELECT id,data FROM products WHERE id=?':'SELECT id,data FROM products WHERE name_key=?').bind(explicit||g.name.toLocaleLowerCase('ru')).first();
  if(explicit&&!existing)throw Error('Выбранный товар CRM не найден');
  if(existing&&await d.prepare('SELECT lv_id FROM lv_stock WHERE product_id=?').bind(existing.id).first())throw Error('Товар CRM уже связан с другим товаром ЛВ: '+g.name);
  const id=existing?.id||crypto.randomUUID();
  if(!existing){
   const product={name:g.name,sku:'LV-'+g.id,tag:g.tag,weight:g.weight,cost:null,payment:g.price,packedWeight:null,length:g.length,width:g.width,height:g.height,originMode:'warehouse'};
   writes.push(d.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').bind(id,g.name.toLocaleLowerCase('ru'),JSON.stringify(product)));added++;
  }
  writes.push(d.prepare('INSERT INTO lv_stock(product_id,lv_id,lv_name,active,available,applied_quantity,manual_baseline,synced_at) VALUES(?,?,?,?,?,0,COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=?),0),?)').bind(id,g.id,g.name,1,g.available,id,new Date().toISOString()));
 }
 // Missing goods are kept for old orders, but cannot be selected for new orders.
 const ids=goods.map(g=>g.id);
 const current=(await d.prepare('SELECT lv_id FROM lv_stock').all()).results;
 for(const row of current)if(!ids.includes(row.lv_id))writes.push(d.prepare('UPDATE lv_stock SET active=0 WHERE lv_id=?').bind(row.lv_id));
 if(writes.length)await d.batch(writes);return added;
}
export async function syncLvWarehouse(d:Db,request:typeof fetch=fetch){
 return withLvLock(d,async renew=>{
  const config=await readLvConfig(d);if(!config?.enabled||!config.token)return {skipped:true};
  const c=lvConfigSchema.parse(config),startedAt=new Date().toISOString();
  // A process may have died after LV accepted a movement. Never resend that operation blindly.
  await d.prepare("UPDATE lv_stock_operations SET state='unknown',error='Обмен был прерван. Проверьте операцию в истории остатков ЛВ.' WHERE state='sending'").run();
  try{
   let goods=await fetchLvGoods(c,request);const added=await importGoods(d,c,goods);let sent=0;
   if(c.trackCrm){
    const rows=(await d.prepare('SELECT * FROM lv_stock').all()).results;
    for(const row of rows){
     await renew();
     if(!goods.some(g=>g.id===row.lv_id)||await d.prepare("SELECT id FROM lv_stock_operations WHERE product_id=? AND state IN ('sending','unknown')").bind(row.product_id).first())continue;
     const stock=await d.prepare('SELECT reserved,sold,(SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE product_id=?) manual FROM product_stock WHERE id=?').bind(row.product_id,row.product_id).first();
     const desired=stock.reserved+stock.sold-(stock.manual-row.manual_baseline),change=row.applied_quantity-desired;
     if(!change)continue;
     const id=crypto.randomUUID(),at=new Date().toISOString();
     const comment=`CRM СМ: ${change<0?'резерв / списание':'снятие резерва / возврат / пополнение'}. Резерв ${stock.reserved}, выкуплено ${stock.sold}. Операция ${id}`;
     await d.prepare("INSERT INTO lv_stock_operations(id,product_id,lv_id,quantity,after_quantity,state,at,comment) VALUES(?,?,?,?,?,'sending',?,?)").bind(id,row.product_id,row.lv_id,change,desired,at,comment).run();
     try{
      const answer=await lvRequest(c,change<0?'reduceGoodReserve':'increaseGoodReserve',request,{goodID:row.lv_id,quantity:String(Math.abs(change)),comment});
      if(answer[row.lv_id]!=='OK')throw Error('ЛВ не подтвердил изменение остатка.');
      await d.batch([
       d.prepare('UPDATE lv_stock SET applied_quantity=?,available=available+? WHERE product_id=?').bind(desired,change,row.product_id),
       d.prepare("UPDATE lv_stock_operations SET state='applied',finished_at=? WHERE id=?").bind(new Date().toISOString(),id)
      ]);sent++;
     }catch{
      await d.prepare("UPDATE lv_stock_operations SET state='unknown',error='Подтверждение ЛВ не получено. Автоматическая повторная отправка запрещена: проверьте историю остатков по номеру операции.' WHERE id=?").bind(id).run();
     }
    }
    if(sent){goods=await fetchLvGoods(c,request);await importGoods(d,c,goods);}
   }
   const unknown=(await d.prepare("SELECT COUNT(*) n FROM lv_stock_operations WHERE state='unknown'").first()).n;
   const result={at:new Date().toISOString(),startedAt,active:goods.filter(g=>g.active).length,added,sent,unknown};
   await d.prepare("INSERT INTO settings(id,data) VALUES('lv-warehouse-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(result)).run();return result;
  }catch(e){
   const result={at:new Date().toISOString(),error:'Не удалось завершить обмен с ЛВ. Проверьте подключение; остатки сохранены по последним подтверждённым данным.'};
   await d.prepare("INSERT INTO settings(id,data) VALUES('lv-warehouse-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(result)).run();throw Error(result.error);
  }
 });
}
export async function resolveLvOperation(d:Db,id:string,applied:boolean,actorId:string){
 return withLvLock(d,async()=>{
  const op=await d.prepare("SELECT * FROM lv_stock_operations WHERE id=? AND state='unknown'").bind(id).first();if(!op)throw Error('Операция уже проверена или не найдена');
  await d.batch([
   ...(applied?[d.prepare('UPDATE lv_stock SET applied_quantity=?,available=available+? WHERE product_id=?').bind(op.after_quantity,op.quantity,op.product_id)]:[]),
   d.prepare("UPDATE lv_stock_operations SET state=?,finished_at=?,resolved_by=? WHERE id=? AND state='unknown'").bind(applied?'applied':'not_applied',new Date().toISOString(),actorId,id)
  ]);
 });
}

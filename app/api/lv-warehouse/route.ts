import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {fetchLvGoods,initLvWarehouse,lvConfigSchema,readLvConfig,resolveLvOperation,syncLvWarehouse,withLvLock} from '@/lib/lv-warehouse';
import {z} from 'zod';
async function admin(req:Request){
 if(!await getChatGPTUser())return false;
 const id=new URL(req.url).searchParams.get('actorId')||'';
 const e=await db().prepare('SELECT data FROM employees WHERE id=?').bind(id).first<{data:string}>();
 return e&&JSON.parse(e.data).role==='admin';
}
async function state(){
 const d=db();await initLvWarehouse(d);const c=await readLvConfig(d);
 const health=await d.prepare("SELECT data FROM settings WHERE id='lv-warehouse-health'").first<{data:string}>();
 const source=await d.prepare("SELECT data FROM settings WHERE id='lv-warehouse-source'").first<{data:string}>();
 const products=await d.prepare("SELECT p.id,json_extract(p.data,'$.name') name,l.lv_id,l.lv_name,l.active,l.available,l.synced_at FROM products p LEFT JOIN lv_stock l ON l.product_id=p.id ORDER BY p.name_key").all();
 const operations=await d.prepare("SELECT x.*,json_extract(p.data,'$.name') name FROM lv_stock_operations x JOIN products p ON p.id=x.product_id ORDER BY CASE WHEN x.state IN ('unknown','sending') THEN 0 ELSE 1 END,x.at DESC LIMIT 50").all();
 return {configured:!!c?.token,host:c?.host||(source?JSON.parse(source.data).host:''),enabled:c?.enabled||false,trackCrm:c?.trackCrm||false,links:c?.links||{},health:health?JSON.parse(health.data):null,products:products.results,operations:operations.results};
}
async function handleGET(req:Request){if(!await admin(req))return Response.json({error:'Настройка доступна администратору'},{status:403});return Response.json(await state());}
async function handlePOST(req:Request){
 if(!await admin(req))return Response.json({error:'Настройка доступна администратору'},{status:403});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>12000)throw Error('Слишком большой запрос');const p=JSON.parse(raw),d=db();await initLvWarehouse(d);
  if(p.action==='save'){
   await withLvLock(d,async()=>{
    const old=await readLvConfig(d);const c=lvConfigSchema.parse({...p,token:p.token||old?.token,links:p.links||old?.links||{}});
    const source=await d.prepare("SELECT data FROM settings WHERE id='lv-warehouse-source'").first<{data:string}>();
    if(source&&JSON.parse(source.data).host!==c.host)throw Error('Товары уже связаны с другим проектом ЛВ. Смену склада нужно выполнить отдельно.');
    if(c.enabled){
     const goods=await fetchLvGoods(c);
     for(const [lvId,productId] of Object.entries(c.links)){
      if(!goods.some(g=>g.id===lvId&&g.active)||!await d.prepare('SELECT id FROM products WHERE id=?').bind(productId).first())throw Error('Проверьте соответствие товаров ЛВ и CRM');
      const linked=await d.prepare('SELECT lv_id FROM lv_stock WHERE product_id=? OR lv_id=?').bind(productId,lvId).all();
      if(linked.results.some((x:any)=>x.lv_id!==lvId))throw Error('Товар CRM уже связан с другим товаром ЛВ');
     }
    }
    await d.batch([
     d.prepare("INSERT INTO settings(id,data) VALUES('lv-warehouse',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(c)),
     d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('lv-warehouse-source',?)").bind(JSON.stringify({host:c.host}))
    ]);
   });
  }else if(p.action==='preview'){
   const old=await readLvConfig(d),c=lvConfigSchema.parse({...p,token:p.token||old?.token,enabled:false,trackCrm:false});
   const goods=await fetchLvGoods(c);return Response.json({goods:goods.filter(g=>g.active)});
  }else if(p.action==='sync'){await syncLvWarehouse(d);}
  else if(p.action==='resolve'){
   const v=z.object({id:z.string().uuid(),applied:z.boolean(),confirmed:z.literal(true),actorId:z.string()}).parse(p);
   await resolveLvOperation(d,v.id,v.applied,v.actorId);
  }else if(p.action==='delete'){
   if(p.confirmed!==true)throw Error('Подтвердите удаление подключения');
   await withLvLock(d,async()=>{
    if((await readLvConfig(d))?.enabled)throw Error('Сначала отключите обмен с ЛВ и сохраните настройки');
    if(await d.prepare("SELECT id FROM lv_stock_operations WHERE state IN ('sending','unknown')").first())throw Error('Перед удалением подключения нужно сверить незавершённые операции');
    await d.prepare("DELETE FROM settings WHERE id='lv-warehouse'").run();
   });
  }else throw Error('Неизвестное действие');
  return Response.json(await state());
 }catch(e){return Response.json({error:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):e instanceof Error&&e.name==='Error'?e.message:'Не удалось связаться с ЛВ. Проверьте адрес проекта и API-ключ.'},{status:400});}
}
export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

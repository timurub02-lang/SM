import {initInventory} from '@/lib/inventory';
import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {routingSchema} from '@/lib/cdek-routing';
import {routingSettings,orderRouting,routingKey} from '@/lib/cdek-routing-store';
import type {Order} from '@/lib/crm';
async function actor(req:Request){if(!await getChatGPTUser())throw Error('Требуется вход');const id=new URL(req.url).searchParams.get('actorId')||'';const row=await db().prepare('SELECT data FROM employees WHERE id=?').bind(id).first<{data:string}>();if(!row)throw Error('Нет доступа');return JSON.parse(row.data);}
async function handleGET(req:Request){try{
 const employee=await actor(req),orderId=new URL(req.url).searchParams.get('orderId');
 if(!['admin','logistic','chief_logistic'].includes(employee.role))return Response.json({error:'Нет доступа'},{status:403});
 if(orderId){const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(orderId).first<{data:string}>();if(!row)throw Error('Заказ не найден');const r=await orderRouting(JSON.parse(row.data) as Order);return Response.json({choice:r.choice,accounts:r.accounts});}
 if(employee.role!=='admin')return Response.json({error:'Настройки доступны администратору'},{status:403});
 const {config,accounts}=await routingSettings();await initInventory();const products=await db().prepare('SELECT data FROM products').all<{data:string}>();return Response.json({config,accounts,products:products.results.map(p=>JSON.parse(p.data).name).sort()});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось загрузить правила'},{status:400});}}
async function handlePOST(req:Request){try{
 const employee=await actor(req);if(employee.role!=='admin')return Response.json({error:'Настройки доступны администратору'},{status:403});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 const raw=await req.text();if(raw.length>100000)throw Error('Слишком много правил');const p=routingSchema.parse(JSON.parse(raw));
 const current=await routingSettings();if(p.revision!==current.config.revision)throw Error('Настройки изменены. Откройте их заново');
 if(p.rules.some(r=>r.enabled&&!current.accounts.some(a=>a.slot===r.slot&&a.configured)))throw Error('В правиле выбран неподключённый аккаунт');
 if(p.enabled&&!p.rules.some(r=>r.enabled))throw Error('Добавьте хотя бы одно включённое правило');
 const config={...p,revision:crypto.randomUUID()};const data=JSON.stringify(config);
 const result=current.raw?await db().prepare('UPDATE settings SET data=? WHERE id=? AND data=?').bind(data,routingKey,current.raw).run():await db().prepare('INSERT OR IGNORE INTO settings(id,data) VALUES(?,?)').bind(routingKey,data).run();
 if(!result.meta.changes)throw Error('Настройки изменены. Откройте их заново');
 return Response.json({config});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить правила'},{status:400});}}
export const GET=authenticated(handleGET);export const POST=authenticated(handlePOST);

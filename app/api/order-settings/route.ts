import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {orderSettings} from '@/lib/order-policy-store';
import {orderPolicySchema} from '@/lib/order-policy';
import {z} from 'zod';
async function admin(req:Request){if(!await getChatGPTUser())return false;const id=new URL(req.url).searchParams.get('actorId')||'';const row=await db().prepare('SELECT data FROM employees WHERE id=?').bind(id).first<{data:string}>();return !!row&&JSON.parse(row.data).role==='admin';}
export const GET=authenticated(async req=>{if(!await admin(req))return Response.json({error:'Настройки доступны администратору'},{status:403});return Response.json(await orderSettings());});
export const POST=authenticated(async req=>{if(!await admin(req))return Response.json({error:'Настройки доступны администратору'},{status:403});if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});try{
 const raw=await req.text();if(raw.length>5000)throw Error('Слишком большой запрос');const p=z.object({policy:orderPolicySchema,revision:z.string().max(80)}).parse(JSON.parse(raw));
 const next={policy:p.policy,revision:crypto.randomUUID()};
 const result=await db().prepare("INSERT INTO settings(id,data) SELECT 'order-policy',? WHERE ?='' OR EXISTS(SELECT 1 FROM settings WHERE id='order-policy') ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE json_extract(settings.data,'$.revision')=?").bind(JSON.stringify(next),p.revision,p.revision).run();
 if(!result.meta.changes)return Response.json({error:'Настройки изменились в другом окне. Откройте их заново.'},{status:409});
 return Response.json(next);
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Укажите целое число часов от 1 до 8760 и проверьте переключатели.':'Не удалось сохранить настройки.'},{status:400});}});

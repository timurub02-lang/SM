import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {suggestAddress} from '@/lib/dadata';
import {z} from 'zod';
const key=z.string().trim().regex(/^[a-zA-Z0-9_-]{20,200}$/,'Проверьте формат ключа');
async function config(){const r=await db().prepare("SELECT data FROM settings WHERE id='dadata'").first<{data:string}>();return r?JSON.parse(r.data):{};}
async function handleGET(){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const c=await config();return Response.json({configured:!!c.token,secretConfigured:!!c.secret},{headers:{'Cache-Control':'no-store'}});
}
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>3000)throw new Error('Слишком большой запрос');const p=JSON.parse(raw);
  if(p.action==='save'){
   // Employee selection is a demo context; access remains restricted to the signed-in site owner.
   const employee=await db().prepare('SELECT data FROM employees WHERE id=?').bind(z.string().parse(p.actorId)).first<{data:string}>();
   if(!employee||JSON.parse(employee.data).role!=='admin')return Response.json({error:'Ключи настраивает администратор'},{status:403});
   const c=await config();if(p.token)c.token=key.parse(p.token);if(p.secret)c.secret=key.parse(p.secret);if(!c.token)throw new Error('Введите API-ключ');
   await suggestAddress(c.token,'Москва, Тверская 1');
   await db().prepare("INSERT INTO settings(id,data) VALUES('dadata',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(c)).run();
   return Response.json({configured:true,secretConfigured:!!c.secret});
  }
  if(p.action!=='suggest')throw new Error('Неизвестное действие');
  const query=z.string().trim().min(3,'Введите не меньше 3 символов').max(500).parse(p.query);const c=await config();
  if(!c.token)return Response.json({error:'Добавьте API-ключ в Настройки → Интеграции → ДаДата'},{status:409});
  return Response.json({suggestions:await suggestAddress(c.token,query)});
 }catch(e){return Response.json({error:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):e instanceof Error&&e.name==='TimeoutError'?'ДаДата не ответила вовремя. Попробуйте ещё раз.':e instanceof Error?e.message:'Ошибка ДаДата'},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

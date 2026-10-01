import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {authorizeCdek} from '@/lib/cdek';
import {z} from 'zod';
const input=z.object({actorId:z.string(),slot:z.number().int().min(1).max(4),name:z.string().trim().min(1).max(80),clientId:z.string().trim().max(200).default(''),clientSecret:z.string().trim().max(200).default('')});
async function handleGET(){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const rows=await db().prepare("SELECT id,data FROM settings WHERE id IN ('cdek-1','cdek-2','cdek-3','cdek-4')").all<{id:string;data:string}>();
 return Response.json({accounts:rows.results.map(r=>{const c=JSON.parse(r.data);return {slot:Number(r.id.split('-')[1]),name:c.name,configured:!!(c.clientId&&c.clientSecret),checkedAt:c.checkedAt};})},{headers:{'Cache-Control':'no-store'}});
}
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>3000)throw new Error('Слишком большой запрос');const p=input.parse(JSON.parse(raw));
  // Employee selection is the existing demo context, not separate employee authentication.
  const employee=await db().prepare('SELECT data FROM employees WHERE id=?').bind(p.actorId).first<{data:string}>();
  if(!employee||JSON.parse(employee.data).role!=='admin')return Response.json({error:'Аккаунты настраивает администратор'},{status:403});
  const id=`cdek-${p.slot}`;const row=await db().prepare('SELECT data FROM settings WHERE id=?').bind(id).first<{data:string}>();const old=row?JSON.parse(row.data):{};
  const c={name:p.name,clientId:p.clientId||old.clientId,clientSecret:p.clientSecret||old.clientSecret,checkedAt:new Date().toISOString()};
  if(!c.clientId||!c.clientSecret)throw new Error('Введите ключ и пароль');
  await authorizeCdek(c.clientId,c.clientSecret);
  await db().prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(id,JSON.stringify(c)).run();
  return Response.json({slot:p.slot,name:c.name,configured:true,checkedAt:c.checkedAt});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте заполнение полей':e instanceof Error&&e.name==='TimeoutError'?'СДЭК не ответил вовремя':e instanceof Error&&e.message.startsWith('СДЭК')?e.message:'Не удалось сохранить аккаунт. Проверьте ключ и пароль.'},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

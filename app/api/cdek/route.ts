import {readLimitedText} from '@/lib/request-body';
import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {routingSettings} from '@/lib/cdek-routing-store';
import {accountVersionSql,accountRowsWhere,departmentAAccount} from '@/lib/cdek-accounts';
import {authorizeCdek} from '@/lib/cdek';
import {z} from 'zod';
const input=z.object({actorId:z.string(),slot:z.number().int().positive().optional(),type:z.enum(['departmentA','schedule']).optional(),name:z.string().trim().min(1).max(80),clientId:z.string().trim().max(200).prefault(''),clientSecret:z.string().trim().max(200).prefault('')});
async function handleGET(){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const {accounts}=await routingSettings();
 return Response.json({accounts},{headers:{'Cache-Control':'no-store'}});
}
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await readLimitedText(req,12000);if(raw.length>3000)throw new Error('Слишком большой запрос');const p=input.parse(JSON.parse(raw));
  // Employee selection is the existing demo context, not separate employee authentication.
  const employee=await db().prepare('SELECT data FROM employees WHERE id=?').bind(p.actorId).first<{data:string}>();
  if(!employee||JSON.parse(employee.data).role!=='admin')return Response.json({error:'Аккаунты настраивает администратор'},{status:403});
  const {config,raw:routeRaw,accounts,accountVersion}=await routingSettings();
  const slot=p.slot??Math.max(0,...accounts.map(a=>a.slot))+1;
  const id='cdek-'+slot,stored=await db().prepare('SELECT data FROM settings WHERE id=?').bind(id).first<{data:string}>();
  const old=stored?JSON.parse(stored.data):{};
  const previous=accounts.find(a=>a.slot===slot);
  const type=p.type??previous?.type??(departmentAAccount({name:p.name})?'departmentA':'schedule');
  if(previous&&previous.type!==type&&(config.departmentAWeek?.includes(slot)||config.cycleSlots?.includes(slot)||config.rules.some(r=>r.enabled&&r.slot===slot)))return Response.json({error:'Сначала замените этот аккаунт в графике выгрузки'},{status:409});
  const c={name:p.name,type,clientId:p.clientId||old.clientId,clientSecret:p.clientSecret||old.clientSecret,checkedAt:new Date().toISOString()};
  if(!c.clientId||!c.clientSecret)throw new Error('Введите ключ и пароль');
  await authorizeCdek(c.clientId,c.clientSecret);
  const guard=`${accountVersionSql}=? AND COALESCE((SELECT data FROM settings WHERE id='cdek-routing'),'')=? AND NOT EXISTS(SELECT 1 FROM settings WHERE ${accountRowsWhere} AND id<>? AND json_extract(data,'$.clientId')=?)`;
  const args=[accountVersion,routeRaw,id,c.clientId];
  const result=stored?await db().prepare('UPDATE settings SET data=? WHERE id=? AND data=? AND '+guard).bind(JSON.stringify(c),id,stored.data,...args).run():await db().prepare('INSERT OR IGNORE INTO settings(id,data) SELECT ?,? WHERE '+guard).bind(id,JSON.stringify(c),...args).run();
  if(!result.meta.changes)return Response.json({error:'Аккаунт уже подключён или настройки изменились. Обновите список.'},{status:409});
  return Response.json({slot,name:c.name,type,configured:true,checkedAt:c.checkedAt});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте заполнение полей':e instanceof Error&&e.name==='TimeoutError'?'СДЭК не ответил вовремя':e instanceof Error&&e.message.startsWith('СДЭК')?e.message:'Не удалось сохранить аккаунт. Проверьте ключ и пароль.'},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {checkSkorozvon,type SkCredentials} from '@/lib/skorozvon';
import {z} from 'zod';
type Config=SkCredentials&{checkedAt:string;revision:string};
async function admin(req:Request){
 if(!await getChatGPTUser())return false;
 const id=new URL(req.url).searchParams.get('actorId');
 const row=await db().prepare('SELECT data FROM employees WHERE id=?').bind(id||'').first<{data:string}>();
 return !!row&&JSON.parse(row.data).role==='admin';
}
async function read(){const row=await db().prepare("SELECT data FROM settings WHERE id='skorozvon'").first<{data:string}>();return row?JSON.parse(row.data) as Config:null;}
function status(c:Config|null){return {configured:!!(c?.login&&c.apiKey&&c.clientId&&c.clientSecret),login:c?.login||'',checkedAt:c?.checkedAt||'',revision:c?.revision||'',syncEnabled:false};}
async function get(req:Request){if(!await admin(req))return Response.json({error:'Подключение настраивает администратор'},{status:403});return Response.json(status(await read()));}
const field=z.string().trim().max(500).default('');
const input=z.object({login:field,apiKey:field,clientId:field,clientSecret:field,revision:z.string().max(100)});
async function post(req:Request){
 if(!await admin(req))return Response.json({error:'Подключение настраивает администратор'},{status:403});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const p=input.parse(await req.json()),old=await read();
  if(p.revision!==(old?.revision||''))return Response.json({error:'Настройки изменились. Откройте окно заново'},{status:409});
  const credentials={login:p.login||old?.login||'',apiKey:p.apiKey||old?.apiKey||'',clientId:p.clientId||old?.clientId||'',clientSecret:p.clientSecret||old?.clientSecret||''};
  if(Object.values(credentials).some(v=>!v))return Response.json({error:'Заполните логин, API-ключ, ID и ключ приложения'},{status:400});
  const checked=await checkSkorozvon(credentials);const config={...credentials,...checked,revision:crypto.randomUUID()};
  const r=old?await db().prepare("UPDATE settings SET data=? WHERE id='skorozvon' AND json_extract(data,'$.revision')=?").bind(JSON.stringify(config),p.revision).run():await db().prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('skorozvon',?)").bind(JSON.stringify(config)).run();
  if(!r.meta.changes)return Response.json({error:'Настройки изменились. Откройте окно заново'},{status:409});
  return Response.json({...status(config),message:'Соединение со Скорозвоном проверено. Обмен данными пока выключен.'});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте заполнение полей':e instanceof Error?e.message:'Не удалось проверить подключение'},{status:400});}
}
export const GET=authenticated(get);
export const POST=authenticated(post);

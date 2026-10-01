import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {cdekMappingSchema} from '@/lib/cdek-statuses';
import {z} from 'zod';
const schema=z.object({actorId:z.string().min(1),mapping:cdekMappingSchema,revision:z.string()});
export async function GET(){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const row=await db().prepare("SELECT data FROM settings WHERE id='cdek-status-mapping'").first<{data:string}>();
 return Response.json(row?JSON.parse(row.data):{mapping:{},revision:''},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>12000)return Response.json({error:'Слишком большой запрос'},{status:413});
  const p=schema.parse(JSON.parse(raw));
  const actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(p.actorId).first<{data:string}>();
  if(!actor||JSON.parse(actor.data).role!=='admin')return Response.json({error:'Настройка доступна администратору'},{status:403});
  const data={mapping:p.mapping,revision:crypto.randomUUID()};
  const result=await db().prepare("INSERT INTO settings(id,data) SELECT 'cdek-status-mapping',? WHERE ?='' OR EXISTS(SELECT 1 FROM settings WHERE id='cdek-status-mapping') ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE json_extract(settings.data,'$.revision')=?").bind(JSON.stringify(data),p.revision,p.revision).run();
  if(!result.meta.changes)return Response.json({error:'Настройки изменены в другом окне. Обновите страницу перед сохранением.'},{status:409});
  return Response.json(data);
 }catch{return Response.json({error:'Не удалось сохранить соответствия статусов. Проверьте данные.'},{status:400});}
}

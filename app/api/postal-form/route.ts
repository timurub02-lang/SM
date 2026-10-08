import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {emptyPostalSender,postalFormData,postalSenderSchema} from '@/lib/postal-form';
import {z} from 'zod';

async function handleGET(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const q=new URL(req.url).searchParams;
 const actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(q.get('actorId')||'').first<{data:string}>();
 if(!actor||!['admin','logistic','chief_logistic'].includes(JSON.parse(actor.data).role))return Response.json({error:'Бланк доступен логисту и администратору'},{status:403});
 const row=await db().prepare("SELECT data FROM settings WHERE id='postal-form'").first<{data:string}>();
 const settings=row?JSON.parse(row.data):{sender:emptyPostalSender,revision:''};
 if(!q.has('orderId'))return Response.json(settings,{headers:{'Cache-Control':'no-store'}});
 const found=await db().prepare('SELECT data FROM orders WHERE id=?').bind(q.get('orderId')).first<{data:string}>();
 if(!found)return Response.json({error:'Заказ не найден'},{status:404});
 const order=JSON.parse(found.data);
 if(String(order.version)!==q.get('version'))return Response.json({error:'Заказ изменён. Откройте его заново перед скачиванием бланка.'},{status:409});
 const client=await db().prepare('SELECT data FROM clients WHERE id=?').bind(order.clientId).first<{data:string}>();
 if(!client)return Response.json({error:'Клиент не найден'},{status:404});
 try{return Response.json(postalFormData(order,JSON.parse(client.data),settings.sender),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось подготовить бланк'},{status:400});}
}
const schema=z.object({actorId:z.string().min(1),sender:postalSenderSchema,revision:z.string().max(100)});
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>4000)throw Error('Слишком большой запрос');
  const p=schema.parse(JSON.parse(raw));
  const actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(p.actorId).first<{data:string}>();
  if(!actor||JSON.parse(actor.data).role!=='admin')return Response.json({error:'Отправителя настраивает администратор'},{status:403});
  const data={sender:p.sender,revision:crypto.randomUUID()};
  const result=await db().prepare("INSERT INTO settings(id,data) SELECT 'postal-form',? WHERE ?='' OR EXISTS(SELECT 1 FROM settings WHERE id='postal-form') ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE json_extract(settings.data,'$.revision')=?").bind(JSON.stringify(data),p.revision,p.revision).run();
  if(!result.meta.changes)return Response.json({error:'Настройки изменены в другом окне. Закройте и откройте настройки снова.'},{status:409});
  return Response.json(data);
 }catch{return Response.json({error:'Заполните ФИО отправителя, адрес и индекс из 6 цифр. Проверьте телефон.'},{status:400});}
}
export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

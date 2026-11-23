import {z} from 'zod';
import {sessionEmployee,trustedOrigin} from '@/lib/auth';
import {db} from '@/lib/db';
import {BodyTooLarge,readLimitedText} from '@/lib/request-body';

export const dynamic='force-dynamic';
const field=z.enum(['intercom','note']);
const input=z.object({orderId:z.string().min(1).max(200),field,value:z.string().max(1000),previous:z.string().max(1000)});
const assigned="json_extract(o.data,'$.delivery')='moscow_courier' AND json_extract(o.data,'$.courier.id')=? AND NOT COALESCE(json_extract(o.data,'$.zvd'),0)";
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});

async function notes(req:Request){
 const employee=await sessionEmployee(req.headers);
 if(!employee)return reply({error:'Требуется вход'},401);
 if(employee.role!=='courier'||employee.impersonation)return reply({error:'Доступно только в личном кабинете курьера'},403);
 if(req.method==='POST'&&!trustedOrigin(req.headers))return reply({error:'Запрос отклонён'},403);
 const d=db();
 await d.prepare('CREATE TABLE IF NOT EXISTS courier_private_fields(courier_id TEXT NOT NULL,order_id TEXT NOT NULL,field TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(courier_id,order_id,field))').run();
 if(req.method==='GET'){
  const rows=await d.prepare(`SELECT n.order_id AS orderId,n.field,n.value FROM courier_private_fields n JOIN orders o ON o.id=n.order_id WHERE n.courier_id=? AND ${assigned} AND n.value<>''`).bind(employee.id,employee.id).all();
  return reply(rows.results);
 }
 try{
  const {orderId,field:key,value,previous}=input.parse(JSON.parse(await readLimitedText(req,12000)));
  if(key==='intercom'&&value.length>80)return reply({error:'Код домофона должен быть не длиннее 80 символов'},400);
  const result=await d.prepare(`INSERT INTO courier_private_fields(courier_id,order_id,field,value)
   SELECT ?,o.id,?,? FROM orders o WHERE o.id=? AND ${assigned}
   AND COALESCE((SELECT value FROM courier_private_fields WHERE courier_id=? AND order_id=o.id AND field=?),'')=?
   ON CONFLICT(courier_id,order_id,field) DO UPDATE SET value=excluded.value`)
   .bind(employee.id,key,value,orderId,employee.id,employee.id,key,previous).run();
  if(!result.meta.changes)return reply({error:'Заказ или запись изменились. Обновите страницу перед сохранением.'},409);
  return reply({saved:true});
 }catch(error){
  if(error instanceof BodyTooLarge||error instanceof SyntaxError||error instanceof z.ZodError)return reply({error:'Проверьте введённые данные'},error instanceof BodyTooLarge?413:400);
  throw error;
 }
}
export const GET=notes;
export const POST=notes;

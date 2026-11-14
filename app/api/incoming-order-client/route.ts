import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {incomingForAction,activeIncomingOrder} from '@/lib/incoming';
import {hideClientNumbers} from '@/lib/permissions';
import type {Client,Order} from '@/lib/crm';
export const dynamic='force-dynamic';
export const GET=authenticated(async(req:Request)=>{
 try{
  const e=(await getChatGPTUser())?.employee;if(!e||!['admin','operator','department_head'].includes(e.role))throw Error('Нет доступа');
  const id=new URL(req.url).searchParams.get('incomingId')||'';if(!id||id.length>100)throw Error('Выберите обращение');
  const row=await incomingForAction(db(),id,e,[]);if(!row.client_id)throw Error('Сначала найдите клиента');
  const found=await db().prepare('SELECT data,version FROM clients WHERE id=?').bind(row.client_id).first<{data:string;version:number}>();if(!found)throw Error('Клиент не найден');
  const c:Client={...JSON.parse(found.data),version:found.version};if(!c.owner)throw Error('Клиент не закреплён');
  const orders=(await db().prepare('SELECT data FROM orders WHERE client_id=?').bind(c.id).all()).results;
  if(orders.some(r=>activeIncomingOrder(JSON.parse(String(r.data)) as Order)))throw Error('У клиента уже есть действующий заказ');
  return Response.json({client:e.role==='admin'?c:hideClientNumbers(c)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Нет доступа'},{status:400});}
});

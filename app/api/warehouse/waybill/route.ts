import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {internalWaybill} from '@/lib/internal-waybill';
async function handleGET(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const q=new URL(req.url).searchParams;
 const actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(q.get('actorId')||'').first<{data:string}>();
 if(!actor||!['logistic','chief_logistic','admin'].includes(JSON.parse(actor.data).role))return Response.json({error:'Бланк доступен логисту'},{status:403});
 const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(q.get('orderId')||'').first<{data:string}>();
 if(!row)return Response.json({error:'Заказ не найден'},{status:404});
 const order=JSON.parse(row.data);
 const client=await db().prepare('SELECT data FROM clients WHERE id=?').bind(order.clientId).first<{data:string}>();
 if(!client)return Response.json({error:'Клиент не найден'},{status:404});
 const manager=await db().prepare('SELECT data FROM employees WHERE id=?').bind(order.manager).first<{data:string}>();
 const callbacks=await db().prepare("SELECT data FROM settings WHERE id='callback-phones'").first<{data:string}>();
 return Response.json(internalWaybill(order,JSON.parse(client.data),manager?JSON.parse(manager.data):undefined,callbacks?JSON.parse(callbacks.data):undefined),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

export const GET=authenticated(handleGET);

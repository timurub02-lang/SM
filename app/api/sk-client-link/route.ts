import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {seesOrder} from '@/lib/permissions';
import {orderSkClientLink} from '@/lib/sk-client-link';
import {closedOrderCallBlocked,operatorCallBlocked} from '@/lib/crm';
import type {Employee,Order} from '@/lib/crm';

export const GET=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const q=new URL(req.url).searchParams,orderId=q.get('orderId');
 if(!orderId)return Response.json({error:'Укажите заказ'},{status:400});
 const d=db(),staff=(await d.prepare('SELECT data FROM employees').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Employee);
 const actor=staff.find(e=>e.id===q.get('actorId'));
 const row=await d.prepare('SELECT data FROM orders WHERE id=?').bind(orderId).first<{data:string}>();
 if(!actor||['courier','purchasing'].includes(actor.role)||!row||!seesOrder(actor,JSON.parse(row.data),staff))return Response.json({error:'Заказ недоступен'},{status:403});
 const order=JSON.parse(row.data) as Order;
 const client=await d.prepare('SELECT data FROM clients WHERE id=?').bind(order.clientId).first<{data:string}>();
 if(!client||operatorCallBlocked(actor,order)||closedOrderCallBlocked(actor,order,JSON.parse(client.data)))return Response.json({error:'Звонок по этому заказу недоступен'},{status:403});
 try{return Response.json({url:await orderSkClientLink(d,order)},{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'Не удалось получить ссылку на клиента СК. Повторите проверку.'},{status:502});}
});

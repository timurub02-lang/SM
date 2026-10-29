import {createHmac} from 'node:crypto';
import {cancelledOrderCallBlocked,operatorCallBlocked,type Employee,type Order} from './crm';
import {db} from './db';
import {phoneScope,normalizeOutgoingNumber} from './phone-store';
export async function clientPhones(actor:Employee,p:{mode:string;clientId?:string;orderId?:string}){
 if(p.mode!=='client'&&p.mode!=='order')throw Error('Выберите клиента или заказ');
 if(!await phoneScope(db(),actor,p))throw Error('Нет доступа к этому клиенту или заказу');
 const clientId=p.mode==='client'?p.clientId:(await db().prepare('SELECT client_id FROM orders WHERE id=?').bind(p.orderId!).first<{client_id:string}>())?.client_id;
 if(!clientId)throw Error('Заказ не найден');
 if(actor.role==='operator'){
  const rows=(await db().prepare('SELECT data FROM orders WHERE client_id=?').bind(clientId).all()).results;
  if(rows.some(r=>operatorCallBlocked(actor,JSON.parse(String(r.data)) as Order)))throw Error('Заказ у логиста. Оператор может звонить только при недозвоне; при перезвоне дождитесь звонка логиста');
 }
 const row=await db().prepare('SELECT phone,data FROM clients WHERE id=?').bind(clientId).first<{phone:string;data:string}>();if(!row)throw Error('Клиент не найден');
 if(p.mode==='order'){
  const orderRow=await db().prepare('SELECT data FROM orders WHERE id=?').bind(p.orderId!).first<{data:string}>();
  if(!orderRow)throw Error('Заказ не найден');
  if(cancelledOrderCallBlocked(actor,JSON.parse(orderRow.data),JSON.parse(row.data)))throw Error('Клиент больше не закреплён за вами. Звонок из отменённого заказа недоступен');
 }
 const linked=JSON.parse(row.data).linkedPhones||[];
 const numbers=[...new Set([row.phone,...linked].map(normalizeOutgoingNumber).filter((number):number is string=>!!number))];
 return {clientId,phones:numbers.map((number,index)=>({number,key:createHmac('sha256',process.env.CRM_PHONE_RESULT_KEY||'').update(clientId+':'+number).digest('hex'),label:(normalizeOutgoingNumber(row.phone)===number?'Основной':'Дополнительный '+index)+' · '+(['operator','department_head'].includes(actor.role)?'••• '+number.slice(-4):'+'+number)}))};
}

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
  const c:Client={...JSON.parse(found.data),version:found.version};
  const orders=(await db().prepare('SELECT data FROM orders WHERE client_id=?').bind(c.id).all()).results;
  if(orders.some(r=>activeIncomingOrder(JSON.parse(String(r.data)) as Order)))throw Error('У клиента уже есть действующий заказ');
  const history=new URL(req.url).searchParams.get('view')==='history';
  const managerId=c.owner||row.assignee_id;
  const manager=managerId?await db().prepare("SELECT e.data FROM employees e JOIN auth_accounts a ON a.employee_id=e.id AND a.enabled=1 WHERE e.id=? AND json_extract(e.data,'$.role')='operator'").bind(managerId).first<{data:string}>():null;
  if(!manager&&!history)throw Error('Сначала передайте обращение оператору');
  const person=manager?JSON.parse(manager.data):null;
  const past=history?orders.map(r=>JSON.parse(String(r.data)) as Order).map(o=>({id:o.id,status:o.status,createdAt:o.createdAt,items:o.items})):undefined;
  const mask=(text:string)=>e.role==='admin'?text:String(text||'').replace(/(?<!\d)(?:\+?7|8)(?:[\s().-]*\d){10}(?!\d)/g,'[телефон]');
  const events=history?(await db().prepare('SELECT data FROM events WHERE client_id=? ORDER BY at DESC,id DESC LIMIT 100').bind(c.id).all()).results.map(r=>{const v=JSON.parse(String(r.data));return {id:v.id,at:v.at,text:mask(v.text),actor:v.actor};}):undefined;
  return Response.json({client:e.role==='admin'?c:hideClientNumbers(c),managerLogin:person?.login||'',canCreateOrder:!!manager,orders:past,events},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Нет доступа'},{status:400});}
});

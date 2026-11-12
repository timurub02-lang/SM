import type {ActivityDb} from './activity-store.ts';
import {initCrmReadIndexes} from './crm-read-indexes.ts';
import type {Employee,Client,Order,Event} from './crm.ts';
import {clientHistoryEntries} from './client-order-history.ts';
import {visibleState,canOpenClientCard} from './permissions.ts';

export type HistoryQuery={clientId?:string;orderId?:string;employeeId?:string;page:number;legacy?:boolean};
export async function readCrmHistory(d:ActivityDb,actor:Employee,q:HistoryQuery){
 await initCrmReadIndexes(d);
 if(['courier','purchasing'].includes(actor.role))throw Error('История недоступна');
 const staff:Employee[]=(await d.prepare('SELECT data FROM employees').all()).results.map((r:{data:string})=>JSON.parse(r.data));
 const operators=actor.role==='department_head'?staff.filter(e=>e.role==='operator'&&!!actor.department&&e.department===actor.department).map(e=>e.id):[actor.id];
 const owners=JSON.stringify(operators);
 // These are the same ownership/role scopes as visibleState; values remain bound parameters.
 const own=['operator','department_head'].includes(actor.role)?"json_extract(c.data,'$.owner') IN (SELECT value FROM json_each(?))":'0';
 const ownArgs=own==='0'?[]:[owners];
 const orderRole=['admin','logistic','chief_logistic'].includes(actor.role)?'1':actor.role==='redemption'?"json_extract(x.data,'$.status') IN ('shipping','pickup','redeemed','returned')":"json_extract(x.data,'$.manager') IN (SELECT value FROM json_each(?))";
 const roleArgs=orderRole.includes('?')?[owners]:[];
 const shared=actor.role==='department_head'?"EXISTS(SELECT 1 FROM incoming_calls i WHERE i.client_id=c.id AND i.closed_at IS NULL AND i.shared_queue=1)":'0';
 const clientScope=actor.role==='admin'?'1':`(${own} OR ${shared} OR EXISTS(SELECT 1 FROM orders x WHERE x.client_id=c.id AND ${orderRole}))`;
 const clientArgs=actor.role==='admin'?[]:[...ownArgs,...roleArgs];
 const eventScope=actor.role==='admin'?'1':`(${shared} OR ((e.order_id='' OR EXISTS(SELECT 1 FROM orders x WHERE x.id=e.order_id AND (${own} OR ${orderRole}))) AND ${clientScope}))`;
 const eventArgs=actor.role==='admin'?[]:[...ownArgs,...roleArgs,...clientArgs];
 if(q.legacy){
  const row=await d.prepare(`SELECT c.data,c.version FROM clients c WHERE c.id=? AND ${clientScope}`).bind(q.clientId,...clientArgs).first();
  if(!row)throw Error('Клиент недоступен');const client:Client={...JSON.parse(row.data),version:row.version};
  if(!canOpenClientCard(actor,client))throw Error('Клиент недоступен');
  const orders:Order[]=(await d.prepare('SELECT data,version FROM orders WHERE client_id=?').bind(client.id).all()).results.map((r:{data:string;version:number})=>({...JSON.parse(r.data),version:r.version}));
  const visible=visibleState({clients:[client],orders,employees:staff,events:[],settings:{retentionDays:0}},actor);
  const rows=clientHistoryEntries(client.legacyOrderHistory||[],visible.orders);
  return {rows:rows.slice(q.page*50,(q.page+1)*50),total:rows.length,page:q.page};
 }
 const clauses=[eventScope],args:unknown[]=[...eventArgs];
 if(q.clientId){clauses.push('e.client_id=?');args.push(q.clientId);}
 if(q.orderId){clauses.push('e.order_id=?');args.push(q.orderId);}
 if(q.employeeId){
  if(actor.role!=='admin'&&q.employeeId!==actor.id)throw Error('Журнал сотрудника недоступен');
  const e=staff.find(e=>e.id===q.employeeId);if(!e)throw Error('Сотрудник не найден');
  const suffix=' · от имени '+e.name;
  clauses.push("(json_extract(e.data,'$.actorId')=? OR (json_extract(e.data,'$.actorId') IS NULL AND (json_extract(e.data,'$.actor')=? OR substr(json_extract(e.data,'$.actor'),-length(?))=?)))");args.push(e.id,e.login,suffix,suffix);
 }
 const from=`FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE ${clauses.join(' AND ')}`;
 const count=await d.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...args).first();
 const rows=(await d.prepare(`SELECT e.data ${from} ORDER BY e.at DESC,e.id DESC LIMIT 50 OFFSET ?`).bind(...args,q.page*50).all()).results.map((r:{data:string})=>JSON.parse(r.data) as Event);
 return {rows,total:Number(count.n),page:q.page};
}

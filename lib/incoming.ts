import type {ActivityDb as Db} from './activity-store.ts';
import {normalizePhone,orderGroup,type Employee,type Order,type IncomingRequest} from './crm.ts';
import {seesOrder} from './permissions.ts';
import {initBaseStorage} from './base-storage.ts';
import {initPhone} from './phone-store.ts';

type Row={id:string;client_id:string|null;assignee_id:string|null;department_id:string;at:string;phone:string;called_number:string;closed_at:string|null;closed_by:string|null;reason:string;order_id:string|null};
export async function initIncoming(d:Db){
 await d.prepare(`CREATE TABLE IF NOT EXISTS incoming_calls(id TEXT PRIMARY KEY,client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,assignee_id TEXT,department_id TEXT NOT NULL DEFAULT '',at TEXT NOT NULL,phone TEXT NOT NULL,called_number TEXT NOT NULL,closed_at TEXT,closed_by TEXT,reason TEXT NOT NULL DEFAULT '',order_id TEXT REFERENCES orders(id) ON DELETE SET NULL)`).run();
 await d.prepare('CREATE INDEX IF NOT EXISTS incoming_assignee ON incoming_calls(assignee_id,closed_at,at)').run();
}
export function seesIncoming(row:Pick<Row,'client_id'|'assignee_id'|'department_id'>,e:Employee,staff:Employee[]){
 return e.role!=='courier'&&(e.role==='admin'||row.assignee_id===e.id||e.role==='department_head'&&(!row.client_id||!!e.department&&(row.department_id===e.department||staff.some(x=>x.id===row.assignee_id&&x.role==='operator'&&x.department===e.department))));
}
export const activeIncomingOrder=(o:Order)=>['new','accepted','sent'].includes(orderGroup(o.status).id);
export async function receiveIncoming(d:Db,p:{id:string;phone:string;calledNumber:string;at:string}){
 await initIncoming(d);await initPhone(d);await initBaseStorage(d);
 if(await d.prepare('SELECT id FROM incoming_calls WHERE id=?').bind(p.id).first())return;
 const phone=normalizePhone(p.phone),called=normalizePhone(p.calledNumber);
 const client=phone?await d.prepare('SELECT c.id,c.data FROM clients c JOIN client_phone_index i ON i.client_id=c.id WHERE i.phone=?').bind(phone.slice(1)).first():null;
 const c=client?JSON.parse(client.data):null;
 const staff:Employee[]=(await d.prepare('SELECT data FROM employees').all()).results.map((r:{data:string})=>JSON.parse(r.data) as Employee);
 const accounts=(await d.prepare('SELECT employee_id,enabled FROM auth_accounts').all()).results;
 const eligible=(id:string)=>staff.find(e=>e.id===id&&e.role!=='courier'&&accounts.some((a:{employee_id:string;enabled:number})=>a.employee_id===id&&a.enabled));
 // Only an attempt actually accepted by PBX counts; denied microphone access is not a call.
 const last=client?await d.prepare('SELECT actor_id FROM phone_calls WHERE client_id=? AND claimed_at<=? ORDER BY claimed_at DESC,seq DESC LIMIT 1').bind(client.id,p.at).first():null;
 const assignee=(last&&eligible(last.actor_id))||(c?.owner&&eligible(c.owner));
 const owner=staff.find(e=>e.id===c?.owner);
 await d.prepare('INSERT OR IGNORE INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number) VALUES(?,?,?,?,?,?,?)').bind(p.id,client?.id||null,assignee?.id||null,owner?.department||assignee?.department||'',p.at,phone,called).run();
}
export async function readIncoming(d:Db,e:Employee,staff:Employee[],orders:Order[]):Promise<IncomingRequest[]>{
 await initIncoming(d);if(e.role==='courier')return [];
 const scope=e.role==='admin'?'1=1':e.role==='department_head'?"(i.client_id IS NULL OR i.assignee_id=? OR (?<>'' AND (i.department_id=? OR i.assignee_id IN (SELECT id FROM employees WHERE json_extract(data,'$.role')='operator' AND json_extract(data,'$.department')=?))))":'i.assignee_id=?';
 const args=e.role==='admin'?[]:e.role==='department_head'?[e.id,e.department||'',e.department||'',e.department||'']:[e.id];
 const select=`SELECT i.*,json_extract(c.data,'$.name') AS client_name FROM incoming_calls i LEFT JOIN clients c ON c.id=i.client_id WHERE ${scope}`;
 const open=(await d.prepare(select+' AND i.closed_at IS NULL ORDER BY i.at DESC').bind(...args).all()).results;
 const closed=(await d.prepare(select+' AND i.closed_at IS NOT NULL ORDER BY i.closed_at DESC LIMIT 50').bind(...args).all()).results;
 return [...open,...closed].map((r:Row&{client_name:string|null})=>{
  const active=orders.filter(o=>o.clientId===r.client_id&&activeIncomingOrder(o));
  return {id:r.id,clientId:r.client_id||'',clientName:r.client_name||'Неизвестный клиент',at:r.at,text:'Клиент перезвонил',source:'Билайн АТС',assigneeId:r.assignee_id||'',assigneeName:staff.find(x=>x.id===r.assignee_id)?.name||(r.client_id?'Не распределено — требуется администратор':'Общая очередь руководителей и администратора'),department:r.department_id,phone:e.role==='operator'||e.role==='department_head'&&!!r.client_id?'':r.phone,calledNumber:r.called_number,hasActiveOrder:active.length>0,orderIds:active.filter(o=>seesOrder(e,o,staff)).map(o=>o.id),closedAt:r.closed_at||'',closedBy:staff.find(x=>x.id===r.closed_by)?.name||'',reason:r.reason,orderId:r.order_id||''};
 });
}
export async function incomingForAction(d:Db,id:string,e:Employee,staff:Employee[],clientId?:string){
 await initIncoming(d);const row=await d.prepare('SELECT * FROM incoming_calls WHERE id=?').bind(id).first() as Row|null;
 if(!row||!seesIncoming(row,e,staff))throw Error('Обращение недоступно');
 if(row.closed_at)throw Error('Обращение уже закрыто. Обновите данные');
 if(clientId!==undefined&&row.client_id!==clientId)throw Error('Обращение относится к другому клиенту');
 return row;
}
export function incomingCloseStatement(d:Db,id:string,employeeId:string,at:string,reason:string,orderId:string|null,mutation?:string){
 return d.prepare("UPDATE incoming_calls SET closed_at=?,closed_by=?,reason=?,order_id=? WHERE id=? AND closed_at IS NULL"+(!orderId?" AND NOT EXISTS(SELECT 1 FROM orders WHERE client_id=incoming_calls.client_id AND json_extract(data,'$.status') NOT IN ('redeemed','refused','returned'))":"")+(mutation?" AND EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)":"")).bind(at,employeeId,reason,orderId,id,...(mutation?[orderId,mutation]:[]));
}

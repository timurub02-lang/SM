import {initProtection,incomingGate} from './incoming-protection.ts';
import type {ActivityDb as Db} from './activity-store.ts';
import {normalizePhone,orderGroup,hideClientPhone,type Employee,type Order,type IncomingRequest} from './crm.ts';
import {seesOrder} from './permissions.ts';
import {initBaseStorage} from './base-storage.ts';
import {initPhone} from './phone-store.ts';

type Row={handoff?:string;spam?:number;spam_reason?:string;call_count?:number;last_at?:string;blocked?:number;shared_queue?:number;id:string;client_id:string|null;assignee_id:string|null;department_id:string;at:string;phone:string;called_number:string;closed_at:string|null;closed_by:string|null;reason:string;order_id:string|null};
const incomingSchemas=new WeakMap<Db,Promise<void>>();
export async function initIncoming(d:Db){let schema=incomingSchemas.get(d);if(!schema){schema=initializeIncoming(d);incomingSchemas.set(d,schema);schema.catch(()=>incomingSchemas.delete(d));}await schema;}
async function initializeIncoming(d:Db){
 await d.prepare(`CREATE TABLE IF NOT EXISTS incoming_calls(id TEXT PRIMARY KEY,client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,assignee_id TEXT,department_id TEXT NOT NULL DEFAULT '',at TEXT NOT NULL,phone TEXT NOT NULL,called_number TEXT NOT NULL,closed_at TEXT,closed_by TEXT,reason TEXT NOT NULL DEFAULT '',order_id TEXT REFERENCES orders(id) ON DELETE SET NULL)`).run();
 const columns=await d.prepare('PRAGMA table_info(incoming_calls)').all();
 if(!columns.results.some((c:{name:string})=>c.name==='shared_queue')){
  try{await d.prepare('ALTER TABLE incoming_calls ADD COLUMN shared_queue INTEGER NOT NULL DEFAULT 0').run();}catch(error){
   const current=await d.prepare('PRAGMA table_info(incoming_calls)').all();
   if(!current.results.some((c:{name:string})=>c.name==='shared_queue'))throw error;
  }
  await d.prepare("UPDATE incoming_calls SET shared_queue=1,assignee_id=NULL,department_id='' WHERE closed_at IS NULL AND client_id IN (SELECT id FROM clients WHERE COALESCE(json_extract(data,'$.owner'),'')='') AND NOT EXISTS(SELECT 1 FROM orders WHERE orders.client_id=incoming_calls.client_id AND json_extract(data,'$.status') NOT IN ('redeemed','refused','returned'))").run();
 }
 for(const [name,definition] of [['handoff',"TEXT NOT NULL DEFAULT ''"],['spam','INTEGER NOT NULL DEFAULT 0'],['spam_reason',"TEXT NOT NULL DEFAULT ''"],['call_count','INTEGER NOT NULL DEFAULT 1'],['last_at',"TEXT NOT NULL DEFAULT ''"]]){
  if(!columns.results.some((c:{name:string})=>c.name===name))try{await d.prepare('ALTER TABLE incoming_calls ADD COLUMN '+name+' '+definition).run();}catch(error){if(!(await d.prepare('PRAGMA table_info(incoming_calls)').all()).results.some((c:{name:string})=>c.name===name))throw error;}
 }
 await d.prepare('CREATE INDEX IF NOT EXISTS incoming_open_phone ON incoming_calls(phone,closed_at)').run();
 await initProtection(d);
 await d.prepare('CREATE INDEX IF NOT EXISTS incoming_assignee ON incoming_calls(assignee_id,closed_at,at)').run();
}
export function seesIncoming(row:Pick<Row,'client_id'|'assignee_id'|'department_id'|'shared_queue'|'spam'>,e:Employee,staff:Employee[]){
 return (!row.spam||e.role==='admin')&&e.role!=='courier'&&(e.role==='admin'||row.assignee_id===e.id||e.role==='department_head'&&(!row.client_id||row.shared_queue===1||!!e.department&&(row.department_id===e.department||staff.some(x=>x.id===row.assignee_id&&x.role==='operator'&&x.department===e.department))));
}
export const activeIncomingOrder=(o:Order)=>['new','accepted','sent'].includes(orderGroup(o.status).id);
export async function receiveIncoming(d:Db,p:{id:string;phone:string;calledNumber:string;at:string;screening?:'passed'|'failed'|'blocked'}){
 await initIncoming(d);await initPhone(d);await initBaseStorage(d);
 if(await d.prepare('SELECT id FROM incoming_calls WHERE id=?').bind(p.id).first())return;
 const decision=await incomingGate(d,p);
 const phone=normalizePhone(p.phone),called=normalizePhone(p.calledNumber);
 const client=phone?await d.prepare('SELECT c.id,c.data FROM clients c JOIN client_phone_index i ON i.client_id=c.id WHERE i.phone=?').bind(phone.slice(1)).first():null;
 const c=client?JSON.parse(client.data):null;
 const {assignee,department,shared}=await incomingRouting(d,client?.id||'',c,p.at);
 const blocked=await d.prepare("SELECT phone FROM incoming_phone_policy WHERE phone=? AND policy='block'").bind(phone).first();
 const spam=!!blocked||p.screening==='blocked'||p.screening==='failed'||decision==='block'||decision==='challenge'&&p.screening!=='passed';
 // Failed verification stays in the attempt journal and must not create or hide a request.
 if(spam){
  await d.prepare('UPDATE incoming_attempts SET applied=1 WHERE id=?').bind(p.id).run();
  return;
 }
 const reason='';
 // One transaction assigns a new call to an open request and counts its ID only once.
 await d.batch([
  d.prepare("INSERT OR IGNORE INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number,shared_queue,call_count,spam,spam_reason) SELECT ?,?,?,?,?,?,?,?,0,?,? WHERE EXISTS(SELECT 1 FROM incoming_attempts WHERE id=? AND applied=0) AND NOT EXISTS(SELECT 1 FROM incoming_calls WHERE phone=? AND closed_at IS NULL)").bind(p.id,client?.id||null,assignee?.id||null,department,p.at,phone,called,shared?1:0,spam?1:0,reason,p.id,phone),
  d.prepare("UPDATE incoming_attempts SET request_id=(SELECT id FROM incoming_calls WHERE phone=? AND closed_at IS NULL ORDER BY at,id LIMIT 1) WHERE id=? AND applied=0").bind(phone,p.id),
  d.prepare("UPDATE incoming_calls SET call_count=call_count+1,last_at=MAX(at,last_at,?),spam=MAX(spam,?),spam_reason=CASE WHEN ?=1 THEN ? ELSE spam_reason END WHERE id=(SELECT request_id FROM incoming_attempts WHERE id=? AND applied=0)").bind(p.at,spam?1:0,spam?1:0,reason,p.id),
  d.prepare('UPDATE incoming_attempts SET applied=1 WHERE id=?').bind(p.id)
 ]);

}
export async function readIncoming(d:Db,e:Employee,staff:Employee[],orders:Order[],scoped=false):Promise<IncomingRequest[]>{
 await initIncoming(d);if(e.role==='courier')return [];
 const scope=e.role==='admin'?'1=1':e.role==='department_head'?"(i.client_id IS NULL OR i.shared_queue=1 OR i.assignee_id=? OR (?<>'' AND (i.department_id=? OR i.assignee_id IN (SELECT id FROM employees WHERE json_extract(data,'$.role')='operator' AND json_extract(data,'$.department')=?))))":'i.assignee_id=?';
 const args=e.role==='admin'?[]:e.role==='department_head'?[e.id,e.department||'',e.department||'',e.department||'']:[e.id];
 const select=`SELECT i.*,EXISTS(SELECT 1 FROM incoming_phone_policy p WHERE p.phone=i.phone AND p.policy='block') AS blocked,json_extract(c.data,'$.name') AS client_name FROM incoming_calls i LEFT JOIN clients c ON c.id=i.client_id WHERE ${scope}`;
 const open=(await d.prepare(select+' AND i.closed_at IS NULL AND i.spam=0 ORDER BY i.at DESC').bind(...args).all()).results;
 const closed=(await d.prepare(select+' AND i.closed_at IS NOT NULL AND i.spam=0 ORDER BY i.closed_at DESC LIMIT 50').bind(...args).all()).results;
 const spam=e.role==='admin'?(await d.prepare(select+' AND i.spam=1 ORDER BY i.last_at DESC,i.at DESC LIMIT 100').bind(...args).all()).results:[];
 const rows=[...open,...closed,...spam] as (Row&{client_name:string|null})[];if(!rows.length)return [];
 const ids=new Set(rows.map(r=>r.client_id));
 if(scoped)orders=(await d.prepare("SELECT json_object('id',id,'clientId',client_id,'manager',json_extract(data,'$.manager'),'status',json_extract(data,'$.status')) AS data FROM orders WHERE client_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC").bind(JSON.stringify([...ids].filter(Boolean))).all()).results.map((r:{data:string})=>JSON.parse(r.data));
 const activeByClient=new Map<string|null,Order[]>(),staffById=new Map<string|null,Employee>();
 for(const person of staff)if(!staffById.has(person.id))staffById.set(person.id,person);
 for(const order of orders)if(ids.has(order.clientId)&&activeIncomingOrder(order)){const active=activeByClient.get(order.clientId)||[];active.push(order);activeByClient.set(order.clientId,active);}
 return rows.map(r=>{
  const active=activeByClient.get(r.client_id)||[];
  return {handoff:r.handoff?JSON.parse(r.handoff):undefined,spam:!!r.spam,spamReason:r.spam_reason||'',callCount:r.call_count||1,lastAt:r.last_at||r.at,blocked:!!r.blocked,sharedQueue:r.shared_queue===1,id:r.id,clientId:r.client_id||'',clientName:r.client_name||'Неизвестный клиент',at:r.at,text:'Клиент перезвонил',source:r.id.startsWith('LV-IN-')?'ЛВ':'Билайн АТС',assigneeId:r.assignee_id||'',assigneeName:staffById.get(r.assignee_id)?.name||(r.shared_queue||!r.client_id?'Общая очередь руководителей и администратора':'Не распределено — требуется администратор'),department:r.department_id,phone:hideClientPhone(e.role)?'':r.phone,calledNumber:hideClientPhone(e.role)?'':r.called_number,hasActiveOrder:active.length>0,orderIds:active.filter(o=>seesOrder(e,o,staff)).map(o=>o.id),closedAt:r.closed_at||'',closedBy:staffById.get(r.closed_by)?.name||'',reason:r.reason,orderId:r.order_id||''};
 });
}
export async function incomingForAction(d:Db,id:string,e:Employee,staff:Employee[],clientId?:string){
 await initIncoming(d);const row=await d.prepare('SELECT * FROM incoming_calls WHERE id=?').bind(id).first() as Row|null;
 if(!row||!seesIncoming(row,e,staff))throw Error('Обращение недоступно');
 if(row.spam)throw Error('Сначала верните обращение из спама в работу');
 if(row.closed_at)throw Error('Обращение уже закрыто. Обновите данные');
 if(clientId!==undefined&&row.client_id!==clientId)throw Error('Обращение относится к другому клиенту');
 return row;
}
export function incomingCloseStatement(d:Db,id:string,employeeId:string,at:string,reason:string,orderId:string|null,mutation?:string,handoff?:string){
 return d.prepare("UPDATE incoming_calls SET closed_at=?,closed_by=?,reason=?,order_id=? WHERE id=? AND closed_at IS NULL"+(!orderId&&!handoff?" AND NOT EXISTS(SELECT 1 FROM orders WHERE client_id=incoming_calls.client_id AND json_extract(data,'$.status') NOT IN ('redeemed','refused','returned'))":"")+(handoff?" AND assignee_id=? AND handoff=?":"")+(mutation?" AND EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)":"")).bind(at,employeeId,reason,orderId,id,...(handoff?[employeeId,handoff]:[]),...(mutation?[orderId,mutation]:[]));
}

export async function sharedIncomingClientAccess(d:Db,e:Employee,clientId:string){
 if(e.role!=='department_head')return false;
 await initIncoming(d);
 return !!await d.prepare('SELECT id FROM incoming_calls WHERE client_id=? AND shared_queue=1 AND spam=0 AND closed_at IS NULL LIMIT 1').bind(clientId).first();
}

export async function incomingRouting(d:Db,clientId:string,c:{owner?:string}|null,at:string){
 const staff:Employee[]=(await d.prepare('SELECT data FROM employees').all()).results.map((r:{data:string})=>JSON.parse(r.data) as Employee);
 const accounts=(await d.prepare('SELECT employee_id,enabled FROM auth_accounts').all()).results;
 const eligible=(id:string)=>staff.find(e=>e.id===id&&e.role!=='courier'&&accounts.some((a:{employee_id:string;enabled:number})=>a.employee_id===id&&a.enabled));
 // Only an attempt actually accepted by PBX counts; denied microphone access is not a call.
 // A one-off delegated callback does not transfer routing for future incoming calls.
 const last=clientId?await d.prepare("SELECT actor_id FROM phone_calls WHERE client_id=? AND claimed_at<=? AND NOT EXISTS(SELECT 1 FROM phone_call_incoming p JOIN incoming_calls i ON i.id=p.incoming_id WHERE p.call_id=phone_calls.id AND i.handoff<>'') ORDER BY claimed_at DESC,seq DESC LIMIT 1").bind(clientId,at).first():null;
 const clientOrders=clientId&&!c?.owner?(await d.prepare('SELECT data FROM orders WHERE client_id=?').bind(clientId).all()).results:[];
 const shared=!!clientId&&!c?.owner&&!clientOrders.some((r:{data:string})=>activeIncomingOrder(JSON.parse(r.data)));
 const assignee=shared?undefined:(last&&eligible(last.actor_id))||(c?.owner&&eligible(c.owner));
 const owner=staff.find(e=>e.id===c?.owner);
 return {assignee,department:owner?.department||assignee?.department||'',shared};
}

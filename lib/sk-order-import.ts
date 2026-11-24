import {managesWorkDepartment} from './head-vacation.ts';
import {reconcileIncomingOwners} from './incoming-owner-sync.ts';
import type {SkProjectMembership} from './sk-project-membership.ts';
import {skOrderReview} from './sk-order-review.ts';
import {nextOrderId} from './order-number.ts';
import {normalizePhone,clientSheet,hasActiveOrder,type Client,type Order,type Employee} from './crm.ts';
import type {ActivityDb as Db} from './activity-store.ts';
import {initBaseStorage} from './base-storage.ts';
import {defaultOrderPolicy,orderPolicySchema} from './order-policy.ts';
export type SkOrderInput={callId:string;leadId:string;projectId?:string|null;projectMembership?:SkProjectMembership;projectCheckedAt?:string;dispatchVerified?:boolean;email:string;userName?:string;userNameUnique?:boolean;name:string;phone:string;address:string;city:string;comment:string};
export async function initSkOrders(d:Db){
 await initBaseStorage(d);
 await d.prepare("CREATE TABLE IF NOT EXISTS sk_order_cooldowns(phone TEXT NOT NULL,operator_id TEXT NOT NULL,call_id TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(phone,operator_id))").run();
 await d.prepare(`CREATE TABLE IF NOT EXISTS sk_order_transfers(id TEXT PRIMARY KEY,data TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,order_id TEXT NOT NULL DEFAULT '',decided_by TEXT NOT NULL DEFAULT '')`).run();
}
export async function skStaff(d:Db):Promise<Employee[]>{
 const personal=await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_accounts'").first();
 const rows=(await d.prepare(personal?'SELECT e.data,e.version,COALESCE(a.enabled,0) enabled FROM employees e LEFT JOIN auth_accounts a ON a.employee_id=e.id':'SELECT data,version FROM employees').all()).results;
 return rows.map((r:any)=>({...JSON.parse(r.data),version:r.version,...(personal?{accessEnabled:r.enabled===1}:{})}));
}
export async function skClient(d:Db,phone:string):Promise<Client|undefined>{
 const r=await d.prepare('SELECT c.data,c.version FROM clients c JOIN client_phone_index p ON p.client_id=c.id WHERE p.phone=?').bind(normalizePhone(phone).replace(/\D/g,'')).first();
 return r?{...JSON.parse(r.data),version:r.version}:undefined;
}
export function skSender(staff:Employee[],email:string,userName='',userNameUnique=false){
 const clean=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
 const found=staff.filter(e=>{const key=clean(e.skLogin||'');return key&&userNameUnique&&!!userName&&key===clean(userName);});
 return found.length===1&&found[0].role==='operator'&&found[0].accessEnabled!==false?found[0]:undefined;
}
export function skMayDecide(actor:Employee,_sender?:Employee,_owner?:Employee){return actor.role==='admin';}
export async function acceptSkOrder(d:Db,input:SkOrderInput,decision?:Employee,now=new Date().toISOString()){
 if(!/^\d+$/.test(input.callId)||!normalizePhone(input.phone))throw Error('Некорректный звонок или телефон СК');
 now=new Date(now).toISOString();
 await initSkOrders(d);
 await d.prepare('INSERT OR IGNORE INTO sk_order_transfers(id,data,created_at) VALUES(?,?,?)').bind(input.callId,JSON.stringify(input),now).run();
 const transfer=await d.prepare('SELECT * FROM sk_order_transfers WHERE id=?').bind(input.callId).first();
 if(transfer.state!=='pending')return {state:transfer.state,orderId:transfer.order_id};
 // A retry always processes the original snapshot, never replaces it with later contact edits.
 input=JSON.parse(transfer.data);
 const staff=await skStaff(d),sender=skSender(staff,input.email,input.userName,input.userNameUnique),existing=await skClient(d,input.phone),owner=staff.find(e=>e.id===existing?.owner);
 if(decision&&!skMayDecide(decision,sender,owner))throw Error('Решение доступно только администратору');
 // Claim atomically across event/report workers; retries of the same call keep their claim.
 if(sender&&!decision){
  const phone=normalizePhone(existing?.phone||input.phone),cutoff=new Date(Date.parse(transfer.created_at)-600000).toISOString();
  await d.prepare("INSERT INTO sk_order_cooldowns(phone,operator_id,call_id,at) VALUES(?,?,?,?) ON CONFLICT(phone,operator_id) DO UPDATE SET call_id=excluded.call_id,at=excluded.at WHERE sk_order_cooldowns.at<=?").bind(phone,sender.id,input.callId,transfer.created_at,cutoff).run();
  const claim=await d.prepare('SELECT call_id FROM sk_order_cooldowns WHERE phone=? AND operator_id=?').bind(phone,sender.id).first();
  if(claim.call_id!==input.callId){
   await d.prepare("UPDATE sk_order_transfers SET state='duplicate',reason='' WHERE id=? AND state='pending'").bind(input.callId).run();
   return {state:'duplicate'};
  }
 }
 const orders:Order[]=existing?(await d.prepare('SELECT data FROM orders WHERE client_id=?').bind(existing.id).all()).results.map((r:any)=>JSON.parse(r.data)):[];
 const reason=skOrderReview(input.projectId,sender,existing,owner,orders,!!input.projectMembership,input.dispatchVerified).reasons.join('; ');
 if(reason&&(!decision||!sender||existing&&['ЧС','ПВ'].includes(clientSheet(existing))&&decision.role!=='admin')){
  await d.prepare("UPDATE sk_order_transfers SET reason=? WHERE id=? AND state='pending'").bind(reason,input.callId).run();return {state:'pending',reason};
 }
 if(!sender)throw Error('Укажите ФИО Скорозвона в карточке оператора');
 const id=await nextOrderId(d,'sk:'+input.callId,'SK'),clientId=existing?.id||'C-SK-'+input.callId;
 const base:Client=existing||{id:clientId,name:input.name.trim().slice(0,150)||'Клиент из Скорозвона',phone:normalizePhone(input.phone),city:input.city.slice(0,250),address:input.address.slice(0,500),source:'Скорозвон',baseType:sender.baseAccess==='J'?'J':'M',sheet:'Т1',owner:'',assignedUntil:'',createdAt:now,version:1};
 const client={...base,owner:sender.id,sheet:'К',returnSheet:base.returnSheet||(clientSheet(base)==='К'?'П':clientSheet(base))||'Т1',assignedUntil:'',assignmentStartedAt:base.owner===sender.id?base.assignmentStartedAt||now:now,trialUntil:undefined,trialReturnSheet:undefined,importRetentionUntil:undefined,address:base.address||input.address.slice(0,500)};
 const policyRow=await d.prepare("SELECT data FROM settings WHERE id='order-policy'").first();const policy=policyRow?orderPolicySchema.parse(JSON.parse(policyRow.data).policy):defaultOrderPolicy;
 const comment=[input.comment.trim(),base.address&&input.address.trim()?`Адрес из Скорозвона для сверки: ${input.address.trim()}`:''].filter(Boolean).join('\n').slice(0,3000);
 const order:Order={id,clientId,skLeadId:input.leadId,skWithoutProject:input.dispatchVerified===false||(input.dispatchVerified===undefined&&input.projectId===null&&!input.projectMembership),delivery:'',address:client.address,addressParts:base.addressParts,status:'draft',draftHours:policy.draftHours,items:[],comment,reason:'',contact:'none',due:'',round:1,extra:false,createdAt:now,updatedAt:now,manager:sender.id,logistic:'',version:1};
 const event={id:'SK-ORDER-'+input.callId,clientId,orderId:id,at:now,actor:sender.name,actorId:sender.id,text:'Создан заказ из Скорозвона · СМ СРМ'+(decision?' · разрешил '+decision.name:'')};
 const senderGuard="EXISTS(SELECT 1 FROM employees WHERE id=? AND version=?)"+(sender.accessEnabled!==undefined?" AND EXISTS(SELECT 1 FROM auth_accounts WHERE employee_id=? AND enabled=1)":"");
 const senderArgs=sender.accessEnabled!==undefined?[sender.id,sender.version,sender.id]:[sender.id,sender.version];
 const statements=[...(!existing?[d.prepare('INSERT INTO clients(id,phone,data) SELECT ?,?,? WHERE '+senderGuard).bind(clientId,base.phone,JSON.stringify(base),...senderArgs)]:[]),
 d.prepare("INSERT INTO orders(id,client_id,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM sk_order_transfers WHERE id=? AND state='pending') AND "+senderGuard).bind(id,clientId,JSON.stringify(order),clientId,base.version,input.callId,...senderArgs),
 d.prepare('UPDATE clients SET data=?,version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)').bind(JSON.stringify(client),clientId,id),
 d.prepare('INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)').bind(event.id,clientId,id,now,JSON.stringify(event),id),
 d.prepare("UPDATE sk_order_transfers SET state='imported',order_id=?,decided_by=? WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(id,decision?.id||'',input.callId,id)];
 const result=await d.batch(statements);if(!result[existing?0:1].meta.changes)throw Error('Клиент или сотрудник изменился. Повторите обработку');
 await reconcileIncomingOwners(d,clientId,now);
 return {state:'imported',orderId:id};
}

export async function operatorPendingSkOrders(d:Db,staff:Employee[],actorId:string){
 const rows=await d.prepare("SELECT id,data,created_at FROM sk_order_transfers WHERE state='pending' ORDER BY created_at DESC").all();
 return rows.results.flatMap((row:{id:string;data:string;created_at:string})=>{
  const input:SkOrderInput=JSON.parse(String(row.data));
  const actor=staff.find(e=>e.id===actorId),sender=skSender(staff,input.email,input.userName,input.userNameUnique);
  if(!actor||!sender||(actor.role==='department_head'?sender.role!=='operator'||!managesWorkDepartment(actor,sender.department,staff):sender.id!==actorId))return [];
  return [{id:String(row.id),name:input.name||'Клиент из Скорозвона',at:String(row.created_at),reason:'Ожидает разрешения администратора',canDecide:false,sender:''}];
 });
}

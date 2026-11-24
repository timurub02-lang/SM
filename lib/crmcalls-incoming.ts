import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import {readLimitedText,BodyTooLarge} from './request-body.ts';
import {initBaseStorage} from './base-storage.ts';
import {skStaff,initSkOrders,skMayDecide,type SkOrderInput} from './sk-order-import.ts';
import {normalizePhone,clientSheet,type Client,type Order,type Employee} from './crm.ts';
import {nextOrderId} from './order-number.ts';
import {defaultOrderPolicy,orderPolicySchema} from './order-policy.ts';
import {skOrderReview} from './sk-order-review.ts';
import {reconcileIncomingOwners} from './incoming-owner-sync.ts';

const id=z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const text=(max:number)=>z.string().max(max).nullish().transform(v=>v||'');
export const incomingConfigSchema=z.object({enabled:z.boolean(),scenarioId:z.uuid(),resultId:id,additionalScenarios:z.array(z.object({scenarioId:z.uuid(),resultId:id})).max(20).default([]),operators:z.array(z.object({userId:id,employeeId:id})).max(500)}).refine(v=>new Set(v.operators.map(x=>x.userId)).size===v.operators.length,'Оператор CRMCalls указан дважды').refine(v=>new Set([v.scenarioId,...v.additionalScenarios.map(s=>s.scenarioId)]).size===1+v.additionalScenarios.length,'Сценарий указан дважды');
export const incomingEventSchema=z.object({event:z.literal('call.result_saved'),event_id:z.uuid(),occurred_at:z.iso.datetime({offset:true}),
 call:z.object({id,status:text(50),comment:text(3000)}),scenario:z.object({id:z.uuid()}),result:z.object({id,name:text(100)}),
 user:z.object({id,name:text(200)}),contact:z.object({id:z.uuid(),full_name:text(150),phone:z.string().max(40),phones:z.array(z.string().max(40)).max(20).nullish(),city:text(250),address:text(500)})});
export const incomingScenarios=(c:{scenarioId:string;resultId:string;additionalScenarios?:{scenarioId:string;resultId:string}[]})=>[{scenarioId:c.scenarioId,resultId:c.resultId},...(c.additionalScenarios||[])];
type Config=z.infer<typeof incomingConfigSchema>&{revision:string;enabledAt:string;secretHash:string};
type Payload=z.infer<typeof incomingEventSchema>;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function initCRMCallsIncoming(d:Db){
 await initBaseStorage(d);
 await d.prepare("CREATE TABLE IF NOT EXISTS crmcalls_incoming(call_id TEXT PRIMARY KEY,event_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL DEFAULT '',received_at TEXT NOT NULL,order_id TEXT NOT NULL DEFAULT '',attempted_at TEXT NOT NULL DEFAULT '')").run();
 await d.prepare('CREATE INDEX IF NOT EXISTS crmcalls_incoming_pending ON crmcalls_incoming(state,attempted_at,received_at)').run();
}
export async function readIncomingConfig(d:Db):Promise<Config|null>{const row=await d.prepare("SELECT data FROM settings WHERE id='crmcalls-incoming-config'").first();return row?JSON.parse(row.data):null;}
export async function saveIncomingConfig(d:Db,input:unknown,revision:string){
 const parsed=incomingConfigSchema.parse(input),old=await readIncomingConfig(d);
 if((old?.revision||'')!==revision)throw Error('Настройки изменились. Обновите раздел.');
 const staff=await skStaff(d);
 for(const link of parsed.operators)if(!staff.some(e=>e.id===link.employeeId&&e.role==='operator'&&e.accessEnabled!==false))throw Error('Выберите действующего оператора CRM для каждого соответствия');
 if(parsed.enabled&&!parsed.operators.length)throw Error('Сначала сопоставьте операторов');
 const secret=old?.secretHash?undefined:randomBytes(32).toString('hex');
 const next:Config={...parsed,revision:crypto.randomUUID(),enabledAt:old?.enabledAt||new Date().toISOString(),secretHash:old?.secretHash||digest(secret!)};
 const r=await d.prepare("INSERT INTO settings(id,data) VALUES('crmcalls-incoming-config',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE json_extract(settings.data,'$.revision')=?").bind(JSON.stringify(next),revision).run();
 if(!r.meta.changes)throw Error('Настройки изменились. Обновите раздел.');
 return {secret,revision:next.revision};
}
export async function incomingDashboard(d:Db){
 await initCRMCallsIncoming(d);const config=await readIncomingConfig(d),staff=await skStaff(d);
 return {config:config?{enabled:config.enabled,scenarioId:config.scenarioId,resultId:config.resultId,additionalScenarios:config.additionalScenarios||[],operators:config.operators,revision:config.revision}:null,
 staff:staff.filter(e=>e.role==='operator'&&e.accessEnabled!==false).map(e=>({id:e.id,name:e.name,login:e.login})),
 transfers:(await d.prepare("SELECT call_id,event_id,state,reason,received_at,order_id,json_extract(data,'$.user.id') user_id,json_extract(data,'$.user.name') user_name,json_extract(data,'$.contact.full_name') name FROM crmcalls_incoming ORDER BY received_at DESC LIMIT 100").all()).results};
}
export async function receiveCRMCallsIncoming(d:Db,req:Request,now=new Date().toISOString()){
 const config=await readIncomingConfig(d),token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!config?.secretHash||!req.headers.get('authorization')?.startsWith('Bearer ')||!timingSafeEqual(Buffer.from(digest(token)),Buffer.from(config.secretHash)))return Response.json({error:'Forbidden'},{status:403});
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))return Response.json({error:'JSON required'},{status:415});
 let event:Payload;
 try{event=incomingEventSchema.parse(JSON.parse(await readLimitedText(req,65536)));}
 catch(e){return Response.json({error:'Invalid event'},{status:e instanceof BodyTooLarge?413:400});}
 if(req.headers.get('idempotency-key')!==event.event_id||!normalizePhone(event.contact.phone))return Response.json({error:'Invalid event identity or phone'},{status:400});
 if(!incomingScenarios(config).some(s=>s.scenarioId===event.scenario.id&&s.resultId===event.result.id))return Response.json({ignored:true});
 if(!config.enabled)return Response.json({error:'Import disabled'},{status:503});
 if(Date.parse(event.occurred_at)<Date.parse(config.enabledAt))return Response.json({ignored:true});
 if(Date.parse(event.occurred_at)>Date.parse(now)+300000)return Response.json({error:'Invalid event time'},{status:400});
 await initCRMCallsIncoming(d);
 const existing=await d.prepare('SELECT call_id,event_id FROM crmcalls_incoming WHERE call_id=? OR event_id=?').bind(event.call.id,event.event_id).all();
 if(existing.results.some((r:any)=>r.call_id!==event.call.id))return Response.json({error:'Event conflict'},{status:409});
 if(existing.results.length)return Response.json({duplicate:true});
 const r=await d.prepare("INSERT OR IGNORE INTO crmcalls_incoming(call_id,event_id,data,received_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM crmcalls_incoming WHERE state IN ('pending','review','permission'))<10000").bind(event.call.id,event.event_id,JSON.stringify(event),now).run();
 if(!r.meta.changes){
  const saved=await d.prepare('SELECT call_id FROM crmcalls_incoming WHERE call_id=?').bind(event.call.id).first();
  if(!saved)return Response.json({error:'Queue full'},{status:503});
 }
 // Acknowledge only durable work. Processing is retried by sync-base if this request is interrupted.
 try{await processCRMCallsIncoming(d,event.call.id,now);}catch{/* durable pending row remains */}
 return Response.json({accepted:true});
}
export async function processCRMCallsIncoming(d:Db,callId:string,now=new Date().toISOString(),decision?:Employee){
 if(decision&&!skMayDecide(decision))throw Error('Недостаточно прав');
 const config=await readIncomingConfig(d);if(!config?.enabled)return;
 const row=await d.prepare("SELECT * FROM crmcalls_incoming WHERE call_id=? AND (state='pending' OR (?=1 AND state='permission'))").bind(callId,decision?1:0).first();if(!row)return;
 const p:Payload=JSON.parse(row.data);
 const hold=async(reason:string)=>{await d.prepare("UPDATE crmcalls_incoming SET state='review',reason=?,attempted_at=? WHERE call_id=? AND state='pending'").bind(reason,now,callId).run();return {state:'review',reason};};
 if(!incomingScenarios(config).some(s=>s.scenarioId===p.scenario.id&&s.resultId===p.result.id))return hold('Сценарий или результат больше не включён в настройках');
 const mapped=config.operators.find(o=>o.userId===p.user.id),staff=await skStaff(d),sender=staff.find(e=>e.id===mapped?.employeeId&&e.role==='operator'&&e.accessEnabled!==false);
 if(!sender)return hold('Сопоставьте оператора CRMCalls с действующим оператором CRM');
 const phones=[...new Set([p.contact.phone,...(p.contact.phones||[])].map(normalizePhone).filter(Boolean))];
 const matches=(await d.prepare("SELECT DISTINCT c.data,c.version FROM clients c JOIN client_phone_index i ON i.client_id=c.id WHERE i.phone IN (SELECT value FROM json_each(?))").bind(JSON.stringify(phones.map(v=>v.replace(/\D/g,'')))).all()).results;
 if(matches.length>1)return hold('Телефоны относятся к разным клиентам. Нужна сверка');
 const existing:(Client&{archived?:boolean;archivedAt?:string})|undefined=matches.length?{...JSON.parse(matches[0].data),version:matches[0].version}:undefined;
 if(existing?.archived||existing?.archivedAt)return hold('Клиент в архиве. Нужна сверка');
 const orderRows=existing?(await d.prepare('SELECT id,data FROM orders WHERE client_id=?').bind(existing.id).all()).results:[];
 const orders:Order[]=orderRows.map((r:any)=>JSON.parse(r.data));
 await initSkOrders(d);
 const transferId='cc:'+callId,reason=skOrderReview(undefined,sender,existing,staff.find(e=>e.id===existing?.owner),orders).reasons.join('; ');
 const transfer=await d.prepare('SELECT state,data FROM sk_order_transfers WHERE id=?').bind(transferId).first();
 if(transfer&&transfer.state!=='pending')return {state:transfer.state};
 if(reason&&!decision){
  const input:SkOrderInput={source:'CRMCalls',employeeId:sender.id,callId:transferId,leadId:p.contact.id,email:'',userName:p.user.name,name:existing?.name||p.contact.full_name,phone:existing?.phone||p.contact.phone,address:p.contact.address,city:p.contact.city,comment:p.call.comment};
  await d.batch([
   d.prepare("INSERT INTO sk_order_transfers(id,data,reason,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,reason=excluded.reason WHERE sk_order_transfers.state='pending'").bind(transferId,JSON.stringify(input),reason,row.received_at),
   d.prepare("UPDATE crmcalls_incoming SET state='permission',reason=?,attempted_at=? WHERE call_id=? AND state='pending'").bind(reason,now,callId)]);
  return {state:'permission',reason};
 }
 if(decision&&!transfer)throw Error('Заявка не найдена');
 if(decision&&JSON.parse(transfer.data).employeeId!==sender.id)throw Error('Сопоставление оператора изменилось. Сначала восстановите связь с передавшим сотрудником.');
 const clientId=existing?.id||'C-CC-'+p.contact.id,number=await nextOrderId(d,'crmcalls:'+callId);
 const base:Client=existing||{id:clientId,name:p.contact.full_name.trim()||'Клиент из CRMCalls',phone:normalizePhone(p.contact.phone),linkedPhones:phones.filter(v=>v!==normalizePhone(p.contact.phone)),city:p.contact.city,address:p.contact.address,source:'CRMCalls',baseType:sender.baseAccess==='J'?'J':'M',sheet:'Т1',owner:'',assignedUntil:'',createdAt:now,version:1};
 const client:Client={...base,owner:sender.id,sheet:'К',returnSheet:base.returnSheet||(clientSheet(base)==='К'?'П':clientSheet(base))||'Т1',assignedUntil:'',assignmentStartedAt:base.owner===sender.id?base.assignmentStartedAt||now:now,trialUntil:undefined,trialReturnSheet:undefined,importRetentionUntil:undefined,address:base.address||p.contact.address};
 const policyRow=await d.prepare("SELECT data FROM settings WHERE id='order-policy'").first(),policy=policyRow?orderPolicySchema.parse(JSON.parse(policyRow.data).policy):defaultOrderPolicy;
 const order:Order={id:number,clientId,delivery:'',address:client.address,addressParts:base.addressParts,status:'draft',draftHours:policy.draftHours,items:[],comment:[p.call.comment,existing?.address&&p.contact.address&&existing.address!==p.contact.address?'Адрес из CRMCalls для сверки: '+p.contact.address:''].filter(Boolean).join('\n').slice(0,3000),reason:'',contact:'none',due:'',round:1,extra:false,createdAt:now,updatedAt:now,manager:sender.id,logistic:'',version:1};
 const event={id:'CC-ORDER-'+callId,clientId,orderId:number,at:now,actor:sender.name,actorId:sender.id,text:'Создана карточка из CRMCalls · СМ СРМ'+(decision?' · разрешил '+decision.name:'')};
 const guard="NOT EXISTS(SELECT 1 FROM orders o WHERE o.client_id=? AND o.id<>? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE j.value->>'id'=o.id AND j.value->>'data'=o.data)) AND EXISTS(SELECT 1 FROM crmcalls_incoming WHERE call_id=? AND state=?) AND (?='' OR EXISTS(SELECT 1 FROM sk_order_transfers WHERE id=? AND state='pending')) AND EXISTS(SELECT 1 FROM settings WHERE id='crmcalls-incoming-config' AND json_extract(data,'$.revision')=?) AND EXISTS(SELECT 1 FROM employees WHERE id=? AND version=?)"+(sender.accessEnabled!==undefined?" AND EXISTS(SELECT 1 FROM auth_accounts WHERE employee_id=? AND enabled=1)":"");
 const args=[clientId,number,JSON.stringify(orderRows),callId,decision?'permission':'pending',decision?transferId:'',transferId,config.revision,sender.id,sender.version,...(sender.accessEnabled!==undefined?[sender.id]:[])];
 // All data changes commit together. Version/transfer guards prevent parallel deliveries from stealing ownership.
 const result=await d.batch([
 ...(!existing?[d.prepare('INSERT INTO clients(id,phone,data) SELECT ?,?,? WHERE '+guard).bind(clientId,base.phone,JSON.stringify(base),...args)]:[]),
 d.prepare('INSERT INTO orders(id,client_id,data) SELECT ?,?,? WHERE '+guard+' AND EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?)').bind(number,clientId,JSON.stringify(order),...args,clientId,base.version),
 d.prepare('UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM orders WHERE id=?) AND '+guard).bind(JSON.stringify(client),clientId,base.version,number,...args),
 d.prepare('INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?) AND '+guard).bind(event.id,clientId,number,now,JSON.stringify(event),number,...args),
 d.prepare("UPDATE crmcalls_incoming SET state='imported',order_id=?,reason='',attempted_at=? WHERE call_id=? AND state=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(number,now,callId,decision?'permission':'pending',number),
 ...(decision?[d.prepare("UPDATE sk_order_transfers SET state='imported',order_id=?,decided_by=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(number,decision.id,transferId,number)]:[])]);
 if(!result[existing?0:1].meta.changes)throw Error('Concurrent change');
 await reconcileIncomingOwners(d,clientId,now);
 return {state:'imported',orderId:number};
}
export async function runCRMCallsIncoming(d:Db,includeReview=false){
 if(!(await readIncomingConfig(d))?.enabled)return;
 await initCRMCallsIncoming(d);
 const rows=(await d.prepare("SELECT call_id FROM crmcalls_incoming WHERE state='pending' OR (?=1 AND state='review') ORDER BY attempted_at,received_at LIMIT 50").bind(includeReview?1:0).all()).results;
 for(const row of rows)try{if(includeReview)await d.prepare("UPDATE crmcalls_incoming SET state='pending' WHERE call_id=? AND state='review'").bind(row.call_id).run();await processCRMCallsIncoming(d,row.call_id);}catch{await d.prepare("UPDATE crmcalls_incoming SET reason='Временная ошибка обработки. Повтор будет выполнен автоматически',attempted_at=? WHERE call_id=? AND state='pending'").bind(new Date().toISOString(),row.call_id).run();}
}

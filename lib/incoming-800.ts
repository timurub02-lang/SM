import {createHash, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import {initIncoming, incomingRouting} from './incoming.ts';
import {initBaseStorage} from './base-storage.ts';

export const incoming800Schema = z.object({
 v:z.literal(1), node:z.string().regex(/^[a-z0-9-]{1,64}$/),
 callId:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
 route:z.enum(['megafon','mtt']), phone:z.string().regex(/^(?:\+[1-9][0-9]{7,14})?$/),
 calledNumber:z.string().regex(/^\+7800[0-9]{7}$/), at:z.string().datetime()
}).strict();
export type Incoming800Event = z.infer<typeof incoming800Schema>;
type Receipt = {id:string; payload:string; disposition:string; request_id:string|null; reason:string};
export class Incoming800Conflict extends Error {}
const initialized = new WeakMap<Db,Promise<void>>();
export async function initIncoming800(d:Db){
 let pending=initialized.get(d);
 if(!pending){pending=(async()=>{
  await initIncoming(d); await initBaseStorage(d);
  await d.prepare(`CREATE TABLE IF NOT EXISTS incoming_800_events(
   id TEXT PRIMARY KEY,payload TEXT NOT NULL,received_at TEXT NOT NULL,
   disposition TEXT NOT NULL DEFAULT 'pending',request_id TEXT,reason TEXT NOT NULL DEFAULT '')`).run();
 })();initialized.set(d,pending);pending.catch(()=>initialized.delete(d));}
 await pending;
}
export const incoming800Id=(p:Incoming800Event)=>'AST800-'+createHash('sha256').update(p.node+':'+p.callId).digest('hex').slice(0,32);
const receipt=(r:Receipt)=>({ok:true,eventId:r.id,disposition:r.disposition,requestId:r.request_id,reason:r.reason});

export async function receiveIncoming800(d:Db,input:Incoming800Event,now=new Date().toISOString()){
 const p=incoming800Schema.parse(input), id=incoming800Id(p), payload=JSON.stringify(p);
 await initIncoming800(d);
 const read=()=>d.prepare('SELECT * FROM incoming_800_events WHERE id=?').bind(id).first() as Promise<Receipt|null>;
 const previous=await read();
 if(previous){if(previous.payload!==payload)throw new Incoming800Conflict('Event identity reused');if(previous.disposition==='pending')throw new Error('Unfinished receipt');return receipt(previous);}
 const reason=!p.phone?'missing_caller':!/^\+7[0-9]{10}$/.test(p.phone)?'unsupported_phone':'';
 const client=reason?null:await d.prepare('SELECT c.id,c.data FROM clients c JOIN client_phone_index i ON c.id=i.client_id WHERE i.phone=?').bind(p.phone.slice(1)).first();
 const routed=reason?null:await incomingRouting(d,client?.id||'',client?JSON.parse(client.data):null,p.at);
 const assignee=routed?.assignee?.id||null, department=routed?.department||'', shared=!assignee;
 const source='asterisk800:'+p.route;
 // One atomic receipt + request write; preserve an existing task's manual assignment.
 const pending="EXISTS(SELECT 1 FROM incoming_800_events WHERE id=? AND payload=? AND disposition='pending')";
 await d.batch([
  d.prepare('INSERT OR IGNORE INTO incoming_800_events(id,payload,received_at) VALUES(?,?,?)').bind(id,payload,now),
  d.prepare("UPDATE incoming_800_events SET disposition='review',reason=? WHERE id=? AND payload=? AND disposition='pending' AND ?<>''").bind(reason,id,payload,reason),
  d.prepare("UPDATE incoming_800_events SET disposition='blocked',reason='phone_blocked' WHERE id=? AND payload=? AND disposition='pending' AND EXISTS(SELECT 1 FROM incoming_phone_policy WHERE phone=? AND policy='block')").bind(id,payload,p.phone),
  d.prepare(`UPDATE incoming_800_events SET disposition='review',reason='open_request_conflict'
   WHERE id=? AND payload=? AND disposition='pending' AND EXISTS(SELECT 1 FROM incoming_calls
   WHERE phone=? AND closed_at IS NULL AND (client_id IS NOT ? OR spam=1))`).bind(id,payload,p.phone,client?.id||null),
  d.prepare(`INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number,shared_queue,call_count,last_at,source,order_id)
   SELECT ?,?,?,?,?,?,?,?,0,?,?,? WHERE ${pending} AND NOT EXISTS(SELECT 1 FROM incoming_calls WHERE phone=? AND closed_at IS NULL)`)
   .bind(id,client?.id||null,assignee,department,p.at,p.phone,p.calledNumber,shared?1:0,p.at,source,routed?.callbackOrderId||null,id,payload,p.phone),
  d.prepare("UPDATE incoming_800_events SET request_id=(SELECT id FROM incoming_calls WHERE phone=? AND closed_at IS NULL ORDER BY at,id LIMIT 1) WHERE id=? AND payload=? AND disposition='pending'").bind(p.phone,id,payload),
  d.prepare(`UPDATE incoming_calls SET call_count=call_count+1,last_at=MAX(at,last_at,?),
   source=CASE WHEN source=? THEN source ELSE 'asterisk800:mixed' END
   WHERE id=(SELECT request_id FROM incoming_800_events WHERE id=? AND payload=? AND disposition='pending')`).bind(p.at,source,id,payload),
  d.prepare("UPDATE incoming_800_events SET disposition='accepted' WHERE id=? AND payload=? AND disposition='pending' AND request_id IS NOT NULL").bind(id,payload)
 ]);
 const saved=await read();
 if(!saved||saved.disposition==='pending')throw new Error('Incoming event was not applied');
 if(saved.payload!==payload)throw new Incoming800Conflict('Event identity reused');
 return receipt(saved);
}

export async function incoming800Http(req:Request,d:()=>Db,env:NodeJS.ProcessEnv=process.env){
 if(env.CRM_INCOMING_800_ENABLED!=='1')return Response.json({error:'Disabled'},{status:404});
 const secret=Buffer.from(env.CRM_INCOMING_800_KEY||''),given=Buffer.from(req.headers.get('x-crm-incoming-key')||'');
 if(secret.length<32||secret.length!==given.length||!timingSafeEqual(secret,given))return Response.json({error:'Forbidden'},{status:403});
 let routes:Partial<Record<'megafon'|'mtt',string>>;
 try{
  routes=z.object({megafon:z.string().regex(/^\+7800[0-9]{7}$/).optional(),mtt:z.string().regex(/^\+7800[0-9]{7}$/).optional()}).strict().parse(JSON.parse(env.CRM_INCOMING_800_ROUTES||''));
  if(!/^[a-z0-9-]{1,64}$/.test(env.CRM_INCOMING_800_NODE||'')||!Object.keys(routes).length)throw Error();
 }catch{return Response.json({error:'Receiver configuration unavailable'},{status:503});}
 let p:Incoming800Event;
 try{
  const reader=req.body?.getReader();if(!reader)throw Error();let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return Response.json({error:'Too large'},{status:413});}chunks.push(value);}
  p=incoming800Schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if(Date.parse(p.at)>Date.now()+60000)throw Error();
 }catch{return Response.json({error:'Invalid event'},{status:400});}
 if(p.node!==env.CRM_INCOMING_800_NODE||routes[p.route]!==p.calledNumber)return Response.json({error:'Source not allowed'},{status:403});
 try{return Response.json(await receiveIncoming800(d(),p));}
 catch(e){return Response.json({error:e instanceof Incoming800Conflict?'Event identity conflict':'Temporarily unavailable'},{status:e instanceof Incoming800Conflict?409:503});}
}

import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {ActivityDb} from './activity-store.ts';

const id=z.union([z.number().int().positive().safe(),z.string().regex(/^[1-9]\d{0,19}$/)]).transform(String);
const callResult=z.object({type:z.literal('call_result'),call:z.object({id}),call_result:z.object({result_id:id,comment:z.string().transform(value=>value.slice(0,3000)).nullish()})});
const schema=z.discriminatedUnion('type',[callResult,z.object({type:z.literal('form_response')}),z.object({type:z.literal('call_project_case_failed')})]);
const maxBodyBytes=20*1024*1024; // Match the existing nginx body limit, including provider batches and unused lead fields.
export async function initSkOrderEvents(d:ActivityDb){
 await d.prepare("CREATE TABLE IF NOT EXISTS sk_order_events(call_id TEXT PRIMARY KEY,event_key TEXT NOT NULL,result_id TEXT NOT NULL,comment TEXT NOT NULL,received_at INTEGER NOT NULL,done_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,lease_token TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '')").run();
 await d.prepare('CREATE INDEX IF NOT EXISTS sk_order_events_ready ON sk_order_events(done_at,next_at,received_at)').run();
 await d.prepare('CREATE UNIQUE INDEX IF NOT EXISTS sk_order_events_key ON sk_order_events(event_key)').run();
 await d.prepare('CREATE TABLE IF NOT EXISTS sk_order_event_health(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)').run();
}
export async function receiveSkOrderEvent(d:ActivityDb,req:Request,secret=process.env.CRM_SK_WEBHOOK_KEY||'',now=Date.now()){
 const expected=Buffer.from('Bearer '+secret),given=Buffer.from(req.headers.get('authorization')||'');
 if(secret.length<32||expected.length!==given.length||!timingSafeEqual(expected,given))return Response.json({error:'Forbidden'},{status:403});
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))return Response.json({error:'JSON required'},{status:415});
 const key=req.headers.get('idempotency-key')||'';
 if(!key||key.length>200||/[\x00-\x1f]/.test(key))return Response.json({error:'Invalid event key'},{status:400});
 const reader=req.body?.getReader();if(!reader)return Response.json({error:'Empty body'},{status:400});
 let events:z.infer<typeof schema>[],isBatch=false;
 try{
  let length=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>maxBodyBytes){await reader.cancel();return Response.json({error:'Too large'},{status:413});}chunks.push(value);}
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));isBatch=Array.isArray(payload);
  events=z.array(schema).parse(isBatch?payload:[payload]);
 }catch{return Response.json({error:'Invalid call result'},{status:400});}
 const calls=events.filter((event):event is z.infer<typeof callResult>=>event.type==='call_result');
 if(!calls.length)return Response.json({ignored:true});
 const row=await d.prepare("SELECT data FROM settings WHERE id='sk-order-import'").first(),config=row?JSON.parse(row.data):null;
 if(!config?.enabled||!Array.isArray(config.resultIds)||!config.resultIds.length)return Response.json({error:'Import disabled'},{status:503});
 const selected=new Set(config.resultIds.map(String)),unique=new Map<string,{call_id:string;event_key:string;result_id:string;comment:string}>();
 for(const event of calls){
  if(!selected.has(event.call_result.result_id)||unique.has(event.call.id))continue;
  unique.set(event.call.id,{call_id:event.call.id,event_key:isBatch?'batch:'+createHash('sha256').update(JSON.stringify([key,event.call.id])).digest('hex'):key,result_id:event.call_result.result_id,comment:event.call_result.comment||''});
 }
 if(!unique.size)return Response.json({ignored:true});
 const incoming=JSON.stringify([...unique.values()]);
 await initSkOrderEvents(d);
 // Retain pending work; completed calls remain deduplicated by sk_order_transfers after queue cleanup.
 await d.prepare('DELETE FROM sk_order_events WHERE done_at IS NOT NULL AND done_at<?').bind(now-86400000).run();
 // One SQLite statement reserves capacity for the whole batch, including concurrent deliveries.
 await d.prepare(`WITH incoming AS (
  SELECT value->>'call_id' call_id,value->>'event_key' event_key,value->>'result_id' result_id,value->>'comment' comment FROM json_each(?)
 ), missing AS (SELECT * FROM incoming i WHERE NOT EXISTS(SELECT 1 FROM sk_order_events e WHERE e.call_id=i.call_id))
 INSERT INTO sk_order_events(call_id,event_key,result_id,comment,received_at)
 SELECT call_id,event_key,result_id,comment,? FROM missing
 WHERE (SELECT COUNT(*) FROM missing)+(SELECT COUNT(*) FROM sk_order_events WHERE done_at IS NULL)<=10000
 AND NOT EXISTS(SELECT 1 FROM incoming i JOIN sk_order_events e ON e.event_key=i.event_key WHERE e.call_id<>i.call_id)`).bind(incoming,now).run();
 if(await d.prepare("SELECT 1 FROM json_each(?) i JOIN sk_order_events e ON e.event_key=i.value->>'event_key' WHERE e.call_id<>i.value->>'call_id' LIMIT 1").bind(incoming).first())return Response.json({error:'Event key conflict'},{status:409});
 if(await d.prepare("SELECT 1 FROM json_each(?) i WHERE NOT EXISTS(SELECT 1 FROM sk_order_events e WHERE e.call_id=i.value->>'call_id') LIMIT 1").bind(incoming).first())return Response.json({error:'Import queue full'},{status:503,headers:{'Retry-After':'60'}});
 return Response.json({accepted:true});
}

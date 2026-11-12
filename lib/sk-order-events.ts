import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {ActivityDb} from './activity-store.ts';

const id=z.union([z.number().int().positive().safe(),z.string().regex(/^[1-9]\d{0,19}$/)]).transform(String);
const schema=z.object({type:z.literal('call_result'),call:z.object({id,result_id:id}),call_result:z.object({result_id:id,comment:z.string().max(3000).nullish()})});
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
 let event:z.infer<typeof schema>;
 try{
  let length=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();return Response.json({error:'Too large'},{status:413});}chunks.push(value);}
  event=schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if(event.call.result_id!==event.call_result.result_id)throw Error('Result mismatch');
 }catch{return Response.json({error:'Invalid call result'},{status:400});}
 const row=await d.prepare("SELECT data FROM settings WHERE id='sk-order-import'").first(),config=row?JSON.parse(row.data):null;
 if(!config?.enabled)return Response.json({error:'Import disabled'},{status:503});
 if(!Array.isArray(config.resultIds)||!config.resultIds.some((value:unknown)=>String(value)===event.call.result_id))return Response.json({ignored:true},{status:202});
 await initSkOrderEvents(d);
 // Retain pending work; completed calls remain deduplicated by sk_order_transfers after queue cleanup.
 await d.prepare('DELETE FROM sk_order_events WHERE done_at IS NOT NULL AND done_at<?').bind(now-86400000).run();
 const priorKey=await d.prepare('SELECT call_id FROM sk_order_events WHERE event_key=?').bind(key).first();
 if(priorKey&&priorKey.call_id!==event.call.id)return Response.json({error:'Event key conflict'},{status:409});
 const exists=await d.prepare('SELECT call_id FROM sk_order_events WHERE call_id=?').bind(event.call.id).first();
 if(exists)return Response.json({accepted:true},{status:202});
 const result=await d.prepare("INSERT OR IGNORE INTO sk_order_events(call_id,event_key,result_id,comment,received_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM sk_order_events WHERE done_at IS NULL)<10000").bind(event.call.id,key,event.call.result_id,event.call_result.comment||'',now).run();
 if(!result.meta.changes&&!await d.prepare('SELECT call_id FROM sk_order_events WHERE call_id=?').bind(event.call.id).first())return Response.json({error:'Import queue full'},{status:503,headers:{'Retry-After':'60'}});
 return Response.json({accepted:true},{status:202});
}

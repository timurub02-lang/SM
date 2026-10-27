import {initReplacement} from '@/lib/phone-replacement';
import {trustedPbx as trusted} from '@/lib/phone-pbx-auth';
import {mkdir,writeFile,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {db} from '@/lib/db';
import {incomingCallTarget,initPhone,type PhoneCall} from '@/lib/phone-store';
import {phoneAccount,phoneRoles} from '@/lib/phone-accounts';
export const dynamic='force-dynamic';

export async function GET(req:Request){
 if(!trusted(req))return Response.json({error:'Forbidden'},{status:403});
 const params=new URL(req.url).searchParams;
 if(params.get('accounts')==='1'){
  const rows=(await db().prepare('SELECT e.data FROM employees e JOIN auth_accounts a ON a.employee_id=e.id WHERE a.enabled=1').all()).results as {data:string}[];
  return Response.json({accounts:rows.map(r=>JSON.parse(r.data)).filter(e=>phoneRoles.includes(e.role)).map(e=>phoneAccount(e.id))},{headers:{'Cache-Control':'no-store'}});
 }
 const id=params.get('callId')||'';if(!/^[a-f0-9]{32}$/.test(id))return Response.json({error:'Not found'},{status:404});
 await initPhone(db());
 const target=await db().prepare('SELECT t.destination,t.sip_user,c.actor_id FROM phone_call_targets t JOIN phone_calls c ON c.id=t.call_id WHERE t.call_id=?').bind(id).first<{destination:string;sip_user:string;actor_id:string}>();
 if(!target||target.sip_user!==params.get('endpoint'))return Response.json({error:'Invalid endpoint'},{status:403});
 const employee=await db().prepare('SELECT e.data FROM employees e JOIN auth_accounts a ON a.employee_id=e.id WHERE e.id=? AND a.enabled=1').bind(target.actor_id).first<{data:string}>();
 if(!employee||!phoneRoles.includes(JSON.parse(employee.data).role))return Response.json({error:'Account disabled'},{status:403});
 const incoming=await db().prepare('SELECT incoming_id FROM phone_call_incoming WHERE call_id=?').bind(id).first<{incoming_id:string}>();
 if(incoming){try{if(await incomingCallTarget(db(),JSON.parse(employee.data),incoming.incoming_id)!==target.destination)throw Error('Changed destination');}catch{return Response.json({error:'Обращение изменилось или больше недоступно. Обновите данные'},{status:403});}}
 const now=new Date().toISOString();
 const r=await db().prepare("UPDATE phone_calls SET claimed_at=?,status='dialing' WHERE id=? AND claimed_at IS NULL AND ended_at IS NULL AND started_at>? AND (caller_number='' OR EXISTS(SELECT 1 FROM phone_numbers WHERE number=caller_number AND state='active'))").bind(now,id,new Date(Date.now()-120000).toISOString()).run();
 if(!r.meta.changes)return Response.json({error:'Call expired or already used'},{status:409});
 const call=await db().prepare('SELECT caller_number FROM phone_calls WHERE id=?').bind(id).first<{caller_number:string}>();
 return Response.json({callerId:call!.caller_number,destination:target.destination},{headers:{'Cache-Control':'no-store'}});
}
const result=z.object({event:z.literal('replacement').optional(),id:z.string().regex(/^[a-f0-9]{32}$/),started:z.number().int().positive(),answered:z.number().int().nonnegative(),ended:z.number().int().positive(),status:z.enum(['ANSWER','ANSWERED','BUSY','NOANSWER','CANCEL','CHANUNAVAIL','CONGESTION','FAILED','']),cause:z.string().regex(/^\d{0,3}$/),audio:z.string().max(44*1024*1024).optional(),analysis:z.object({kind:z.enum(['human','machine','screening','unknown']),reason:z.enum(['screening_greeting','recorded_greeting','speech_turns','unclear','analysis_error','no_remote_audio']),method:z.literal('local-asr-v1')}).optional()});
export async function POST(req:Request){
 if(!trusted(req))return Response.json({error:'Forbidden'},{status:403});
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Empty result');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>45*1024*1024){await reader.cancel();return Response.json({error:'Too large'},{status:413});}chunks.push(value);}
  const p=result.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));await initPhone(db());
  if(p.event==='replacement')await initReplacement(db());const table=p.event==='replacement'?'replacement_calls':'phone_calls';
  const c=await db().prepare(`SELECT * FROM ${table} WHERE id=?`).bind(p.id).first<PhoneCall>();if(!c)return Response.json({error:'Call not found'},{status:404});
  if(c.provider_at)return Response.json({ok:true}); // Retries must not overwrite a completed recording or result.
  if(!c.claimed_at||p.ended<p.started||p.ended-p.started>1860||p.answered&&(p.answered<p.started||p.answered>p.ended)||Math.abs(p.started-Date.parse(c.claimed_at)/1000)>120)throw Error('Invalid call times');
  const connected=p.answered>0,status=connected?'completed':p.status==='BUSY'||p.cause==='17'?'busy':p.status==='NOANSWER'||['18','19'].includes(p.cause)?'no_answer':p.status==='CANCEL'||p.cause==='16'?'cancelled':'failed';
  let recorded=false;
  if(connected&&p.audio){const audio=Buffer.from(p.audio,'base64');if(audio.length>32*1024*1024||audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw Error('Invalid audio');
   const dir=process.env.CRM_PHONE_RECORDINGS_DIR||'/var/lib/sm-crm/recordings';await mkdir(dir,{recursive:true,mode:0o700});const file=join(dir,p.id+'.wav'),temp=file+'.'+crypto.randomUUID()+'.tmp';await writeFile(temp,audio,{mode:0o600});try{await link(temp,file);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}finally{await unlink(temp);}recorded=true;
  }
  const iso=(s:number)=>new Date(s*1000).toISOString();
  const writes=[db().prepare(`UPDATE ${table} SET status=?,detail=?,answered_at=?,ended_at=?,duration=?,bill_seconds=?,recording=?,provider_at=? WHERE id=? AND provider_at IS NULL`).bind(status,connected?'Соединение могло быть с клиентом или автоответчиком.':status==='failed'?`АТС не смогла соединить звонок${p.cause?' (код '+p.cause+')':''}.`:'',connected?iso(p.answered):null,iso(p.ended),p.ended-p.started,connected?p.ended-p.answered:0,recorded?1:0,new Date().toISOString(),p.id)];
  if(!p.event&&connected&&p.analysis&&c.caller_number)writes.push(db().prepare('INSERT INTO phone_call_analysis(call_id,auto_kind,auto_reason,analyzed_at) VALUES(?,?,?,?) ON CONFLICT(call_id) DO UPDATE SET auto_kind=excluded.auto_kind,auto_reason=excluded.auto_reason,analyzed_at=excluded.analyzed_at WHERE phone_call_analysis.analyzed_at IS NULL').bind(c.id,p.analysis.kind,p.analysis.reason,new Date().toISOString()));
  await db().batch(writes);
  return Response.json({ok:true});
 }catch{return Response.json({error:'Invalid call result'},{status:400});}
}

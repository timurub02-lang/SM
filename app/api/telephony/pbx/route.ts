import {timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {db} from '@/lib/db';
import {initPhone,type PhoneCall} from '@/lib/phone-store';
export const dynamic='force-dynamic';
function trusted(req:Request){const secret=Buffer.from(process.env.CRM_PHONE_RESULT_KEY||''),given=Buffer.from(req.headers.get('x-crm-pbx-key')||'');return secret.length>=32&&secret.length===given.length&&timingSafeEqual(secret,given);}
export async function GET(req:Request){
 if(!trusted(req))return Response.json({error:'Forbidden'},{status:403});
 const id=new URL(req.url).searchParams.get('callId')||'';if(!/^[a-f0-9]{32}$/.test(id))return Response.json({error:'Not found'},{status:404});
 await initPhone(db());const now=new Date().toISOString();
 const r=await db().prepare("UPDATE phone_calls SET claimed_at=?,status='dialing' WHERE id=? AND claimed_at IS NULL AND ended_at IS NULL AND started_at>? AND (caller_number='' OR EXISTS(SELECT 1 FROM phone_numbers WHERE number=caller_number AND state='active'))").bind(now,id,new Date(Date.now()-120000).toISOString()).run();
 if(!r.meta.changes)return Response.json({error:'Call expired or already used'},{status:409});
 const call=await db().prepare('SELECT caller_number FROM phone_calls WHERE id=?').bind(id).first<{caller_number:string}>();
 return Response.json({callerId:call!.caller_number},{headers:{'Cache-Control':'no-store'}});
}
const result=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),started:z.number().int().positive(),answered:z.number().int().nonnegative(),ended:z.number().int().positive(),status:z.enum(['ANSWER','ANSWERED','BUSY','NOANSWER','CANCEL','CHANUNAVAIL','CONGESTION','FAILED','']),cause:z.string().regex(/^\d{0,3}$/),audio:z.string().max(6*1024*1024).optional()});
export async function POST(req:Request){
 if(!trusted(req))return Response.json({error:'Forbidden'},{status:403});
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Empty result');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>7*1024*1024){await reader.cancel();return Response.json({error:'Too large'},{status:413});}chunks.push(value);}
  const p=result.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));await initPhone(db());
  const c=await db().prepare('SELECT * FROM phone_calls WHERE id=?').bind(p.id).first<PhoneCall>();if(!c)return Response.json({error:'Call not found'},{status:404});
  if(c.provider_at)return Response.json({ok:true}); // Retries must not overwrite a completed recording or result.
  if(!c.claimed_at||p.ended<p.started||p.ended-p.started>300||p.answered&&(p.answered<p.started||p.answered>p.ended)||Math.abs(p.started-Date.parse(c.claimed_at)/1000)>120)throw Error('Invalid call times');
  const connected=p.answered>0,status=connected?'completed':p.status==='BUSY'||p.cause==='17'?'busy':p.status==='NOANSWER'||['18','19'].includes(p.cause)?'no_answer':p.status==='CANCEL'||p.cause==='16'?'cancelled':'failed';
  let recorded=false;
  if(connected&&p.audio){const audio=Buffer.from(p.audio,'base64');if(audio.length>4*1024*1024||audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw Error('Invalid audio');
   const dir=process.env.CRM_PHONE_RECORDINGS_DIR||'/var/lib/sm-crm/recordings';await mkdir(dir,{recursive:true,mode:0o700});const file=join(dir,p.id+'.wav'),temp=file+'.'+crypto.randomUUID()+'.tmp';await writeFile(temp,audio,{mode:0o600});try{await link(temp,file);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}finally{await unlink(temp);}recorded=true;
  }
  const iso=(s:number)=>new Date(s*1000).toISOString();
  await db().prepare('UPDATE phone_calls SET status=?,detail=?,answered_at=?,ended_at=?,duration=?,bill_seconds=?,recording=?,provider_at=? WHERE id=? AND provider_at IS NULL').bind(status,connected?'Соединение могло быть с клиентом или автоответчиком.':status==='failed'?`АТС не смогла соединить звонок${p.cause?' (код '+p.cause+')':''}.`:'',connected?iso(p.answered):null,iso(p.ended),p.ended-p.started,connected?p.ended-p.answered:0,recorded?1:0,new Date().toISOString(),p.id).run();
  return Response.json({ok:true});
 }catch{return Response.json({error:'Invalid call result'},{status:400});}
}

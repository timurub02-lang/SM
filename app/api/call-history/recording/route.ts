import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initPhone,phoneScope,type PhoneCall} from '@/lib/phone-store';
export const dynamic='force-dynamic';
export const GET=authenticated(async req=>{
 const id=new URL(req.url).searchParams.get('id')||'',e=(await getChatGPTUser())?.employee;
 if(!e||!/^[a-f0-9]{32}$/.test(id))return new Response(null,{status:404});
 const masked=new URL(req.url).searchParams.get('masked')==='1';
 if(masked&&!['admin','redemption'].includes(e.role))return new Response(null,{status:403});
 await initPhone(db());const c=await db().prepare(masked?'SELECT * FROM replacement_calls WHERE id=?':'SELECT * FROM phone_calls WHERE id=?').bind(id).first<PhoneCall>();
 if(!c||!c.recording||!masked&&!(await phoneScope(db(),e,{clientId:c.client_id||undefined})||c.order_id&&await phoneScope(db(),e,{orderId:c.order_id})))return new Response(null,{status:403});
 try{
  const audio=await readFile(join(process.env.CRM_PHONE_RECORDINGS_DIR||'/var/lib/sm-crm/recordings',id+'.wav'));
  const headers:Record<string,string>={'Content-Type':'audio/wav','Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="call-${id}.wav"`};
  const range=req.headers.get('range');let start=0,end=audio.length-1;
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${audio.length}`}});start=m[1]?Number(m[1]):Math.max(0,audio.length-Number(m[2]));end=m[1]&&m[2]?Math.min(Number(m[2]),end):end;if(!Number.isSafeInteger(start)||start<0||start>end)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${audio.length}`}});headers['Content-Range']=`bytes ${start}-${end}/${audio.length}`;}
  headers['Content-Length']=String(end-start+1);return new Response(new Uint8Array(audio.subarray(start,end+1)),{status:range?206:200,headers});
 }catch{return new Response('Запись пока недоступна. Обновите историю позже.',{status:404});}
});

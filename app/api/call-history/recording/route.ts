import {open} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {byteRange} from '@/lib/byte-range';
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
  const file=await open(join(process.env.CRM_PHONE_RECORDINGS_DIR||'/var/lib/sm-crm/recordings',id+'.wav'),'r');
  let streaming=false;
  try{
  const {size}=await file.stat();
  const headers:Record<string,string>={'Content-Type':'audio/wav','Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="call-${id}.wav"`};
  const range=req.headers.get('range'),selected=byteRange(range,size);
  if(!selected)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  const {start,end}=selected;
  if(range)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  headers['Content-Length']=String(end-start+1);
  if(!size)return new Response(null,{headers});
  const stream=file.createReadStream({start,end,autoClose:true});streaming=true;
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{status:range?206:200,headers});
  }finally{if(!streaming)await file.close();}
 }catch{return new Response('Запись пока недоступна. Обновите историю позже.',{status:404});}
});

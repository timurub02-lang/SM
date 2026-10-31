import {readLimitedText} from '@/lib/request-body';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {sessionEmployee,trustedOrigin,cookieToken} from '@/lib/auth';
import {db} from '@/lib/db';
import {initPhone,incomingCallTarget} from '@/lib/phone-store';
import {hasOktellLink} from '@/lib/oktell-link';
import {manualOktellOutcome} from '@/lib/oktell-call-outcome';
import {clientPhones} from '@/lib/client-call-targets';
export const dynamic='force-dynamic';
const input=z.object({action:z.enum(['connect','heartbeat','disconnect','call']),tab:z.string().uuid(),mode:z.enum(['client','order','incoming']).optional(),orderId:z.string().min(1).max(100).optional(),incomingId:z.string().min(1).max(100).optional(),clientId:z.string().max(100).optional(),phoneKey:z.string().max(64).optional()}).strict();
function control(actorId:string,body?:unknown){return new Promise<any>((resolve,reject)=>{
 const r=http.request({socketPath:process.env.OKTELL_CONTROL_SOCKET||'/run/sm-oktell-bridge/control.sock',path:'/browser-phone?actor='+encodeURIComponent(actorId),method:body?'POST':'GET',headers:{'Content-Type':'application/json'}},s=>{let raw='';s.on('data',x=>{raw+=x;if(raw.length>16000)r.destroy(Error('Invalid bridge response'));});s.on('end',()=>{try{const data=JSON.parse(raw);if(s.statusCode!==200)reject(Object.assign(Error(data.error||'Oktell недоступен'),{status:s.statusCode}));else resolve(data);}catch(e){reject(e);}});});
 r.on('error',reject);r.setTimeout(20000,()=>r.destroy(Error('Oktell не ответил вовремя')));r.end(body?JSON.stringify(body):undefined);
});}
async function actor(req:Request){const a=await sessionEmployee(req.headers);return hasOktellLink(a)?a:null;}
export async function GET(req:Request){
 const a=await actor(req);if(!a)return Response.json({error:'Телефон Oktell для вас пока не подключён'},{status:403});
 try{return Response.json(await control(a.id),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Нет связи с Oktell'},{status:502});}
}
export async function POST(req:Request){
 const a=await actor(req);if(!a||!trustedOrigin(req.headers))return Response.json({error:'Нет доступа'},{status:403});
 try{
  const raw=await readLimitedText(req,8192);if(raw.length>2048)return Response.json({error:'Слишком большой запрос'},{status:413});
  const b=input.parse(JSON.parse(raw)),owner=createHash('sha256').update(cookieToken(req.headers)+':'+b.tab).digest('hex');
  if(b.action==='call'){
   const mode=b.mode||'client';
   if((mode==='client'&&!b.clientId)||(mode==='order'&&!b.orderId)||(mode==='incoming'&&!b.incomingId))throw Object.assign(Error('Выберите клиента, заказ или обращение'),{status:400});
   let number:string,clientId:string|null=null;
   try{
    if(mode==='incoming')number=await incomingCallTarget(db(),a,b.incomingId!);
    else{const result=await clientPhones(a,mode==='order'?{mode,orderId:b.orderId}:{mode,clientId:b.clientId});clientId=result.clientId;const selected=b.phoneKey?result.phones.find(p=>p.key===b.phoneKey):result.phones[0];if(!selected)throw Error('Выбранный номер недоступен. Обновите список номеров');number=selected.number;}
   }catch(e){throw Object.assign(e instanceof Error?e:Error('Нет доступа к номеру клиента'),{status:403});}
   await initPhone(db());const callId=crypto.randomUUID().replaceAll('-','');
   await db().prepare("INSERT INTO phone_calls(id,client_id,order_id,actor_id,actor_name,caller_number,started_at,status,detail) VALUES(?,?,?,?,?,?,?,'preparing',?)").bind(callId,clientId,mode==='order'?b.orderId:null,a.id,a.name,'',new Date().toISOString(),'Oktell / МТС · звонок клиенту').run();
   if(mode==='incoming')await db().prepare('INSERT INTO phone_call_incoming(call_id,incoming_id) VALUES(?,?)').bind(callId,b.incomingId).run();
   try{await control(a.id,{action:'authorize',actor:a.id,owner,destination:number,callId});}
   catch(e){await db().prepare("UPDATE phone_calls SET status='failed',ended_at=?,detail=? WHERE id=?").bind(new Date().toISOString(),'Oktell / МТС · не удалось подготовить вызов',callId).run();throw e;}
   return Response.json({callId,destination:number},{headers:{'Cache-Control':'no-store'}});
  }
  const result=await control(a.id,{action:b.action,actor:a.id,owner});
  if(b.action==='heartbeat'&&result.call){
   const c=result.call;
   if(/^[a-f0-9]{32}$/.test(c.id)&&['dialing','connected','ended','cancelled','failed','busy','no_answer','unknown'].includes(c.status)){
    const {status,answered,detail}=manualOktellOutcome(c.status);
    const ended=c.endedAt||null;
    await db().prepare("UPDATE phone_calls SET status=?,answered_at=COALESCE(answered_at,?),ended_at=COALESCE(ended_at,?),bill_seconds=CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN MAX(0,CAST((julianday(?)-julianday(?))*86400 AS INTEGER)) ELSE bill_seconds END,provider_at=?,detail=? WHERE id=? AND actor_id=? AND detail LIKE 'Oktell / МТС%' AND (ended_at IS NULL OR status='unknown')").bind(status,answered,ended,answered,ended,ended,answered,new Date().toISOString(),'Oktell / МТС · '+detail,c.id,a.id).run();
   }
  }
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Неверная команда':e instanceof Error?e.message:'Oktell недоступен'},{status:e instanceof z.ZodError||e instanceof SyntaxError?400:(e as any)?.status||502,headers:{'Cache-Control':'no-store'}});}
}

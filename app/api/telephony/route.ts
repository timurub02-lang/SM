import {clientPhones} from '@/lib/client-call-targets';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {z} from 'zod';
import {incomingCallTarget,createPhoneCall,initPhone,normalizeOutgoingNumber} from '@/lib/phone-store';

import {phoneAccount,phoneRoles} from '@/lib/phone-accounts';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('test')}),z.object({mode:z.literal('echo')}),
 z.object({mode:z.literal('incoming'),incomingId:z.string().min(1).max(100)}),
 z.object({mode:z.literal('client'),clientId:z.string().min(1),phoneKey:z.string().max(64).optional()}),
 z.object({mode:z.literal('order'),orderId:z.string().min(1),phoneKey:z.string().max(64).optional()})
]);
function config(){return {phone:process.env.CRM_PHONE_TEST_NUMBER||'',callerId:process.env.CRM_PHONE_CALLER_ID||''};}
async function allowed(){const user=await getChatGPTUser();return process.env.CRM_PHONE_STAFF_ENABLED==='1'&&!!user?.employee&&phoneRoles.includes(user.employee.role);}
export const GET=authenticated(async(req:Request)=>{
 if(!await allowed())return Response.json({error:'Телефония недоступна для этой роли'},{status:403});
 const url=new URL(req.url);
 if(url.searchParams.has('mode')){try{const p=input.parse(Object.fromEntries(url.searchParams)),result=await clientPhones((await getChatGPTUser())!.employee!,p);return Response.json({phones:result.phones.map(({key,label})=>({key,label}))},{headers:{'Cache-Control':'no-store'}});}catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось получить номера'},{status:400});}}
 const c=config();return Response.json({configured:!!process.env.CRM_PHONE_RESULT_KEY,phone:c.phone,callerId:c.callerId,testMode:false,lines:25,cps:5},{headers:{'Cache-Control':'no-store'}});
});
export const POST=authenticated(async(req:Request)=>{
 if(!await allowed())return Response.json({error:'Телефония недоступна для этой роли'},{status:403});
 try{
  const p=input.parse(await req.json()),c=config();
  const actor=(await getChatGPTUser())!.employee!;
  const account=phoneAccount(actor.id);
  if(['test','echo'].includes(p.mode)&&actor.role!=='admin')throw Error('Тестовые звонки доступны администратору');
  let destination=p.mode==='echo'?'echo':normalizeOutgoingNumber(c.phone),clientId='';
  if(p.mode==='client'||p.mode==='order'){
   const result=await clientPhones(actor,p);clientId=result.clientId;
   const selected=p.phoneKey?result.phones.find(n=>n.key===p.phoneKey):result.phones[0];
   if(!selected)throw Error('Выбранный номер недоступен. Обновите список номеров');
   destination=selected.number;
  }
  if(p.mode==='incoming')destination=await incomingCallTarget(db(),actor,p.incomingId);
  if(!destination)throw Error('У клиента не указан корректный российский номер телефона');
  await initPhone(db(),c.callerId);
  const call=await createPhoneCall(db(),{id:crypto.randomUUID().replaceAll('-',''),clientId:clientId||null,orderId:p.mode==='order'?p.orderId:null,actor,incomingId:p.mode==='incoming'?p.incomingId:undefined,echo:p.mode==='echo',destination,sipUser:account.username});
  return Response.json({callId:call.id,...account,destination:p.mode==='echo'?'echo':'call',label:p.mode==='echo'?'Проверка микрофона — эхо':'Звонок клиенту'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте параметры звонка':e instanceof Error?e.message:'Не удалось подготовить звонок'},{status:400});}
});

export const PATCH=authenticated(async req=>{
 if(!await allowed())return Response.json({error:'Недостаточно прав'},{status:403});
 try{
  const p=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),status:z.enum(['dialing','connected','cancelled','failed','unknown','busy','no_answer']),detail:z.string().max(500).prefault('')}).parse(await req.json());
  await initPhone(db());const e=(await getChatGPTUser())!.employee!,final=['cancelled','failed','unknown','busy','no_answer'].includes(p.status);
  await db().prepare("UPDATE phone_calls SET status=?,detail=?,ended_at=? WHERE id=? AND actor_id=? AND detail NOT LIKE 'Oktell / МТС%' AND provider_at IS NULL AND (ended_at IS NULL OR (?=1 AND status='unknown')) AND (status<>'connected' OR ?=1)").bind(p.status,p.detail,final?new Date().toISOString():null,p.id,e.id,final?1:0,final?1:0).run();
  return Response.json({ok:true});
 }catch{return Response.json({error:'Неверный результат звонка'},{status:400});}
});

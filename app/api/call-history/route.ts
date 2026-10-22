import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {addCallComment,displayPhoneCall,initPhone,phoneScope,type PhoneCall} from '@/lib/phone-store';
import {z} from 'zod';
export const dynamic='force-dynamic';
export const GET=authenticated(async req=>{
 const e=(await getChatGPTUser())?.employee,url=new URL(req.url),clientId=url.searchParams.get('clientId')||undefined,orderId=url.searchParams.get('orderId')||undefined;
 if(!e||!!clientId===!!orderId||!await phoneScope(db(),e,{clientId,orderId}))return Response.json({error:'История звонков недоступна'},{status:403});
 await initPhone(db());
 const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)return Response.json({error:'Неверная страница'},{status:400});
 const rows=(await db().prepare(`SELECT c.*,a.auto_kind,a.auto_reason,a.analyzed_at,a.manual_kind,a.manual_name,a.manual_at FROM phone_calls c LEFT JOIN phone_call_analysis a ON a.call_id=c.id WHERE ${orderId?'order_id':'client_id'}=? AND seq<? ORDER BY seq DESC LIMIT 51`).bind(orderId||clientId!,before).all()).results as (PhoneCall&{seq:number})[];
 const ids=rows.slice(0,50).map(c=>c.id);
 const comments=ids.length?(await db().prepare(`SELECT id,call_id,actor_name,text,at FROM phone_call_comments WHERE call_id IN (${ids.map(()=>'?').join(',')}) ORDER BY at,id`).bind(...ids).all()).results:[];
 const calls=rows.slice(0,50).map(c=>{const {claimed_at,provider_at,...safe}=displayPhoneCall(c);return {...safe,recording:!!c.recording,comments:comments.filter(n=>n.call_id===c.id)};});
 return Response.json({calls,next:rows.length>50?rows[49].seq:null},{headers:{'Cache-Control':'no-store'}});
});
export const PATCH=authenticated(async req=>{
 const p=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),kind:z.enum(['human','machine','screening','unknown'])}).safeParse(await req.json());
 if(!p.success)return Response.json({error:'Выберите результат распознавания'},{status:400});
 await initPhone(db());const e=(await getChatGPTUser())!.employee!,c=await db().prepare('SELECT * FROM phone_calls WHERE id=?').bind(p.data.id).first<PhoneCall>();
 if(!c||!((c.order_id&&await phoneScope(db(),e,{orderId:c.order_id}))||(c.client_id&&await phoneScope(db(),e,{clientId:c.client_id}))))return Response.json({error:'Звонок недоступен'},{status:403});
 if(c.status!=='completed')return Response.json({error:'Уточнение доступно после состоявшегося соединения'},{status:400});
 await db().prepare('INSERT INTO phone_call_analysis(call_id,manual_kind,manual_actor,manual_name,manual_at) VALUES(?,?,?,?,?) ON CONFLICT(call_id) DO UPDATE SET manual_kind=excluded.manual_kind,manual_actor=excluded.manual_actor,manual_name=excluded.manual_name,manual_at=excluded.manual_at').bind(c.id,p.data.kind,e.id,e.name,new Date().toISOString()).run();
 return Response.json({ok:true});
});

export const POST=authenticated(async req=>{
 const p=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),commentId:z.string().uuid(),text:z.string().trim().min(1).max(3000)}).safeParse(await req.json());
 if(!p.success)return Response.json({error:'Укажите комментарий до 3000 символов'},{status:400});
 await initPhone(db());
 try{await addCallComment(db(),(await getChatGPTUser())!.employee!,p.data.id,p.data.text,p.data.commentId);}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить комментарий'},{status:403});}
 const comment=await db().prepare('SELECT id,actor_name,text,at FROM phone_call_comments WHERE id=? AND call_id=?').bind(p.data.commentId,p.data.id).first();
 return Response.json({ok:true,comment});
});

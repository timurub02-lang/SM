import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {displayPhoneCall,initPhone,phoneScope,type PhoneCall} from '@/lib/phone-store';
export const dynamic='force-dynamic';
export const GET=authenticated(async req=>{
 const e=(await getChatGPTUser())?.employee,url=new URL(req.url),clientId=url.searchParams.get('clientId')||undefined,orderId=url.searchParams.get('orderId')||undefined;
 if(!e||!!clientId===!!orderId||!await phoneScope(db(),e,{clientId,orderId}))return Response.json({error:'История звонков недоступна'},{status:403});
 await initPhone(db());
 const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)return Response.json({error:'Неверная страница'},{status:400});
 const rows=(await db().prepare(`SELECT * FROM phone_calls WHERE ${orderId?'order_id':'client_id'}=? AND seq<? ORDER BY seq DESC LIMIT 51`).bind(orderId||clientId!,before).all()).results as (PhoneCall&{seq:number})[];
 const calls=rows.slice(0,50).map(c=>{const {claimed_at,provider_at,...safe}=displayPhoneCall(c);return {...safe,recording:!!c.recording};});
 return Response.json({calls,next:rows.length>50?rows[49].seq:null},{headers:{'Cache-Control':'no-store'}});
});

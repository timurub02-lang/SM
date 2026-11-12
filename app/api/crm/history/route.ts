import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initIncoming} from '@/lib/incoming';
import {readCrmHistory} from '@/lib/crm-history';
import {z} from 'zod';
export const dynamic='force-dynamic';
const schema=z.object({clientId:z.string().min(1).max(100).optional(),orderId:z.string().min(1).max(100).optional(),employeeId:z.string().min(1).max(100).optional(),page:z.coerce.number().int().min(0).max(100000).default(0),legacy:z.enum(['1']).optional()}).refine(q=>(!!q.clientId!==!!q.employeeId)&&(!q.orderId||!!q.clientId)).refine(q=>!q.legacy||!!q.clientId&&!q.orderId);
export const GET=authenticated(async request=>{
 const user=await getChatGPTUser();if(!user?.employee)return Response.json({error:'Требуется вход'},{status:401});
 const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return Response.json({error:'Некорректный запрос истории'},{status:400});
 try{const d=db();await initIncoming(d);return Response.json(await readCrmHistory(d,user.employee,{...parsed.data,legacy:parsed.data.legacy==='1'}));}
 catch(error){return Response.json({error:'История недоступна'},{status:403});}
});

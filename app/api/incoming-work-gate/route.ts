import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {readIncomingWorkGate} from '@/lib/incoming-work-gate';
export const dynamic='force-dynamic';
export const GET=authenticated(async()=>{
 const e=(await getChatGPTUser())?.employee;
 if(!e)return Response.json({error:'Требуется вход'},{status:401});
 return Response.json(await readIncomingWorkGate(db(),e),{headers:{'Cache-Control':'no-store'}});
});

import {db} from '@/lib/db';
import {receiveCRMCallsIncoming} from '@/lib/crmcalls-incoming';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 try{return await receiveCRMCallsIncoming(db(),req);}
 catch{return Response.json({error:'Import temporarily unavailable'},{status:503,headers:{'Retry-After':'60'}});}
}

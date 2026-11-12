import {db} from '@/lib/db';
import {receiveSkOrderEvent} from '@/lib/sk-order-events';
export const dynamic='force-dynamic';
// Provider authentication replaces browser-session auth only on this POST endpoint.
export async function POST(req:Request){
 try{return await receiveSkOrderEvent(db(),req);}
 catch{return Response.json({error:'Import temporarily unavailable'},{status:503,headers:{'Retry-After':'60'}});}
}

import {z} from 'zod';
import {authenticated} from '@/lib/api-auth';
import {sessionEmployee} from '@/lib/auth';
import {acquireOrderAccess,releaseOrderAccess} from '@/lib/order-access';

export const POST=authenticated(async(req:Request)=>{
 const employee=await sessionEmployee(req.headers);
 if(!employee)return Response.json({error:'Требуется вход'},{status:401});
 const p=z.object({orderId:z.string().min(1).max(100),token:z.string().uuid(),action:z.enum(['acquire','release'])}).parse(await req.json());
 if(p.action==='release'){
  await releaseOrderAccess(employee.id,p.token);
  return Response.json({released:true});
 }
 return Response.json(await acquireOrderAccess(p.orderId,employee,p.token));
});

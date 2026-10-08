import {z} from 'zod';
import {authenticated} from '@/lib/api-auth';
import {sessionEmployee} from '@/lib/auth';
import {acquireOrderAccess,releaseOrderAccess} from '@/lib/order-access';
import {db} from '@/lib/db';
import {usesOrderLease} from '@/lib/department-orders';

export const POST=authenticated(async(req:Request)=>{
 const employee=await sessionEmployee(req.headers);
 if(!employee)return Response.json({error:'Требуется вход'},{status:401});
 const p=z.object({orderId:z.string().min(1).max(100),token:z.string().uuid(),action:z.enum(['acquire','release'])}).parse(await req.json());
 if(p.action==='release'){
  await releaseOrderAccess(employee.id,p.token);
  return Response.json({released:true});
 }
 const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(p.orderId).first<{data:string}>();
 if(!row||!usesOrderLease(employee,JSON.parse(row.data)))return Response.json({error:'На этом этапе доступен только просмотр'},{status:403});
 return Response.json(await acquireOrderAccess(p.orderId,employee,p.token));
});

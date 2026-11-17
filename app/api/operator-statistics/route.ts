import {confirmationStats} from '@/lib/confirmation-stats';
import {shipmentStats} from '@/lib/shipment-stats';
import {authenticated} from '@/lib/api-auth';
import {assignedCountsQuery} from '@/lib/base-summary';
import {baseStats} from '@/lib/base-stats';
import {db} from '@/lib/db';
import {operatorStatsSummary} from '@/lib/operator-stats';
import type {Employee,Order,Event} from '@/lib/crm';
export const GET=authenticated(async req=>{
 const url=new URL(req.url),from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'';
 if([from,to].some(date=>date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))||from&&to&&from>to)return Response.json({error:'Проверьте период'},{status:400});
 const employees=(await db().prepare('SELECT data FROM employees').all<{data:string}>()).results.map(row=>JSON.parse(row.data) as Employee);
 const actor=employees.find(e=>e.id===url.searchParams.get('actorId'));
 if(!actor||!['admin','department_head'].includes(actor.role))return Response.json({error:'Недостаточно прав'},{status:403});
 if(url.searchParams.get('section')==='base'){
  if(actor.role!=='admin')return Response.json({error:'Недостаточно прав'},{status:403});
  const counts=(await db().prepare(assignedCountsQuery).all<{owner:string;total:number}>()).results;
  return Response.json({rows:baseStats(employees,counts)},{headers:{'Cache-Control':'no-store'}});
 }
 const orders=(await db().prepare('SELECT data FROM orders').all<{data:string}>()).results.map(row=>JSON.parse(row.data) as Order);
 if(url.searchParams.get('section')==='confirmation'){
  const events=(await db().prepare("SELECT data FROM events WHERE data LIKE '%→ Упаковка%' OR data LIKE '%Подтверждение → Проверка%' OR data LIKE '%Подтверждение → Доп. подтверждение%' OR data LIKE '%Подтверждено руководителем%'").all<{data:string}>()).results.map(row=>JSON.parse(row.data) as Event);
  return Response.json({rows:confirmationStats({employees,orders,events},url.searchParams.get('scope')==='own'?actor:{...actor,role:'admin'},from,to,url.searchParams.get('department')||'').map(({orders,...row})=>({...row,...(url.searchParams.get('scope')==='own'?{orderIds:orders.map(o=>o.id)}:{})}))},{headers:{'Cache-Control':'no-store'}});
 }
 if(url.searchParams.get('section')==='shipped')return Response.json({rows:shipmentStats({employees,orders},{...actor,role:'admin'},from,to,url.searchParams.get('department')||'',url.searchParams.get('groupBy')==='day').map(({orders,...row})=>row)},{headers:{'Cache-Control':'no-store'}});
 return Response.json({rows:operatorStatsSummary({employees,orders},actor,from,to,url.searchParams.get('groupBy')==='day',url.searchParams.get('department')||'')},{headers:{'Cache-Control':'no-store'}});
});

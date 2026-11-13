import {authenticated} from '@/lib/api-auth';
import {assignedCountsQuery} from '@/lib/base-summary';
import {baseStats} from '@/lib/base-stats';
import {db} from '@/lib/db';
import {operatorStatsSummary} from '@/lib/operator-stats';
import type {Employee,Order} from '@/lib/crm';
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
 return Response.json({rows:operatorStatsSummary({employees,orders},actor,from,to)},{headers:{'Cache-Control':'no-store'}});
});

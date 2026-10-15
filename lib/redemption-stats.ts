import type {ActivityDb as Db} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {dayPlus,validDate} from './redemption.ts';

export async function redemptionStats(d:Db,actor:Employee,day:string,archive=false){
 if(!['admin','redemption','department_head'].includes(actor.role)||!validDate(day))return [];
 const saved=archive?await d.prepare('SELECT at FROM redemption_archives WHERE day=?').bind(day).first():null;
 if(archive&&!saved)return [];
 const start=new Date(day+'T00:00:00+03:00').toISOString(),end=new Date(dayPlus(day,1)+'T00:00:00+03:00').toISOString();
 const staff=(await d.prepare('SELECT id,data FROM employees').all()).results.map((r:any)=>({id:r.id,...JSON.parse(r.data)}));
 const byId=new Map<string,any>(staff.map((e:any)=>[e.id,e]));
 const counts=new Map<string,{id:string;name:string;orders:Set<string>}>();
 const visible=(id:string)=>actor.role!=='department_head'||id===actor.id;
 for(const e of staff)if(e.role==='department_head'&&visible(e.id))counts.set(e.id,{id:e.id,name:e.name,orders:new Set()});
 const events=(await d.prepare("SELECT order_id,data FROM redemption_history WHERE at>=? AND at<? AND at<=? AND json_extract(data,'$.changeKind')='action' ORDER BY id").bind(start,end,saved?.at||end).all()).results;
 const acted=new Set<string>();
 for(const event of events){
  const v=JSON.parse(event.data),first=!acted.has(event.order_id);acted.add(event.order_id);
  const employee=byId.get(v.authorId),role=v.authorRole||employee?.role;
  if(role!=='department_head'||!visible(v.authorId)||v.action==='nd'&&!first)continue;
  const count=counts.get(v.authorId)||{id:v.authorId,name:v.author||employee?.name||'Руководитель',orders:new Set<string>()};
  count.orders.add(event.order_id);counts.set(v.authorId,count);
 }
 return [...counts.values()].map(v=>({id:v.id,name:v.name,count:v.orders.size})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ru'));
}

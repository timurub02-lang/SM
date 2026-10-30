import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import type {Employee} from '@/lib/crm';
import {timesheetStaff,timesheetDays,parseTimesheet,type TimesheetRow} from '@/lib/timesheet';
export const dynamic='force-dynamic';
async function handle(req:Request){
 try{
  const d=db(),q=new URL(req.url).searchParams,period=q.get('period')||'';
  timesheetDays(period);
  const employees=(await d.prepare('SELECT data FROM employees').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Employee);
  const actor=employees.find(e=>e.id===q.get('actorId'));
  if(!actor||!['admin','department_head'].includes(actor.role))return Response.json({error:'Табель недоступен'},{status:403});
  const prefix='timesheet:'+period+':',allowed=employees.filter(e=>timesheetStaff(actor,e));
  if(req.method==='POST'){
   const body=parseTimesheet(await req.json(),period);
   if(!allowed.some(e=>e.id===body.employeeId))return Response.json({error:'Сотрудник недоступен'},{status:403});
   const id=prefix+body.employeeId,old=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first<{data:string}>();
   if((old?(JSON.parse(old.data) as TimesheetRow).revision:'')!==body.revision)return Response.json({error:'Табель изменён другим пользователем. Обновите страницу перед исправлением.'},{status:409});
   const row:TimesheetRow={days:body.days,revision:crypto.randomUUID(),updatedAt:new Date().toISOString(),updatedBy:actor.id},data=JSON.stringify(row);
   const result=old?await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=?').bind(data,id,old.data).run():await d.prepare('INSERT OR IGNORE INTO settings(id,data) VALUES(?,?)').bind(id,data).run();
   if(!result.meta.changes)return Response.json({error:'Табель уже изменён. Обновите страницу.'},{status:409});
   return Response.json({row});
  }
  const rows=(await d.prepare('SELECT id,data FROM settings WHERE id LIKE ?').bind(prefix+'%').all<{id:string;data:string}>()).results;
  const ids=new Set(allowed.map(e=>e.id));
  return Response.json({rows:Object.fromEntries(rows.filter(r=>ids.has(r.id.slice(prefix.length))).map(r=>[r.id.slice(prefix.length),JSON.parse(r.data)])),employees:allowed.map(e=>({id:e.id,name:e.name,login:e.login,department:e.department}))});
 }catch(e){return Response.json({error:e instanceof Error&&e.message==='Дата вне выбранного периода'?e.message:'Проверьте период и часы: от 0 до 24 или ОТ.'},{status:400});}
}
export const GET=authenticated(handle);
export const POST=authenticated(handle);

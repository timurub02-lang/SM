import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {type Employee} from '@/lib/crm';
import {premiumPeriods} from '@/lib/premium-periods';
import {premiumStaff,premiumAdjustmentSchema} from '@/lib/premium-calculation';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function handle(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const q=new URL(req.url).searchParams,d=db();
  const employees=(await d.prepare('SELECT data,version FROM employees').all<{data:string;version:number}>()).results.map(r=>({...JSON.parse(r.data),version:r.version}) as Employee);
  const actor=employees.find(e=>e.id===q.get('actorId'));
  if(!actor||!['admin','operator','department_head'].includes(actor.role))return Response.json({error:'Расчёт недоступен'},{status:403});
  const period=q.get('period')||'';
  if(!premiumPeriods.some(p=>p.id===period))throw Error('Выберите расчётный период');
  const prefix='premium-draft:'+period+':';
  if(req.method==='POST'){
   if(actor.role==='operator')return Response.json({error:'Недостаточно прав'},{status:403});
   const body=z.object({employeeId:z.string(),employeeVersion:z.number().int(),rate:z.number().finite().min(0).max(100).optional(),revision:z.string(),adjustment:premiumAdjustmentSchema}).parse(await req.json());
   const target=employees.find(e=>e.id===body.employeeId);
   if(!target||!premiumStaff(actor,target)||target.role==='department_head'&&!target.leaderPremium)return Response.json({error:'Сотрудник недоступен'},{status:403});
   if(target.version!==body.employeeVersion)return Response.json({error:'Карточка сотрудника изменилась. Обновите данные.'},{status:409});
   if(body.rate!==undefined&&target.role!=='operator')throw Error('Процент задаётся только оператору');
   const id=prefix+target.id,old=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first<{data:string}>();
   const previous=old?JSON.parse(old.data):null;
   if((previous?.revision||'')!==body.revision)return Response.json({error:'Расчёт уже изменён. Обновите данные.'},{status:409});
   if(actor.role!=='admin'&&body.adjustment.official!==(previous?.official||0))return Response.json({error:'Официальную часть изменяет администратор'},{status:403});
   const data=JSON.stringify({...body.adjustment,revision:crypto.randomUUID(),updatedAt:new Date().toISOString(),updatedBy:actor.id});
   const guard='EXISTS(SELECT 1 FROM employees WHERE id=? AND version=?)';
   const save=old?d.prepare('UPDATE settings SET data=? WHERE id=? AND data=? AND '+guard).bind(data,id,old.data,target.id,body.employeeVersion):d.prepare('INSERT OR IGNORE INTO settings(id,data) SELECT ?,? WHERE '+guard).bind(id,data,target.id,body.employeeVersion);
   const statements=[save];
   if(body.rate!==undefined&&body.rate!==target.bonus)statements.push(d.prepare("UPDATE employees SET data=json_set(data,'$.bonus',?),version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)").bind(body.rate,target.id,body.employeeVersion,id,data));
   const results=await d.batch(statements);
   if(!results[0].meta.changes)return Response.json({error:'Расчёт уже изменён. Обновите данные.'},{status:409});
  }
  const allowed=new Set(employees.filter(e=>premiumStaff(actor,e)).map(e=>e.id));
  const rows=(await d.prepare('SELECT id,data FROM settings WHERE id LIKE ?').bind(prefix+'%').all<{id:string;data:string}>()).results;
  const adjustments=Object.fromEntries(rows.filter(r=>allowed.has(r.id.slice(prefix.length))).map(r=>[r.id.slice(prefix.length),JSON.parse(r.data)]));
  return Response.json({adjustments},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте суммы расчёта':e instanceof Error?e.message:'Ошибка расчёта'},{status:400});}
}
export const GET=authenticated(handle);
export const POST=authenticated(handle);

import {db} from '@/lib/db';
import {personalAuth,sessionOwner,trustedOrigin} from '@/lib/auth';
import {readLimitedText} from '@/lib/request-body';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!personalAuth()||!trustedOrigin(req.headers))return Response.json({error:'Запрос отклонён'},{status:403});
 const owner=await sessionOwner(req.headers);if(!owner)return Response.json({error:'Требуется вход'},{status:401});
 try{
  const body=JSON.parse(await readLimitedText(req,2048));
  const current=await db().prepare('SELECT id,target_id FROM auth_impersonations WHERE session_hash=?').bind(owner.hash).first<{id:string;target_id:string}>();
  if(body.action==='stop'){
   if(current)await db().batch([
    db().prepare("INSERT INTO auth_impersonation_audit(id,impersonation_id,admin_id,target_id,at,kind) VALUES(?,?,?,?,?,'stop')").bind(crypto.randomUUID(),current.id,owner.employee.id,current.target_id,Date.now()),
    db().prepare('DELETE FROM auth_impersonations WHERE session_hash=? AND id=?').bind(owner.hash,current.id),
   ]);
   return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }
  if(owner.employee.role!=='admin'||owner.employee.testOnly||current)return Response.json({error:'Вход под сотрудником доступен только из своего кабинета администратора'},{status:403});
  if(body.action!=='start'||typeof body.employeeId!=='string'||!body.employeeId||body.employeeId.length>100||body.employeeId===owner.employee.id)return Response.json({error:'Выберите другого сотрудника'},{status:400});
  // Only the administrator's own call can delay switching; never touch the target's sessions or phone.
  const phoneTable=await db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='phone_calls'").first();
  if(phoneTable&&await db().prepare("SELECT id FROM phone_calls WHERE actor_id=? AND ended_at IS NULL AND status IN ('preparing','dialing','connected') LIMIT 1").bind(owner.employee.id).first())return Response.json({error:'Сначала завершите свой текущий звонок'},{status:409});
  const id=crypto.randomUUID(),now=Date.now();
  const result=await db().batch([
   db().prepare('DELETE FROM auth_impersonations WHERE expires_at<=?').bind(now),
   db().prepare("INSERT INTO auth_impersonations(session_hash,id,target_id,started_at,expires_at) SELECT s.token_hash,?,t.id,?,s.expires_at FROM auth_sessions s JOIN employees a ON a.id=s.employee_id JOIN auth_accounts aa ON aa.employee_id=a.id JOIN employees t ON t.id=? JOIN auth_accounts ta ON ta.employee_id=t.id LEFT JOIN auth_test_accounts test ON test.employee_id=t.id WHERE s.token_hash=? AND s.expires_at>? AND aa.enabled=1 AND json_extract(a.data,'$.role')='admin' AND ta.enabled=1 AND test.employee_id IS NULL AND NOT EXISTS(SELECT 1 FROM auth_impersonations WHERE session_hash=s.token_hash)").bind(id,now,body.employeeId,owner.hash,now),
   db().prepare("INSERT INTO auth_impersonation_audit(id,impersonation_id,admin_id,target_id,at,kind) SELECT ?,id,?,target_id,?,'start' FROM auth_impersonations WHERE id=?").bind(crypto.randomUUID(),owner.employee.id,now,id),
  ]);
  if(!result[1].meta.changes)return Response.json({error:'Вход сотруднику недоступен или сеанс уже переключён. Обновите страницу.'},{status:409});
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Не удалось переключить кабинет. Повторите попытку.'},{status:400});}
}

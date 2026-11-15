import {db} from '@/lib/db';
import {cookieToken,sessionCookie,trustedOrigin,ensureAuth} from '@/lib/auth';
import {tokenHash} from '@/lib/auth-crypto';
export async function POST(req:Request){
 if(!trustedOrigin(req.headers))return Response.json({error:'Запрос отклонён'},{status:403});
 const token=cookieToken(req.headers);
 if(token){await ensureAuth();const hash=tokenHash(token);await db().batch([
  db().prepare("INSERT INTO auth_impersonation_audit(id,impersonation_id,admin_id,target_id,at,kind) SELECT ?,i.id,s.employee_id,i.target_id,?,'logout' FROM auth_impersonations i JOIN auth_sessions s ON s.token_hash=i.session_hash WHERE i.session_hash=?").bind(crypto.randomUUID(),Date.now(),hash),
  db().prepare('DELETE FROM auth_impersonations WHERE session_hash=?').bind(hash),
  db().prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(hash),
 ]);}
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':`${sessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}});
}

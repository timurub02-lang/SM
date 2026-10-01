import {db} from '@/lib/db';
import {cookieToken,sessionCookie,trustedOrigin} from '@/lib/auth';
import {tokenHash} from '@/lib/auth-crypto';
export async function POST(req:Request){
 if(!trustedOrigin(req.headers))return Response.json({error:'Запрос отклонён'},{status:403});
 const token=cookieToken(req.headers);
 if(token)await db().prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(tokenHash(token)).run();
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':`${sessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}});
}

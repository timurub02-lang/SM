import {login,personalAuth,sessionCookie,sessionLifetime,trustedOrigin} from '@/lib/auth';
export async function POST(req:Request){
 if(!personalAuth()||!trustedOrigin(req.headers))return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>2000)throw Error();
  const p=JSON.parse(raw);
  if(typeof p.login!=='string'||!p.login.trim()||p.login.length>100||typeof p.password!=='string'||p.password.length>128)throw Error();
  const result=await login(p.login.trim().toLowerCase(),p.password,req.headers.get('x-real-ip')||'unknown');
  if(result&&'limited' in result)return Response.json({error:'Слишком много попыток. Повторите через 15 минут.'},{status:429,headers:{'Retry-After':'900','Cache-Control':'no-store'}});
  if(!result)return Response.json({error:'Неверный логин или пароль либо вход отключён'},{status:401});
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':`${sessionCookie}=${result.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionLifetime}`}});
 }catch{return Response.json({error:'Не удалось войти. Проверьте логин и пароль.'},{status:400});}
}

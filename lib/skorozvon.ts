export type SkCredentials={login:string;apiKey:string;clientId:string;clientSecret:string};
export async function checkSkorozvon(c:SkCredentials,request:typeof fetch=fetch){
 try{
  const response=await request('https://api.skorozvon.ru/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',username:c.login,api_key:c.apiKey,client_id:c.clientId,client_secret:c.clientSecret}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error([400,401,403].includes(response.status)?'Скорозвон отклонил реквизиты подключения':response.status===429?'Скорозвон: превышен лимит запросов, повторите позже':'Скорозвон временно недоступен');
  const token=await response.json() as {access_token?:string};
  if(!token.access_token)throw Error('Скорозвон не выдал токен доступа');
  // Read one page to verify API access; no clients, calls or projects are changed.
  const check=await request('https://api.skorozvon.ru/api/v2/users?length=1',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!check.ok)throw Error('Скорозвон: авторизация прошла, но доступ к API пользователей не подтверждён');
  const data=await check.json() as {data?:unknown};
  if(!Array.isArray(data.data))throw Error('Скорозвон вернул неожиданный ответ API');
  return {checkedAt:new Date().toISOString()};
 }catch(e){
  if(e instanceof Error&&e.message.startsWith('Скорозвон'))throw e;
  throw Error(e instanceof Error&&e.name==='TimeoutError'?'Скорозвон не ответил вовремя':'Не удалось связаться со Скорозвоном. Повторите проверку позже');
 }
}

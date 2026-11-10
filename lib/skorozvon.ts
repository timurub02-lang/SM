export type SkCredentials={login:string;apiKey:string;clientId:string;clientSecret:string};
export async function skorozvonToken(c:SkCredentials,request:typeof fetch=fetch){
 try{
  const response=await request('https://api.skorozvon.ru/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',username:c.login,api_key:c.apiKey,client_id:c.clientId,client_secret:c.clientSecret}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error([400,401,403].includes(response.status)?'Скорозвон отклонил реквизиты подключения':response.status===429?'Скорозвон: превышен лимит запросов, повторите позже':'Скорозвон временно недоступен');
  const token=await response.json() as {access_token?:string};
  if(!token.access_token)throw Error('Скорозвон не выдал токен доступа');
  return token.access_token;
 }catch(e){if(e instanceof Error&&e.message.startsWith("Скорозвон"))throw e;throw Error("Не удалось связаться со Скорозвоном");}
}
export async function checkSkorozvon(c:SkCredentials,request:typeof fetch=fetch){
 try{
  const accessToken=await skorozvonToken(c,request);
  // Read one page to verify API access; no clients, calls or projects are changed.
  const check=await request('https://api.skorozvon.ru/api/v2/users?length=1',{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!check.ok)throw Error('Скорозвон: авторизация прошла, но доступ к API пользователей не подтверждён');
  const data=await check.json() as unknown;
  const users=Array.isArray(data)?data:data&&typeof data==='object'&&'data' in data?data.data:null;
  if(!Array.isArray(users))throw Error('Скорозвон вернул неожиданный ответ API');
  return {checkedAt:new Date().toISOString()};
 }catch(e){
  if(e instanceof Error&&e.message.startsWith('Скорозвон'))throw e;
  throw Error(e instanceof Error&&e.name==='TimeoutError'?'Скорозвон не ответил вовремя':'Не удалось связаться со Скорозвоном. Повторите проверку позже');
 }
}

export type SkProject={id:string;title:string};
export async function readSkorozvonProjects(c:SkCredentials,request:typeof fetch=fetch):Promise<SkProject[]>{
 const token=await skorozvonToken(c,request),projects=new Map<string,SkProject>();
 for(let page=1;page<=100;page++){
  let response:Response;
  try{response=await request(`https://api.skorozvon.ru/api/v2/call_projects?length=100&page=${page}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw Error('Скорозвон не ответил. Повторите обновление списка');}
  if(!response.ok)throw Error('Скорозвон не вернул проекты: '+response.status);
  const data=await response.json() as {data?:unknown;pagination?:{total_pages?:number}}|unknown[];
  const rows=Array.isArray(data)?data:data?.data;
  if(!Array.isArray(rows))throw Error('Скорозвон вернул неожиданный список проектов');
  let added=0;
  for(const row of rows){if(!row||!/^\d+$/.test(String(row.id))||typeof row.title!=='string')throw Error('Скорозвон вернул проект без ID или названия');const id=String(row.id);if(!projects.has(id))added++;projects.set(id,{id,title:row.title.trim()||`Проект ${id}`});}
  const totalPages=Array.isArray(data)?undefined:data.pagination?.total_pages;
  if(typeof totalPages==='number'?page>=totalPages:rows.length<100)return [...projects.values()].sort((a,b)=>a.title.localeCompare(b.title,'ru'));
  if(!added)throw Error('Скорозвон повторил страницу проектов. Список не обновлён');
 }
 throw Error('Не удалось получить полный список проектов Скорозвона');
}

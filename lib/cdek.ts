export async function cdekToken(clientId:string,clientSecret:string,request:typeof fetch=fetch){
 const response=await request('https://api.cdek.ru/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(response.status===401||response.status===400?'СДЭК отклонил ключ или пароль':'СДЭК временно недоступен');
 const data=await response.json() as {access_token?:string};
 if(!data.access_token)throw new Error('СДЭК не выдал токен доступа');
 return data.access_token;
}

export async function authorizeCdek(clientId:string,clientSecret:string,request:typeof fetch=fetch){await cdekToken(clientId,clientSecret,request);return true;}

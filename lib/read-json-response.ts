export async function readJsonResponse<T>(response:Response):Promise<T>{
 const fallback=response.status===401?'Требуется вход':response.status>=500?'CRM временно недоступна. Повторите загрузку.':'Сервер вернул некорректный ответ. Повторите загрузку.';
 let data:T&{error?:string};
 try{data=await response.json();}
 catch(error){if(!(error instanceof SyntaxError))throw error;throw Object.assign(Error(fallback),{status:response.status});}
 if(!response.ok)throw Object.assign(Error(typeof data?.error==='string'?data.error:fallback),{status:response.status});
 return data;
}

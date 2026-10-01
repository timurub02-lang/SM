import {suggestionParts,emptyAddressParts} from './address.ts';
export async function suggestAddress(token:string,query:string,request:typeof fetch=fetch){
 const response=await request('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',{
  method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Token ${token}`},
  body:JSON.stringify({query,count:5,locations:[{country_iso_code:'RU'}]}),signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)throw new Error(response.status===401||response.status===403?'ДаДата отклонила ключ или доступ к подсказкам. Проверьте ключ и тариф.':response.status===429?'Превышен лимит запросов ДаДата. Попробуйте позже.':'Сервис ДаДата временно недоступен.');
 const data=await response.json() as {suggestions?:{value:string;unrestricted_value?:string;data?:Record<string,string|null>}[]};
 if(!Array.isArray(data.suggestions))throw new Error('ДаДата вернула некорректный ответ.');
 return data.suggestions.filter(s=>typeof s.value==='string').map(s=>({value:s.unrestricted_value||s.value,parts:suggestionParts(s.data||{})}));
}

export async function cleanImportedAddress(raw:string,keys:{token?:string;secret?:string},request:typeof fetch=fetch){
 const fallback={address:raw,addressOriginal:raw,addressParts:{...emptyAddressParts},city:'',addressReview:!!raw,addressProcessed:true,addressProcessingError:false};
 if(!raw)return fallback;
 if(!keys.token||!keys.secret)return {...fallback,addressProcessingError:true};
 try{
  const response=await request('https://cleaner.dadata.ru/api/v1/clean/address',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Token ${keys.token}`,'X-Secret':keys.secret},body:JSON.stringify([raw]),signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {...fallback,addressProcessingError:true};
  const rows=await response.json() as (Record<string,string|null>&{qc:number;result:string})[];
  if(!Array.isArray(rows)||!rows[0])return {...fallback,addressProcessingError:true};
  const result=rows[0];if(result.qc!==0||!result.result)return fallback;
  const parts=suggestionParts(result);
  if(!parts.city&&result.region_type==='г')parts.city=result.region_with_type||'';
  return {...fallback,address:result.result,addressParts:parts,city:parts.city,addressReview:false};
 }catch{return {...fallback,addressProcessingError:true};}
}

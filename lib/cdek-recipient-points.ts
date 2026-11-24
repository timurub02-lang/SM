import {eligibleRecipientPoint,rankRecipientPoints} from './cdek-points.ts';
import type {AddressParts} from './address.ts';
export async function recipientPoints(query:URLSearchParams,address:Partial<AddressParts>,load:(path:string)=>Promise<any>){
 const postal=await load('deliverypoints?'+query);
 if(!Array.isArray(postal))throw Error('Не удалось загрузить ПВЗ СДЭК. Повторите попытку');
 let all=postal,cityCode:number|undefined,warning='';
 try{
  const cities=await load('location/cities?'+new URLSearchParams({country_codes:'RU',postal_code:address.postalCode||'',size:'1000'}));
  if(!Array.isArray(cities))throw Error();
  const normalize=(s:string)=>s.toLowerCase().replace(/ё/g,'е').replace(/^(г\.?|город|с\.?|село|п\.?|пос[её]лок|деревня|д\.?)\s+/,'').trim();
  const matches=cities.filter(c=>normalize(c.city||'')===normalize(address.city||''));
  const city=matches.length===1?matches[0]:cities.length===1?cities[0]:undefined;
  if(!city?.region_code)throw Error();
  cityCode=city.code;
  const regionalQuery=new URLSearchParams(query);regionalQuery.delete('postal_code');regionalQuery.set('region_code',String(city.region_code));
  const regional=await load('deliverypoints?'+regionalQuery);
  if(!Array.isArray(regional))throw Error();
  all=[...new Map([...postal,...regional].map(p=>[p.code,p])).values()];
 }catch{warning='Не удалось загрузить ПВЗ других населённых пунктов. Доступен поиск по индексу; попробуйте загрузить список повторно.';}
 const points=rankRecipientPoints(all.filter(eligibleRecipientPoint).map(p=>({code:p.code,address:p.location?.address_full||p.location?.address||p.code,postalCode:p.location?.postal_code,city:p.location?.city||'',sameLocality:cityCode===undefined?undefined:p.location?.city_code===cityCode,workTime:p.work_time||'',allowedCod:true})),address);
 return {points,warning};
}

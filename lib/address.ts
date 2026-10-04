import {z} from 'zod';
export const addressPartsSchema=z.object({postalCode:z.string().max(20),region:z.string().max(150),city:z.string().max(250),street:z.string().max(200),house:z.string().max(100),flat:z.string().max(100)});
export type AddressParts=z.infer<typeof addressPartsSchema>;
export const emptyAddressParts:AddressParts={postalCode:'',region:'',city:'',street:'',house:'',flat:''};
export const addressLabels:Record<keyof AddressParts,string>={postalCode:'Индекс',region:'Регион',city:'Город',street:'Улица',house:'Дом',flat:'Квартира'};
export type AddressSuggestion={value:string;parts:AddressParts};
export function suggestionParts(data:Record<string,string|null>):AddressParts{
 const typed=(type:string,value:string)=>data[value]?[data[type],data[value]].filter(Boolean).join(' '):'';
 return {postalCode:data.postal_code||'',region:data.region_with_type||'',city:[data.city_with_type,data.settlement_with_type].filter(Boolean).join(', '),street:data.street_with_type||'',house:[typed('house_type','house'),typed('block_type','block'),typed('building_type','building')].filter(Boolean).join(', '),flat:typed('flat_type','flat')};
}
export function formatAddress(p:AddressParts){return [p.postalCode,p.region,p.city,p.street,p.house,p.flat].filter(Boolean).join(', ');}

export type AddressWarning={field:keyof AddressParts|'address';message:string};
// These are reasons to review an address, not proof that it does not exist.
export function orderAddressWarnings(address:string,parts?:AddressParts):AddressWarning[]{
 if(!address.trim())return [{field:'address',message:'Адрес не заполнен. Уточните у клиента, куда доставить заказ.'}];
 if(!parts||!Object.values(parts).some(value=>value.trim()))return [{field:'address',message:'Адрес не разобран по полям. Выберите подсказку ДаДаты или заполните индекс, населённый пункт и дом вручную.'}];
 const warnings:AddressWarning[]=[];
 if(!/^\d{6}$/.test(parts.postalCode.trim()))warnings.push({field:'postalCode',message:parts.postalCode.trim()?'Проверьте индекс: для России нужны 6 цифр.':'Индекс не определён. Уточните населённый пункт и дом, выберите адрес из подсказок или введите известный вам индекс.'});
 if(!parts.city.trim()&&!/^\s*(г\.?\s|город\s)/i.test(parts.region))warnings.push({field:'city',message:'Не указан населённый пункт. Уточните город, посёлок или деревню.'});
 if(!parts.house.trim())warnings.push({field:'house',message:'Номер дома не определён. Уточните дом у клиента; корпус и строение указываются в этом же поле.'});
 else if(warnings.some(w=>w.field==='postalCode')&&!parts.flat.trim()&&/(?:^|[\s,])(?:к\.?|корп\.?|корпус)\s*\d/i.test(parts.house))warnings.push({field:'house',message:'«к» в поле «Дом» означает корпус. Если это номер квартиры, уберите его из дома и заполните поле «Квартира».'});
 return warnings;
}

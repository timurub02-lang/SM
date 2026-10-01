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

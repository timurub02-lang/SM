import regions from '../data/phone-timezones/regions.json' with {type:'json'};
import type {Client,Order} from './crm.ts';
const words=(s:string)=>s.toLowerCase().replace(/ё/g,'е').replace(/(^|[^а-я])обл\.?($|[^а-я])/g,'$1область$2').replace(/(^|[^а-я])респ\.?($|[^а-я])/g,'$1республика$2').replace(/(^|[^а-я])г\.?($|[^а-я])/g,'$1город$2').split(/[^а-я]+/).filter(Boolean);
const entries=Object.entries(regions).map(([name,zones])=>({tokens:words(name),zones}));
const formats=new Map<string,Intl.DateTimeFormat>();
function clock(zone:string,now:number){
 let format=formats.get(zone);if(!format){format=new Intl.DateTimeFormat('ru-RU',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formats.set(zone,format);}
 return format.format(now);
}
export function clientLocalTime(client:Pick<Client,'city'|'address'|'addressParts'>,now:number){
 const text=client.addressParts?.region?.trim()||[client.city,client.address].filter(Boolean).join(',');
 const segments=text.split(',').map(words);
 const zones=new Set(entries.filter(e=>segments.some(s=>e.tokens.every(t=>s.includes(t)))).flatMap(e=>e.zones));
 if(zones.size!==1)return 'Местное время не определено';
 const zone=[...zones][0],local=clock(zone,now),moscow=clock('Europe/Moscow',now);
 const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
 let difference=(minutes(local)-minutes(moscow))/60;if(difference< -1)difference+=24;if(difference>9)difference-=24;
 return `У клиента ${local} · МСК${difference===0?'':difference>0?' +'+difference:' '+difference}`;
}

export function orderTimeAddress(order:Pick<Order,'address'|'addressParts'>,client?:Pick<Client,'city'|'address'|'addressParts'>){
 return order.address?.trim()||order.addressParts?.region?.trim()?{city:'',address:order.address,addressParts:order.addressParts}:client;
}

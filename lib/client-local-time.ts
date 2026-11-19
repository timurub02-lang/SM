import regions from '../data/phone-timezones/regions.json' with {type:'json'};
import sakha from '../data/phone-timezones/sakha.json' with {type:'json'};
import cities from '../data/phone-timezones/cities.json' with {type:'json'};
import postcodes from '../data/phone-timezones/postcodes.json' with {type:'json'};
import type {Client,Order} from './crm.ts';
const words=(s:string)=>s.toLowerCase().replace(/ё/g,'е').replace(/(^|[^а-я])обл\.?($|[^а-я])/g,'$1область$2').replace(/(^|[^а-я])респ\.?($|[^а-я])/g,'$1республика$2').replace(/(^|[^а-я])г\.?($|[^а-я])/g,'$1город$2').split(/[^а-я]+/).filter(Boolean);
type Location = Partial<Pick<Client,'city'|'address'|'addressParts'|'addressOriginal'|'importFields'>>;
const regionKey=(s:string)=>words(s).sort().join(' ');
const byRegion=new Map<string,string[]>();
for(const [name,zones] of Object.entries(regions)){
 for(const alias of [name,...name.split(' - '),name.replace(/^(Город|Республика) /,'')])byRegion.set(regionKey(alias),zones);
}
for(const alias of ['Саха','Якутия','Республика Саха'])byRegion.set(regionKey(alias),regions['Республика Саха (Якутия)']);
for(const [alias,name] of Object.entries({
 'ХМАО':'Ханты-Мансийский автономный округ - Югра','ЯНАО':'Ямало-Ненецкий автономный округ',
 'Москва и Московская область':'Город Москва','Санкт-Петербург и Ленинградская область':'Город Санкт-Петербург'
})){
 byRegion.set(regionKey(alias),byRegion.get(regionKey(name))!);
}
const sakhaOffsets=new Map(Object.entries(sakha));
const byCity=new Map(Object.entries(cities));
function postalZone(code:string){
 const index=Number(code);
 let low=0,high=postcodes.ranges.length-1;
 while(low<=high){
  const mid=(low+high)>>>1,[first,last,zone]=postcodes.ranges[mid];
  if(index<first)high=mid-1;
  else if(index>last)low=mid+1;
  else return postcodes.zones[zone];
 }
}
export function locationZone(location?:Location){
 if(!location)return;
 const parts=location.addressParts;
 const imported=location.importFields;
 const fields=[parts?.city,location.city,location.address,location.addressOriginal,imported?.['Регион'],imported?.['Город'],imported?.['Город / адрес']];
 const segments=Array.from(new Set(fields.filter((s):s is string=>!!s))).flatMap(s=>s.split(/[,;\n]/).map(part=>part.trim().replace(/^\d{6}\s+/,'')));
 const findRegion=(s:string)=>byRegion.get(regionKey(s))||byRegion.get(regionKey(s.replace(/^г\.?\s+/i,'')));
 const region=byRegion.get(regionKey(parts?.region||''))||segments.map(findRegion).find(Boolean);
 if(region?.length===1)return region[0];
 const zip=parts?.postalCode?.trim()||fields.find(s=>s&&/^\s*\d{6}\b/.test(s))?.trim().slice(0,6);
 const postal=zip&&/^\d{6}$/.test(zip)?postalZone(zip):undefined;
 if(postal&&(!region||region.includes(postal)))return postal;
 for(const segment of segments){
  const locality=segment.split(/\s+(?=(?:ул(?:ица)?|пр-кт|пр-т|переулок|шоссе|проспект)(?:\.|\s))/i)[0];
  const name=words(locality.replace(/^(?:пос[её]лок|пос|пгт|п|село|с|деревня|д)\.?\s+/i,'')).filter(t=>t!=='город').join(' ');
  const offset=region?sakhaOffsets.get(name):byCity.get(name);
  if(offset!==undefined)return 'Etc/GMT-'+offset;
 }
 for(const segment of segments){
  const match=segment.match(/^(?:мск|по москве)\s*(?:([+-])\s*([0-9]))?$/i);
  if(match){
   const offset=3+(match[1]==='-'?-1:1)*Number(match[2]||0);
   if(offset>=2&&offset<=12)return 'Etc/GMT-'+offset;
  }
 }
}
const formats=new Map<string,Intl.DateTimeFormat>();
function clock(zone:string,now:number){
 let format=formats.get(zone);if(!format){format=new Intl.DateTimeFormat('ru-RU',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formats.set(zone,format);}
 return format.format(now);
}
export function clientLocalTime(client:Location,now:number,zone=locationZone(client)){
 if(!zone)return 'Местное время не определено';
 const local=clock(zone,now),moscow=clock('Europe/Moscow',now);
 const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
 let difference=(minutes(local)-minutes(moscow))/60;if(difference< -1)difference+=24;if(difference>9)difference-=24;
 return `У клиента ${local} · МСК${difference===0?'':difference>0?' +'+difference:' '+difference}`;
}

export function orderTimeAddress(order:Pick<Order,'address'|'addressParts'>,client?:Pick<Client,'city'|'address'|'addressParts'>){
 return order.address?.trim()||order.addressParts?.region?.trim()||order.addressParts?.city?.trim()||order.addressParts?.postalCode?.trim()?{city:'',address:order.address,addressParts:order.addressParts}:client;
}

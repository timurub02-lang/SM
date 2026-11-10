import type {ActivityDb as Db} from './activity-store.ts';
import type {Client} from './crm.ts';
export async function searchBaseClients(d:Db,input:string){
 const query=input.trim();
 if(query.length<3||query.length>100)throw Error('Введите от 3 до 100 символов');
 const text=query.toLowerCase().replace(/ё/g,'е');
 const params:string[]=[];
 let name="replace(replace(json_extract(c.data,'$.name'),'Ё','Е'),'ё','е')";
 for(const ch of new Set(text.match(/[а-я]/g)||[])){name=`replace(${name},?,?)`;params.push(ch.toUpperCase(),ch);}
 const conditions=[`instr(lower(${name}),?)>0`];params.push(text);
 if(/^[+\d\s()-]+$/.test(query)){
  const digits=query.replace(/\D/g,''),phone=digits.length===11&&digits.startsWith('8')?'7'+digits.slice(1):digits;
  if(phone.length>=3){conditions.push('c.id IN (SELECT client_id FROM client_phone_index WHERE instr(phone,?)>0)');params.push(phone);}
 }
 conditions.push("c.id IN (SELECT client_id FROM orders WHERE instr(lower(id),?)>0 OR instr(COALESCE(json_extract(data,'$.legacyLv.orderId'),''),?)>0)");params.push(text,text);
 const rows=await d.prepare(`SELECT c.data,c.version,json_extract(e.data,'$.name') AS ownerName FROM clients c LEFT JOIN employees e ON e.id=json_extract(c.data,'$.owner') WHERE ${conditions.map(v=>'('+v+')').join(' OR ')} ORDER BY json_extract(c.data,'$.name'),c.id LIMIT 31`).bind(...params).all();
 return {matches:rows.results.slice(0,30).map((r:{data:string;version:number;ownerName:string|null})=>({client:{...JSON.parse(r.data),version:r.version} as Client,ownerName:r.ownerName||'Не закреплён'})),more:rows.results.length>30};
}

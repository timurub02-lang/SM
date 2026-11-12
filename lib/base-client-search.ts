import type {ActivityDb as Db} from './activity-store.ts';
import type {Client,Employee} from './crm.ts';
import {hideClientNumbers} from './permissions.ts';
export async function searchBaseClients(d:Db,input:string,viewer?:Employee){
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
 conditions.push("EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(c.data,'$.legacyOrderHistory'),'[]')) h WHERE instr(lower('LV-'||json_extract(h.value,'$.externalId')),?)>0)");params.push(text);
 const rows=await d.prepare(`SELECT c.data,c.version,json_extract(e.data,'$.name') AS ownerName,json_extract(e.data,'$.role') AS ownerRole,json_extract(e.data,'$.department') AS ownerDepartment FROM clients c LEFT JOIN employees e ON e.id=json_extract(c.data,'$.owner') WHERE ${conditions.map(v=>'('+v+')').join(' OR ')} ORDER BY json_extract(c.data,'$.name'),c.id LIMIT 31`).bind(...params).all();
 return {matches:rows.results.slice(0,30).map((r:{data:string;version:number;ownerName:string|null;ownerRole:string|null;ownerDepartment:string|null})=>{
  const client:Client={...JSON.parse(r.data),version:r.version};
  const head=viewer?.role==='department_head';
  const canOpen=!head||!!client.owner&&!!viewer.department&&r.ownerRole==='operator'&&r.ownerDepartment===viewer.department;
  return {client:!head?client:canOpen?hideClientNumbers(client):{id:client.id,name:client.name,baseType:client.baseType,sheet:client.sheet,owner:client.owner,phone:'',city:'',address:'',source:'',assignedUntil:'',createdAt:'',version:client.version},ownerName:client.owner?(r.ownerName||'Оператор не указан'):'Не закреплён',canOpen};
 }),more:rows.results.length>30};
}

import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {incomingForAction} from '@/lib/incoming';
import {initBaseStorage} from '@/lib/base-storage';
export const dynamic='force-dynamic';
export const GET=authenticated(async req=>{
 try{
  const employee=(await getChatGPTUser())?.employee;
  if(!employee||!['admin','department_head'].includes(employee.role))return Response.json({error:'Поиск недоступен'},{status:403});
  const url=new URL(req.url),query=(url.searchParams.get('q')||'').trim().slice(0,100),id=url.searchParams.get('incomingId')||'';
  const request=await incomingForAction(db(),id,employee,[]);
  if(request.client_id)throw Error('Обращение уже связано с клиентом');
  if(query.length<3)throw Error('Введите не менее трёх символов');
  await initBaseStorage(db());
  const digits=query.replace(/\D/g,''),phoneSearch=/^[+\d\s()-]+$/.test(query);
  let where:string,params:string[]=[];
  if(phoneSearch){
   if(digits.length<3)throw Error('Введите не менее трёх цифр');
   const phone=digits.length===11&&digits.startsWith('8')?'7'+digits.slice(1):digits;
   where='c.id IN (SELECT client_id FROM client_phone_index WHERE instr(phone,?)>0)';params=[phone];
  }else{
   // SQLite lower() folds Latin only; fold the Cyrillic letters used by this query too.
   const text=query.toLowerCase().replace(/ё/g,'е');
   let name="replace(replace(json_extract(c.data,'$.name'),'Ё','Е'),'ё','е')";
   for(const ch of new Set(text.match(/[а-я]/g)||[])){name=`replace(${name},?,?)`;params.push(ch.toUpperCase(),ch);}
   where=`instr(lower(${name}),?)>0`;params.push(text);
  }
  const rows=await db().prepare(`SELECT c.id,json_extract(c.data,'$.name') AS name,c.phone,json_extract(c.data,'$.owner') AS ownerId,json_extract(e.data,'$.name') AS ownerName,json_extract(e.data,'$.department') AS department FROM clients c LEFT JOIN employees e ON e.id=json_extract(c.data,'$.owner') WHERE ${where} ORDER BY json_extract(c.data,'$.name'),c.id LIMIT 31`).bind(...params).all<{id:string;name:string;phone:string;ownerId:string;ownerName:string;department:string}>();
  return Response.json({matches:rows.results.slice(0,30).map(c=>({...c,phone:employee.role==='admin'?c.phone:'••• '+c.phone.slice(-4),ownerName:c.ownerName||(c.ownerId?'Ответственный не найден':'Не закреплён')})),more:rows.results.length>30});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось найти клиента'},{status:400});}
});

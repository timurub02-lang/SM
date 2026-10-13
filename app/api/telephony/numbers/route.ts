import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initPhone,normalizeOutgoingNumber,replacePhonePool} from '@/lib/phone-store';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function admin(){return (await getChatGPTUser())?.employee?.role==='admin';}
async function state(){
 await initPhone(db(),process.env.CRM_PHONE_CALLER_ID);
 const numbers=(await db().prepare('SELECT * FROM phone_numbers ORDER BY added_at,number').all()).results;
 const pool=await db().prepare('SELECT version FROM phone_pool WHERE id=1').first<{version:number}>();
 return {numbers,version:pool!.version};
}
export const GET=authenticated(async()=>!await admin()?Response.json({error:'Только для администратора'},{status:403}):Response.json(await state()));
export const POST=authenticated(async req=>{
 if(!await admin())return Response.json({error:'Только для администратора'},{status:403});
 try{
  await initPhone(db(),process.env.CRM_PHONE_CALLER_ID);const p=z.discriminatedUnion('action',[z.object({action:z.literal('import'),numbers:z.array(z.string().max(200)).min(1).max(10000)}),z.object({action:z.literal('replace'),count:z.number().int().min(1).max(10000),version:z.number().int().nonnegative()}),z.object({action:z.literal('markExported'),numbers:z.array(z.string().regex(/^7\d{10}$/)).max(10000)})]).parse(await req.json()),now=new Date().toISOString();
  if(p.action==='import'){
   const values=z.array(z.string().max(200)).min(1).max(10000).parse(p.numbers),seen=new Set<string>(),invalid:{row:number;value:string;reason:string}[]=[];let duplicates=0;
   values.forEach((value,i)=>{const phone=normalizeOutgoingNumber(value);if(!phone)invalid.push({row:i+1,value,reason:'Нужен российский номер из 11 цифр, начинающийся с 7 или 8'});else if(seen.has(phone))duplicates++;else seen.add(phone);});
   const existing=new Set((await db().prepare('SELECT number FROM phone_numbers').all()).results.map((x:any)=>x.number));
   const fresh=[...seen].filter(n=>!existing.has(n));duplicates+=seen.size-fresh.length;
   const results=await db().batch(fresh.map(n=>db().prepare("INSERT OR IGNORE INTO phone_numbers(number,state,added_at) VALUES(?,'available',?)").bind(n,now)));
   const added=results.reduce((sum:number,r:any)=>sum+(r.meta.changes||0),0);duplicates+=fresh.length-added;
   return Response.json({report:{added,duplicates,invalid},...await state()});
  }
  if(p.action==='replace')await replacePhonePool(db(),p.count,p.version);
  else if(p.action==='markExported'){
   const numbers=z.array(z.string().regex(/^7\d{10}$/)).max(10000).parse(p.numbers);
   await db().batch(numbers.map(n=>db().prepare("UPDATE phone_numbers SET exported_at=COALESCE(exported_at,?) WHERE number=? AND state='completed'").bind(now,n)));
  }else throw Error('Неизвестное действие');
  return Response.json(await state());
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте список номеров и количество':e instanceof Error?e.message:'Не удалось сохранить номера'},{status:400});}
});

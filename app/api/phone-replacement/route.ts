import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initPhone,normalizeOutgoingNumber} from '@/lib/phone-store';
import {replacementConfig,replacementSchema,replacementHealth,replacementDecision} from '@/lib/phone-replacement';
export const dynamic='force-dynamic';
async function state(){const d=db(),config=await replacementConfig(d);return {config,health:await replacementHealth(d),numbers:(await d.prepare('SELECT n.*,a.order_id,a.client_name,a.connected,o.data order_data FROM replacement_numbers n LEFT JOIN replacement_assignments a ON a.number=n.number AND a.released_at IS NULL LEFT JOIN orders o ON o.id=a.order_id ORDER BY n.uses,n.number').all()).results.map(({order_data,...n}:any)=>({...n,connected:order_data&&replacementDecision(config,JSON.parse(order_data))==='enable'?1:0})),history:(await d.prepare('SELECT * FROM replacement_assignments ORDER BY assigned_at DESC LIMIT 1000').all()).results};}
export const GET=authenticated(async()=> (await getChatGPTUser())?.employee?.role==='admin'?Response.json(await state()):Response.json({error:'Только для администратора'},{status:403}));
export const POST=authenticated(async req=>{
 if((await getChatGPTUser())?.employee?.role!=='admin')return Response.json({error:'Только для администратора'},{status:403});
 try{
 const d=db(),raw=await req.text();if(raw.length>250000)throw Error('Слишком большой запрос');const p=JSON.parse(raw),config=await replacementConfig(d);await initPhone(d);
 if(p.action==='save'){
 const next=replacementSchema.parse(p.config);if(next.enabled&&!next.release.crm.length&&!next.release.cdek.length)throw Error('Выберите статусы освобождения номера');
 const saved=await d.prepare("UPDATE settings SET data=? WHERE id='phone-replacement' AND json_extract(data,'$.revision')=?").bind(JSON.stringify({...next,revision:crypto.randomUUID()}),p.config.revision).run();if(!saved.meta.changes)throw Error('Настройки изменились. Обновите страницу');
 }else if(p.action==='import'){
 if(!Array.isArray(p.numbers)||!p.numbers.length||p.numbers.length>10000)throw Error('Введите от 1 до 10000 номеров');
 const numbers=[...new Set(p.numbers.map((n:unknown)=>typeof n==='string'?normalizeOutgoingNumber(n):null))];if(numbers.some(n=>!n))throw Error('Есть некорректный телефон');
 const outgoing=new Set((await d.prepare('SELECT number FROM phone_numbers').all()).results.map((n:any)=>n.number));if(numbers.some(n=>outgoing.has(n)))throw Error('Номер уже находится в «Билайн АТС». Пулы не должны пересекаться');
 await d.batch(numbers.map(n=>d.prepare('INSERT OR IGNORE INTO replacement_numbers(number,added_at) VALUES(?,?)').bind(n,new Date().toISOString())));
 }else throw Error('Неизвестное действие');
 return Response.json(await state());
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка сохранения'},{status:400});}
});

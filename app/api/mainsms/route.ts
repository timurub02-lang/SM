import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {smsConfig,smsText,mainSmsCall} from '@/lib/mainsms';
import {hideClientPhone,type Order,type Employee,type Client} from '@/lib/crm';
import {z} from 'zod';
async function read(id:string){const row=await db().prepare('SELECT data FROM settings WHERE id=?').bind(id).first<{data:string}>();return row?JSON.parse(row.data):null;}
async function actor(id:string){const row=await db().prepare('SELECT data FROM employees WHERE id=?').bind(id).first<{data:string}>();if(!row)throw Error('Сотрудник не найден');return JSON.parse(row.data) as Employee;}
async function handleGET(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{const e=await actor(new URL(req.url).searchParams.get('actorId')||'');const c=await read('mainsms');return Response.json({configured:!!c?.apiKey,templates:c?.templates||[],...(e.role==='admin'?{project:c?.project||'',sender:c?.sender||'',revision:c?.revision||''}:{})},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Нет доступа'},{status:403});}
}
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
 const raw=await req.text();if(raw.length>150000)throw Error('Слишком большой запрос');const p=JSON.parse(raw);const e=await actor(z.string().parse(p.actorId));const c=await read('mainsms');
 if(p.action==='save'){
 if(e.role!=='admin')throw Error('Настройки доступны администратору');const config=smsConfig.parse(p.config);config.apiKey=config.apiKey||c?.apiKey||'';if(!config.apiKey)throw Error('Введите API-ключ');for(const t of config.templates)smsText(t.text,'Клиент','Заказ');
 const data={...config,revision:crypto.randomUUID()};const revision=z.string().parse(p.revision);
 const result=await db().prepare("INSERT INTO settings(id,data) SELECT 'mainsms',? WHERE ?='' ON CONFLICT(id) DO NOTHING").bind(JSON.stringify(data),revision).run();
 if(!result.meta.changes){const update=await db().prepare("UPDATE settings SET data=? WHERE id='mainsms' AND json_extract(data,'$.revision')=?").bind(JSON.stringify(data),revision).run();if(!update.meta.changes)throw Error('Настройки изменены. Откройте окно заново');}
 return Response.json({revision:data.revision,message:'Сохранено'});
 }
 if(p.action==='check'){if(e.role!=='admin'||!c?.apiKey)throw Error('Сначала сохраните подключение');const result=await mainSmsCall(c,'balance');return Response.json({message:`Подключение работает. Баланс: ${result.balance??'—'} ₽`});}
 const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(z.string().parse(p.orderId)).first<{data:string}>();if(!row)throw Error('Заказ не найден');const o=JSON.parse(row.data) as Order;
 const manager=o.manager?await actor(o.manager):null;
 if(!(e.role==='admin'||e.role==='logistic'||e.role==='redemption'||e.role==='operator'&&o.manager===e.id||e.role==='department_head'&&e.department&&e.department===manager?.department))throw Error('Нет доступа к заказу');
 if(p.action==='preview'){
 if(!c?.apiKey)throw Error('Подключите MainSMS в настройках');if(o.testOnly)throw Error('Отправка SMS тестовым клиентам отключена');
 const cr=await db().prepare('SELECT data FROM clients WHERE id=?').bind(o.clientId).first<{data:string}>();if(!cr)throw Error('Клиент не найден');const client=JSON.parse(cr.data) as Client;
 if(!/^\+\d{10,15}$/.test(client.phone))throw Error('Проверьте телефон клиента');const template=c.templates.find((t:any)=>t.id===p.templateId);if(!template)throw Error('Шаблон не найден');
 const text=smsText(template.text,client.name,o.id),token=crypto.randomUUID();const ticket={actorId:e.id,orderId:o.id,clientId:o.clientId,phone:client.phone,text,sender:c.sender,revision:c.revision,at:Date.now(),state:'preview'};
 await db().prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('sms-'+token,JSON.stringify(ticket)).run();return Response.json({token,text,recipient:hideClientPhone(e.role)?client.name:client.name+' · '+client.phone,sender:c.sender||'Отправитель по умолчанию'});
 }
 if(p.action!=='send')throw Error('Неизвестное действие');const key='sms-'+z.string().uuid().parse(p.token);const ticket=await read(key);
 if(!ticket||ticket.actorId!==e.id||ticket.orderId!==o.id||Date.now()-ticket.at>600000)throw Error('Откройте предпросмотр заново');
 if(ticket.state!=='preview')throw Error('Этот запрос уже обработан. Проверьте историю заказа перед повторной отправкой');
 if(!c||ticket.revision!==c.revision||o.testOnly)throw Error('Настройки изменены. Откройте предпросмотр заново');
 const claimed=await db().prepare("UPDATE settings SET data=json_set(data,'$.state','sending') WHERE id=? AND json_extract(data,'$.state')='preview'").bind(key).run();if(!claimed.meta.changes)throw Error('Отправка уже началась');
 let message='Результат SMS неизвестен. Проверьте кабинет MainSMS перед повторной отправкой.',success=false;
 try{const result=await mainSmsCall(c,'send',{recipients:ticket.phone,message:ticket.text,...(ticket.sender?{sender:ticket.sender}:{})});success=true;message='SMS принято MainSMS к отправке';await db().prepare("UPDATE settings SET data=json_set(data,'$.state','accepted','$.messageIds',json(?)) WHERE id=?").bind(JSON.stringify(result.messages_id||[]),key).run();}catch{await db().prepare("UPDATE settings SET data=json_set(data,'$.state','unknown') WHERE id=?").bind(key).run();}
 const at=new Date().toISOString(),event={id:crypto.randomUUID(),orderId:o.id,clientId:o.clientId,at,actor:e.login,actorId:e.id,text:message+' · '+ticket.text};await db().prepare('INSERT INTO events(id,client_id,order_id,at,data) VALUES(?,?,?,?,?)').bind(event.id,o.clientId,o.id,at,JSON.stringify(event)).run();return Response.json({message},{status:success?200:409});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте заполнение полей':e instanceof Error?e.message:'Ошибка SMS'},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

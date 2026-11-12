import {smsDelivery} from '@/lib/sms-delivery';
import {readLimitedText} from '@/lib/request-body';
import {isLogistic} from '@/lib/crm';
import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {smsConfig,smsText,mainSmsCall,MainSmsRejection} from '@/lib/mainsms';
import {hideClientPhone,type Order,type Employee,type Client} from '@/lib/crm';
import {z} from 'zod';
async function read(id:string){const row=await db().prepare('SELECT data FROM settings WHERE id=?').bind(id).first<{data:string}>();return row?JSON.parse(row.data):null;}
async function actor(id:string){const row=await db().prepare('SELECT data FROM employees WHERE id=?').bind(id).first<{data:string}>();if(!row)throw Error('Сотрудник не найден');return JSON.parse(row.data) as Employee;}
async function orderForSms(e:Employee,id:string){
 const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(id).first<{data:string}>();if(!row)throw Error('Заказ не найден');
 const o=JSON.parse(row.data) as Order,manager=o.manager?await actor(o.manager):null;
 if(!(e.role==='admin'||isLogistic(e.role)||e.role==='redemption'||e.role==='operator'&&o.manager===e.id||e.role==='department_head'&&e.department&&e.department===manager?.department))throw Error('Нет доступа к заказу');
 return o;
}
async function handleGET(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
 const url=new URL(req.url),e=await actor(url.searchParams.get('actorId')||''),c=await read('mainsms');
 const orderId=url.searchParams.get('orderId');
 let history:unknown[]=[],deliveryWarning='';
 if(orderId){
  await orderForSms(e,orderId);
  const rows=await db().prepare(`SELECT s.id,s.data,e.data employee_data FROM settings s
   LEFT JOIN employees e ON e.id=json_extract(s.data,'$.actorId')
   WHERE s.id LIKE 'sms-%' AND json_extract(s.data,'$.orderId')=?
   AND json_extract(s.data,'$.state') IN ('sending','accepted','unknown','rejected')
   ORDER BY COALESCE(json_extract(s.data,'$.sentAt'),json_extract(s.data,'$.at')) DESC,s.id DESC`).bind(orderId).all<{id:string;data:string;employee_data:string|null}>();
  const tickets=rows.results.map(row=>({...row,ticket:JSON.parse(row.data)}));
  const ids=[...new Set(tickets.filter(({ticket:t})=>t.state==='accepted'&&!(t.messageIds?.length&&t.messageIds.every((id:number)=>['delivered','non-delivered','overdue','canceled'].includes(t.delivery?.statuses?.[id])))&&(!t.project||t.project===c?.project)&&(!t.delivery?.checkedAt||Date.now()-t.delivery.checkedAt>30000))
   .sort((a,b)=>(a.ticket.delivery?.checkedAt||0)-(b.ticket.delivery?.checkedAt||0)).flatMap(({ticket:t})=>(t.messageIds||[]).filter((id:unknown)=>Number.isSafeInteger(id)&&Number(id)>0)))] as number[];
  // shortcut: refresh at most 100 provider IDs per view; normal order histories are much smaller.
  if(ids.length&&c?.apiKey){
   try{
    const result=await mainSmsCall(c,'status',{messages_id:ids.slice(0,100).join(',')});
    for(const {id,ticket:t} of tickets){
     const statuses={...(t.delivery?.statuses||{})};let changed=false;
     for(const mid of t.messageIds||[])if(ids.slice(0,100).includes(mid)&&result.messages?.[mid]){statuses[mid]=result.messages[mid];changed=true;}
     if(changed){t.delivery={statuses,checkedAt:Date.now()};await db().prepare("UPDATE settings SET data=json_set(data,'$.delivery',json(?)) WHERE id=? AND json_extract(data,'$.state')='accepted'").bind(JSON.stringify(t.delivery),id).run();}
    }
   }catch{deliveryWarning='Не удалось обновить статусы MainSMS. Показаны последние известные данные; повторная SMS не отправлялась.';}
  }
  history=tickets.map(row=>{
   const ticket=row.ticket,employee=row.employee_data?JSON.parse(row.employee_data):null;
   return {id:row.id,text:ticket.text,sender:ticket.sender||'По умолчанию',at:ticket.sentAt||ticket.at,state:ticket.state,actor:employee?.name||employee?.login||'Сотрудник',reason:ticket.deliveryReason||null,...(ticket.state==='accepted'?{delivery:smsDelivery(ticket.messageIds||[],ticket.delivery?.statuses),deliveryCheckedAt:ticket.delivery?.checkedAt,messageIds:(ticket.messageIds||[]).filter((id:unknown)=>Number.isSafeInteger(id)&&Number(id)>0)}:{})};
  });
 }
 return Response.json({configured:!!c?.apiKey,templates:c?.templates||[],history,deliveryWarning,...(e.role==='admin'?{project:c?.project||'',sender:c?.sender||'',revision:c?.revision||''}:{})},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Нет доступа'},{status:403});}
}
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
 const raw=await readLimitedText(req,600000);if(raw.length>150000)throw Error('Слишком большой запрос');const p=JSON.parse(raw);const e=await actor(z.string().parse(p.actorId));const c=await read('mainsms');
 if(p.action==='save'){
 if(e.role!=='admin')throw Error('Настройки доступны администратору');const config=smsConfig.parse(p.config);config.apiKey=config.apiKey||c?.apiKey||'';if(!config.apiKey)throw Error('Введите API-ключ');for(const t of config.templates)smsText(t.text,'Клиент','Заказ');
 const data={...config,revision:crypto.randomUUID()};const revision=z.string().parse(p.revision);
 const result=await db().prepare("INSERT INTO settings(id,data) SELECT 'mainsms',? WHERE ?='' ON CONFLICT(id) DO NOTHING").bind(JSON.stringify(data),revision).run();
 if(!result.meta.changes){const update=await db().prepare("UPDATE settings SET data=? WHERE id='mainsms' AND json_extract(data,'$.revision')=?").bind(JSON.stringify(data),revision).run();if(!update.meta.changes)throw Error('Настройки изменены. Откройте окно заново');}
 return Response.json({revision:data.revision,message:'Сохранено'});
 }
 if(p.action==='check'){if(e.role!=='admin'||!c?.apiKey)throw Error('Сначала сохраните подключение');const result=await mainSmsCall(c,'balance');return Response.json({message:`Подключение работает. Баланс: ${result.balance??'—'} ₽`});}
 const o=await orderForSms(e,z.string().parse(p.orderId));
 if(p.action==='preview'){
 if(!c?.apiKey)throw Error('Подключите MainSMS в настройках');if(o.testOnly)throw Error('Отправка SMS тестовым клиентам отключена');
 const cr=await db().prepare('SELECT data FROM clients WHERE id=?').bind(o.clientId).first<{data:string}>();if(!cr)throw Error('Клиент не найден');const client=JSON.parse(cr.data) as Client;
 if(!/^\+\d{10,15}$/.test(client.phone))throw Error('Проверьте телефон клиента');
 let text:string;
 if(p.templateId){const template=c.templates.find((t:any)=>t.id===p.templateId);if(!template)throw Error('Шаблон не найден');text=smsText(template.text,client.name,o.id);}
 else text=z.string().trim().min(1).max(1000).parse(p.text);
 const token=crypto.randomUUID();const ticket={actorId:e.id,orderId:o.id,clientId:o.clientId,phone:client.phone,text,sender:c.sender,project:c.project,revision:c.revision,at:Date.now(),state:'preview'};
 await db().prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('sms-'+token,JSON.stringify(ticket)).run();return Response.json({token,text,recipient:hideClientPhone(e.role)?client.name:client.name+' · '+client.phone,sender:c.sender||'Отправитель по умолчанию'});
 }
 if(p.action!=='send')throw Error('Неизвестное действие');const key='sms-'+z.string().uuid().parse(p.token);const ticket=await read(key);
 if(!ticket||ticket.actorId!==e.id||ticket.orderId!==o.id||Date.now()-ticket.at>600000)throw Error('Откройте предпросмотр заново');
 if(ticket.state!=='preview')throw Error('Этот запрос уже обработан. Проверьте историю заказа перед повторной отправкой');
 if(!c||ticket.revision!==c.revision||o.testOnly)throw Error('Настройки изменены. Откройте предпросмотр заново');
 const claimed=await db().prepare("UPDATE settings SET data=json_set(data,'$.state','sending','$.sentAt',?) WHERE id=? AND json_extract(data,'$.state')='preview'").bind(Date.now(),key).run();if(!claimed.meta.changes)throw Error('Отправка уже началась');
 let message='Результат SMS неизвестен. Проверьте кабинет MainSMS перед повторной отправкой.',success=false;
 try{const result=await mainSmsCall(c,'send',{recipients:ticket.phone,message:ticket.text,...(ticket.sender?{sender:ticket.sender}:{})});success=true;message='SMS принято MainSMS к отправке';await db().prepare("UPDATE settings SET data=json_set(data,'$.state','accepted','$.messageIds',json(?)) WHERE id=?").bind(JSON.stringify(result.messages_id||[]),key).run();}catch(error){const rejected=error instanceof MainSmsRejection;if(rejected)message=error.message;await db().prepare("UPDATE settings SET data=json_set(data,'$.state',?,'$.deliveryReason',?) WHERE id=?").bind(rejected?'rejected':'unknown',rejected?message:null,key).run();}
 const at=new Date().toISOString(),event={id:crypto.randomUUID(),orderId:o.id,clientId:o.clientId,at,actor:e.login,actorId:e.id,text:message+' · '+ticket.text};await db().prepare('INSERT INTO events(id,client_id,order_id,at,data) VALUES(?,?,?,?,?)').bind(event.id,o.clientId,o.id,at,JSON.stringify(event)).run();return Response.json({message},{status:success?200:409});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте заполнение полей':e instanceof Error?e.message:'Ошибка SMS'},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

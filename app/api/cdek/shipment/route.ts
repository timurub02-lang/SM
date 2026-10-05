import {applyCdekDeletion} from '@/lib/cdek-deletion';
import {orderRouting,assertRoutingSlot,routingReservationGuard} from '@/lib/cdek-routing-store';
import {authenticated} from '@/lib/api-auth';
import {initInventory} from '@/lib/inventory';
import {cdekStatusPatch} from '@/lib/cdek-sync';
import {statuses} from '@/lib/crm';
import {rankRecipientPoints} from '@/lib/cdek-points';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {cdekToken} from '@/lib/cdek';
import {shipmentFormSchema,shipmentPayload,shipmentResult,cdekErrors,deletionRequestKey,type Shipment} from '@/lib/cdek-shipment';
import type {Order,Client} from '@/lib/crm';
import type {Product} from '@/lib/warehouse';
import {z} from 'zod';
const uuidSchema=z.string().uuid();
async function context(actorId:string,orderId:string){
 await initInventory();
 const actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(actorId).first<{data:string}>();
 if(!actor||!['logistic','chief_logistic','admin'].includes(JSON.parse(actor.data).role))throw Error('Отправления доступны только логисту');
 const row=await db().prepare('SELECT data,version FROM orders WHERE id=?').bind(orderId).first<{data:string;version:number}>();
 if(!row)throw Error('Заказ не найден');
 const order={...JSON.parse(row.data),version:row.version} as Order;
 if(order.testOnly)throw Error("Тестовый заказ: реальные операции СДЭК отключены");
 const record=await db().prepare('SELECT data FROM settings WHERE id=?').bind(`cdek-shipment-${orderId}`).first<{data:string}>();
 const shipment=record?JSON.parse(record.data) as Shipment:null;
 return {order,shipment,record,key:`cdek-shipment-${orderId}`,actor:JSON.parse(actor.data)};
}
async function apiFor(slot:number){
 const config=await db().prepare('SELECT data FROM settings WHERE id=?').bind(`cdek-${slot}`).first<{data:string}>();
 if(!config)throw Error('Аккаунт СДЭК не подключён');const keys=JSON.parse(config.data);
 const token=await cdekToken(keys.clientId,keys.clientSecret);
 return async(path:string,body?:unknown,method=body?'POST':'GET')=>fetch(`https://api.cdek.ru/v2${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
}
async function json(response:Response){const data=await response.json();if(!response.ok)throw Error(cdekErrors(data)||`СДЭК: ошибка ${response.status}`);return data as any;}
const reply=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
async function handleGET(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const q=new URL(req.url).searchParams;const c=await context(q.get('actorId')||'',q.get('orderId')||'');
  if(q.get('points')){
   const t=c.order.cdekTariff;if(!t)throw Error('Сначала выберите тариф');
   const side=q.get('points');const postal=side==='sender'?t.params.originPostalCode:c.order.addressParts?.postalCode;
   if(!postal)throw Error('Нет индекса для поиска ПВЗ');
   const query=new URLSearchParams({type:'PVZ',country_code:'RU',postal_code:postal,[side==='sender'?'is_reception':'is_handout']:'true',weight_max:String(Math.ceil(t.params.weight)),length:String(t.params.length),width:String(t.params.width),height:String(t.params.height)});
   const api=await apiFor(t.slot);const data=await json(await api(`/deliverypoints?${query}`));
   if(!Array.isArray(data))throw Error('СДЭК не вернул список ПВЗ');
   const points=data.filter(x=>x.status==='ACTIVE').map(x=>({code:x.code,address:x.location?.address_full||x.location?.address||x.code,postalCode:x.location?.postal_code,workTime:x.work_time,allowedCod:x.allowed_cod!==false}));
   return reply({points:side==='recipient'?rankRecipientPoints(points,c.order.addressParts):points});
  }
  const products=await db().prepare('SELECT data FROM products').all<{data:string}>();
  const warehouse=await db().prepare("SELECT data FROM settings WHERE id='warehouse-address'").first<{data:string}>();
  return reply({shipment:c.shipment,canDelete:['admin','chief_logistic'].includes(c.actor.role),warehouseAddress:warehouse?JSON.parse(warehouse.data).address:'',warehouseShipmentPoint:warehouse?JSON.parse(warehouse.data).shipmentPoint:null,items:c.order.items.map(i=>{const p=products.results.map(x=>JSON.parse(x.data) as Product).find(x=>x.name.trim().toLowerCase()===i.name.trim().toLowerCase());return {...i,sku:p?.sku,weight:p?.weight,cost:p?.cost,payment:p?.payment};})});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка СДЭК'},{status:400});}
}
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await req.text();if(raw.length>6000)throw Error('Слишком большой запрос');
  const p=z.object({actorId:z.string().min(1),orderId:z.string().min(1),action:z.enum(['create','refresh','print','delete']),version:z.number().int().optional(),form:shipmentFormSchema.optional(),recoveryUuid:uuidSchema.optional(),reason:z.string().trim().max(1000).optional(),confirmed:z.boolean().optional()}).parse(JSON.parse(raw));
  const c=await context(p.actorId,p.orderId);const d=db();
  const save=async(next:Shipment,previous:string)=>{
   const result=await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=?').bind(JSON.stringify(next),c.key,previous).run();
   if(!result.meta.changes)throw Error('Отправление изменилось. Обновите карточку');
  };
  if(p.action==='delete'){
   if(!['admin','chief_logistic'].includes(c.actor.role))return Response.json({error:'Удалить отправление может только администратор или главный логист'},{status:403});
   if(p.confirmed!==true||!p.reason)throw Error('Укажите причину и подтвердите удаление отправления из СДЭК');
   if(c.order.version!==p.version)throw Error('Заказ изменён. Обновите карточку');
   if(!c.shipment?.uuid||c.shipment.state!=='ready')throw Error('Удаление доступно после подтверждения выгрузки. Сначала обновите статус отправления');
   if(!['packing','phone','shipping','pickup'].includes(c.order.status))throw Error('Удаление доступно только до завершения доставки');
   const api=await apiFor(c.shipment.slot),uuid=uuidSchema.parse(c.shipment.uuid);
   const data=await json(await api('/orders/'+uuid));
   if(data.entity?.uuid!==uuid||data.entity?.number!==c.order.id)throw Error('СДЭК вернул другое отправление');
   const latest=[...(data.entity?.statuses||[])].filter((s:any)=>!s.deleted&&Number.isFinite(Date.parse(s.date_time))).sort((a:any,b:any)=>Date.parse(b.date_time)-Date.parse(a.date_time))[0];
   if(latest?.code!=='CREATED')throw Error('СДЭК разрешает удалять только отправление в статусе «Создан», до движения посылки на складе. Текущий статус: '+(latest?.code||'неизвестен'));
   const shipment:Shipment={...c.shipment,state:'deleting',error:undefined,deletion:{at:new Date().toISOString(),reason:p.reason,actor:c.actor.login,previousRequests:(data.requests||[]).filter((r:any)=>r.type==='DELETE').map(deletionRequestKey)}};
   const pending=JSON.stringify(shipment);
   const lock=await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)').bind(pending,c.key,c.record!.data,c.order.id,c.order.version).run();
   if(!lock.meta.changes)throw Error('Отправление изменилось. Обновите карточку');
   let response:Response,answer:any;
   try{response=await api('/orders/'+uuid,undefined,'DELETE');answer=await response.json();}
   catch{shipment.error='Ответ на удаление не получен. Обновите статус отправления: до подтверждения СДЭК повторная выгрузка заблокирована.';await save(shipment,pending);return reply({shipment,message:shipment.error});}
   return reply(await applyCdekDeletion(d,c.order,shipment,pending,answer,true,response.status));
  }
  if(p.action==='create'){
   if(c.shipment&&c.shipment.state!=='invalid')return reply({shipment:c.shipment});
   if(c.order.version!==p.version)throw Error('Заказ изменён. Закройте карточку и откройте заново');
   const form=shipmentFormSchema.parse(p.form);
   if(c.order.cdekTariff?.params.originMode==='warehouse'){
    const warehouse=await d.prepare("SELECT data FROM settings WHERE id='warehouse-address'").first<{data:string}>();
    form.shipmentPoint=warehouse?JSON.parse(warehouse.data).shipmentPoint?.code||'':'';
    if(!form.shipmentPoint)throw Error('Укажите ПВЗ отправления в разделе «Склад»');
   }
   const clientRow=await d.prepare('SELECT data FROM clients WHERE id=?').bind(c.order.clientId).first<{data:string}>();if(!clientRow)throw Error('Клиент не найден');
   const products=await d.prepare('SELECT data FROM products').all<{data:string}>();
   const payload=shipmentPayload(c.order,JSON.parse(clientRow.data) as Client,products.results.map(x=>JSON.parse(x.data)),form);
   const t=c.order.cdekTariff!;assertRoutingSlot(await orderRouting(c.order),t.slot);const api=await apiFor(t.slot);
   for(const [code,side] of [[form.shipmentPoint,'sender'],[form.deliveryPoint,'recipient']]){
    if(side==='sender'&&t.params.originMode!=='warehouse'||side==='recipient'&&c.order.delivery!=='cdek_pickup')continue;
    const filters=new URLSearchParams({code,postal_code:side==='sender'?t.params.originPostalCode:c.order.addressParts?.postalCode||'',type:'PVZ',weight_max:String(Math.ceil(t.params.weight)),length:String(t.params.length),width:String(t.params.width),height:String(t.params.height)});
    const points=await json(await api(`/deliverypoints?${filters}`));const point=Array.isArray(points)?points.find(x=>x.code===code):null;
    if(!point||point.status!=='ACTIVE'||side==='sender'&&!point.is_reception||side==='recipient'&&!point.is_handout)throw Error('Выбранный ПВЗ недоступен. Выберите другой');
    if(side==='recipient'&&(payload.packages[0].items.some(x=>x.payment.value>0)||form.deliveryCost>0)&&point.allowed_cod===false)throw Error('ПВЗ не принимает наложенный платёж');
   }
   const routing=await orderRouting(c.order);assertRoutingSlot(routing,t.slot);const guard=routingReservationGuard(routing,c.order);
   const shipment:Shipment={recipientPhone:payload.recipient.phones[0].number,routingAmountCents:routing.amountCents,routingRuleId:routing.choice?.ruleId,routingReason:routing.choice?.reason,attempt:crypto.randomUUID(),slot:t.slot,account:t.account,state:'sending',createdAt:new Date().toISOString(),form};const pending=JSON.stringify(shipment);
   const lock=c.record?await d.prepare(`UPDATE settings SET data=? WHERE id=? AND data=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND ${guard.sql}`).bind(pending,c.key,c.record.data,p.orderId,p.version!,...guard.values).run():await d.prepare(`INSERT OR IGNORE INTO settings(id,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND ${guard.sql}`).bind(c.key,pending,p.orderId,p.version!,...guard.values).run();
   if(!lock.meta.changes)throw Error('Заказ, правила или лимит изменились. Обновите карточку и пересчитайте доставку');
   try{
    const response=await api('/orders',payload);const data=await response.json() as any;
    const result=shipmentResult(data);
    if(!response.ok&&!result.error)result.error=`СДЭК: ошибка ${response.status}`;
    Object.assign(shipment,result);
    if(!response.ok)shipment.state=response.status>=500?'unknown':'invalid';
    if(!shipment.uuid&&shipment.state==='pending')shipment.state='unknown';
   }catch{shipment.state='unknown';shipment.error='Ответ СДЭК не получен. Повторная отправка заблокирована, чтобы не создать дубль. Укажите UUID из кабинета СДЭК для проверки.';}
   await save(shipment,pending);
   await d.prepare('INSERT INTO events(id,client_id,order_id,at,data) VALUES(?,?,?,?,?)').bind(shipment.attempt,c.order.clientId,c.order.id,new Date().toISOString(),JSON.stringify({id:shipment.attempt,clientId:c.order.clientId,orderId:c.order.id,at:new Date().toISOString(),actor:c.actor.login,text:`Выгрузка в СДЭК · ${shipment.account} · ${shipment.state}${shipment.uuid?` · ${shipment.uuid}`:''}`})).run();
   return reply({shipment});
  }
  if(!c.shipment)throw Error('Сначала выгрузите заказ в СДЭК');const shipment={...c.shipment};const api=await apiFor(shipment.slot);
  if(p.action==='refresh'){
   const uuid=uuidSchema.parse(shipment.uuid||p.recoveryUuid);
   const data=await json(await api(`/orders/${uuid}`));
   if(data.entity?.uuid!==uuid)throw Error('СДЭК вернул другой идентификатор отправления');
   if(data.entity?.number&&data.entity.number!==c.order.id)throw Error('Этот UUID относится к другому заказу');
   if(shipment.state==='deleting'&&shipment.deletion)return reply(await applyCdekDeletion(d,c.order,shipment,c.record!.data,data));
   if(data.entity?.number!==c.order.id)throw Error('СДЭК не подтвердил номер заказа');
   Object.assign(shipment,shipmentResult(data));await save(shipment,c.record!.data);
   const rules=await d.prepare("SELECT data FROM settings WHERE id='cdek-status-mapping'").first<{data:string}>();
   const config=rules?JSON.parse(rules.data):{mapping:{},revision:''};
   const patch=cdekStatusPatch(c.order,data.entity,config.mapping,config.revision);
   let changed=false;
   if(patch){
    const mutation=crypto.randomUUID(),at=new Date().toISOString();
    const next={...c.order,...patch,updatedAt:at,_mutation:mutation};
    const event={id:mutation,clientId:c.order.clientId,orderId:c.order.id,at,actor:'СДЭК',text:patch.status?`СДЭК: ${patch.cdekStatus?.code} → ${statuses[patch.status]}`:patch.cdekStatus?`Обновлён статус СДЭК: ${patch.cdekStatus.code}`:"Уточнена дата регистрации отправления в СДЭК"};
    const result=await d.batch([d.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)').bind(JSON.stringify(next),c.order.id,c.order.version,c.key,JSON.stringify(shipment)),d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(event.id,event.clientId,event.orderId,at,JSON.stringify(event),c.order.id,mutation)]);
    if(!result[0].meta.changes)throw Error('Заказ изменился во время обновления. Повторите проверку статуса');
    changed=true;
   }
   return reply({shipment,changed});
  }
  if(shipment.state!=='ready'||!shipment.uuid)throw Error('СДЭК ещё не подтвердил создание заказа. Обновите статус отправления');
  if(!shipment.printId||Date.now()-Date.parse(shipment.printAt||'')>50*60000){
   const data=await json(await api('/print/orders',{orders:[{order_uuid:shipment.uuid}],copy_count:2,type:'tpl_russia'}));
   if(cdekErrors(data))throw Error(cdekErrors(data));shipment.printId=uuidSchema.parse(data.entity?.uuid);shipment.printAt=new Date().toISOString();await save(shipment,c.record!.data);
  }
  const printId=uuidSchema.parse(shipment.printId);const data=await json(await api(`/print/orders/${printId}`));
  const latest=[...(data.entity?.statuses||[])].sort((a:any,b:any)=>String(b.date_time).localeCompare(String(a.date_time)))[0]?.code;
  if(latest==='INVALID'||latest==='REMOVED'||cdekErrors(data)){const prev=JSON.stringify(shipment);delete shipment.printId;delete shipment.printAt;await save(shipment,prev);throw Error(cdekErrors(data)||'СДЭК не сформировал PDF. Повторите получение накладной');}
  if(latest!=='READY')return Response.json({pending:true,message:'СДЭК формирует накладную. Нажмите скачать ещё раз через несколько секунд.'},{status:202});
  const pdf=await api(`/print/orders/${printId}.pdf`);if(!pdf.ok)throw Error('Не удалось скачать PDF из СДЭК');
  const bytes=await pdf.arrayBuffer();if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('СДЭК вернул некорректный PDF');
  if(!shipment.downloadedAt){const previous=JSON.stringify(shipment);shipment.downloadedAt=new Date().toISOString();await save(shipment,previous);}
  const current=await d.prepare('SELECT data FROM settings WHERE id=?').bind(c.key).first<{data:string}>();
  if(!current||current.data!==JSON.stringify(shipment))throw Error('Отправление изменилось. Эта накладная больше недоступна');
  return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="cdek-waybill.pdf"','Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?e.issues.map(x=>x.message).join('; '):e instanceof Error?e.message:'Ошибка СДЭК'},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

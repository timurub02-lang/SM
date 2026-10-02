import {courierOutstanding} from '@/lib/courier';
import {saveReminders,employeeReminders} from '@/lib/reminders';
import {initCash} from '@/lib/cash-db';
import {total,canReceivePayment,isLogistic} from '@/lib/crm';
import {removalPlan} from '@/lib/employee-removal';
import {ensureAuth,personalAuth} from '@/lib/auth';
import {hashPassword} from '@/lib/auth-crypto';
import {visibleState,authorizeCrm} from '@/lib/permissions';
import {authenticated} from '@/lib/api-auth';
import {initInventory} from '@/lib/inventory';
import {canManageDelivery} from "@/lib/cdek-calculator";
import {cleanImportedAddress} from "@/lib/dadata";
import {addressPartsSchema} from "@/lib/address";
import {db} from "@/lib/db";
import {getChatGPTUser} from "@/app/chatgpt-auth";
import {clientAssignment,finalNoAnswerDeadline,reworkDeadlineFrom,validateReworkCall,hasActiveOrder,employeeForManager,canLogisticEditOrder,orderEditingLocked,clientAddressFromOrder,deliverySchema,applyRetention,sourceSheet,clientSheet,seed,orderDatesForTransition,clientSchema,itemsSchema,employeeSchema,validateTransition,roles,type State,type Client,type Order,type Employee,type Event,type Status} from "@/lib/crm";
import {z} from "zod";
export const dynamic="force-dynamic";
const json=JSON.stringify;
async function identity(){const u=await getChatGPTUser();if(!u)throw new Error("Требуется вход в CRM");return u;}
async function readState(reconcile=true):Promise<State>{
 await initInventory();const d=db();const tables=await Promise.all([d.prepare("SELECT data,version FROM clients ORDER BY id").all(),d.prepare("SELECT o.data,o.version,EXISTS(SELECT 1 FROM settings s WHERE s.id='cdek-shipment-' || o.id AND json_extract(s.data,'$.state')='ready' AND json_extract(s.data,'$.number') IS NOT NULL) AS cdek_exported,EXISTS(SELECT 1 FROM settings s WHERE s.id='cdek-shipment-' || o.id AND json_extract(s.data,'$.downloadedAt') IS NOT NULL) AS cdek_waybill_received FROM orders o ORDER BY o.id DESC").all(),d.prepare("SELECT data,version FROM employees ORDER BY id").all(),d.prepare("SELECT data FROM events ORDER BY at DESC").all(),d.prepare("SELECT data FROM settings WHERE id='main'").first<{data:string}>()]);
 const state:State={clients:tables[0].results.map((r:any)=>({...JSON.parse(r.data),version:r.version})),orders:tables[1].results.map((r:any)=>({...JSON.parse(r.data),version:r.version,cdekExported:!!r.cdek_exported||(JSON.parse(r.data).testOnly===true&&JSON.parse(r.data).cdekExported===true),cdekWaybillReceived:!!r.cdek_waybill_received})),employees:tables[2].results.map((r:any)=>({...JSON.parse(r.data),version:r.version})),events:tables[3].results.map((r:any)=>JSON.parse(r.data)),settings:tables[4]?JSON.parse(tables[4].data):{retentionDays:30}};
 if(reconcile){
  let orderChanged=false;
  for(const o of state.orders.filter(o=>o.status==="rework"||(o.finalHandoffAt&&["confirm","extra"].includes(o.status)))){
   const received=state.events.find(e=>e.orderId===o.id&&e.text.includes("→ Возврат оператору"))?.at||o.updatedAt;
   const finalMissed=o.status!=="rework";
   const deadline=finalMissed?finalNoAnswerDeadline(o,o.contact,new Date().toISOString())!:(o.reworkDeadline||reworkDeadlineFrom(received));
   const expired=Date.now()>=Date.parse(deadline);
   if((finalMissed?o.noAnswerDeadline===deadline:!!o.reworkDeadline)&&!expired)continue;
   const expiryReason=finalMissed?"Истёк срок финального подтверждения: 24 часа":"Истёк срок доработки после возврата логистом (4 суток)";
   const at=new Date().toISOString(),mutation=crypto.randomUUID();
   const next={...o,...(finalMissed?{noAnswerDeadline:deadline}:{}),reworkDeadline:finalMissed?o.reworkDeadline:deadline,returnReason:o.returnReason||o.reason,_mutation:mutation,...(expired?{status:"refused",cancelledAt:o.cancelledAt||deadline,updatedAt:at,contact:"none",due:"",reason:expiryReason}:{})};
   const e:Event={id:"EV-"+crypto.randomUUID(),clientId:o.clientId,orderId:o.id,at,actor:"Система",text:"Заказ отменён: "+expiryReason};
   const results=await d.batch([d.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=?").bind(json(next),o.id,o.version),...(expired?[d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(e.id,e.clientId,e.orderId,at,json(e),o.id,mutation)]:[])]);
   orderChanged=orderChanged||!!results[0].meta.changes;
  }
  if(orderChanged)return readState();
  let changed=false;
  for(const c of state.clients){
   const next=applyRetention(c,state.orders);
   if(JSON.stringify(next)===JSON.stringify(c))continue;
   const at=new Date().toISOString();const eid="EV-"+crypto.randomUUID();
   const event:Event={id:eid,clientId:c.id,orderId:"",at,actor:"Система",text:next.owner?"Правило К · закрепление обновлено":"Правило К · откреплён, возвращён в "+(clientSheet(next)||"исходную базу")};
   const related=state.orders.filter(o=>o.clientId===c.id);
   const guard=" AND (SELECT COUNT(*) FROM orders WHERE client_id=?)=?"+related.map(()=>" AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)").join("");
   const args=[c.id,related.length,...related.flatMap(o=>[o.id,o.version])];
   const result=await d.batch([
    d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?"+guard+")").bind(eid,c.id,"",at,json(event),c.id,c.version,...args),
    d.prepare("UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=?"+guard).bind(json(next),c.id,c.version,...args)
   ]);
   changed=changed||!!result[1].meta.changes;
  }
  if(changed)return readState(false);
 }
 return state;
}
async function initialize(){const d=db();if(await d.prepare("SELECT id FROM settings WHERE id='main'").first())return;
 const s=seed();await d.batch([
 ...s.clients.map(c=>d.prepare("INSERT OR IGNORE INTO clients(id,phone,data) VALUES(?,?,?)").bind(c.id,c.phone,json(c))),
 ...s.employees.map(e=>d.prepare("INSERT OR IGNORE INTO employees(id,data) VALUES(?,?)").bind(e.id,json(e))),
 ...s.orders.map(o=>d.prepare("INSERT OR IGNORE INTO orders(id,client_id,data) VALUES(?,?,?)").bind(o.id,o.clientId,json(o))),
 ...s.events.map(e=>d.prepare("INSERT OR IGNORE INTO events(id,client_id,order_id,at,data) VALUES(?,?,?,?,?)").bind(e.id,e.clientId,e.orderId,e.at,json(e))),
 d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('main',?)").bind(json(s.settings))]);
}
async function responseState(user:Awaited<ReturnType<typeof identity>>){
 const state=await readState();await saveReminders(state);if(!user.employee)return state;
 const visible=visibleState(state,user.employee);
 if(['admin','department_head','chief_logistic'].includes(user.employee.role)){
  const accounts=await db().prepare('SELECT employee_id,enabled FROM auth_accounts').all<{employee_id:string;enabled:number}>();
  visible.employees=visible.employees.map(e=>{const account=accounts.results.find(a=>a.employee_id===e.id);return {...e,...(user.employee?.role!=='chief_logistic'||e.role==='logistic'||e.id===user.employee.id?{hasPassword:!!account,accessEnabled:!!account?.enabled}:{})};});
 }
 return {...visible,reminders:await employeeReminders(state,user.employee),currentEmployeeId:user.employee.id,personalAuth:true};
}
async function handleGET(){try{const user=await identity();await initialize();return Response.json(await responseState(user),{headers:{"Cache-Control":"no-store"}});}catch(e){console.error(e);return Response.json({error:e instanceof Error&&e.message==="Требуется вход в CRM"?e.message:"Не удалось подключиться к базе CRM"},{status:503});}}
async function handlePOST(request:Request){
 try{
 const user=await identity();
 if(request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Запрос отклонён"},{status:403});
 const raw=await request.text();if(raw.length>1500000)throw new Error("Файл слишком большой. Разделите импорт на части");
 const p=JSON.parse(raw);const d=db();const s=await readState();const now=new Date().toISOString();const id=(prefix:string)=>prefix+crypto.randomUUID().slice(0,12);let message="Сохранено";
 // Production actor is fixed by the authenticated API wrapper.
 const employee=s.employees.find(x=>x.id===p.actorId);const actor=`${user.displayName}${employee?` · от имени ${employee.name}`:""}`;
 if(user.employee)authorizeCrm(user.employee,p,s);
 const ev=(clientId:string,orderId:string,text:string):Event=>({id:id("EV-"),clientId,orderId,at:now,actor,actorId:employee?.id,text});
 const eventSQL=(e:Event)=>d.prepare("INSERT INTO events(id,client_id,order_id,at,data) VALUES(?,?,?,?,?)").bind(e.id,e.clientId,e.orderId,e.at,json(e));
 const ownerValid=(owner:string)=>{if(owner&&!s.employees.some(e=>e.id===owner&&e.role==="operator"))throw new Error("Выберите оператора");};
 const assignedUntil=()=>"";
 await saveReminders(s);
 if(p.action==="readReminder"){
  if(!employee)throw Error("Требуется сотрудник");
  await d.prepare("UPDATE reminders SET read_at=COALESCE(read_at,?) WHERE employee_id=? AND id=?").bind(now,employee.id,z.string().max(500).parse(p.id)).run();
 }else if(p.action==="createClient"){
  if(!employee||!["admin","department_head"].includes(employee.role))throw Error("Добавлять клиентов могут только администратор и руководитель отдела");
  const data=clientSchema.parse(p.client);ownerValid(data.owner);
  if(employee.role==="department_head"&&data.owner&&!s.employees.some(e=>e.id===data.owner&&e.role==="operator"&&!!employee.department&&e.department===employee.department))throw Error("Выберите оператора своего отдела");
  const duplicate=s.clients.find(c=>c.phone===data.phone);
  if(duplicate?.owner)throw Error("Клиент уже существует и закреплён за "+(s.employees.find(e=>e.id===duplicate.owner)?.login||duplicate.owner));
  if(duplicate&&p.claimId!==duplicate.id)throw Error("Клиент уже есть в базе и свободен. Обновите данные и выберите оператора для передачи");
  if(duplicate&&!data.owner)throw Error("Выберите оператора для передачи клиента");
  const firstSheet=s.clients.map(c=>sourceSheet(c.source)).find(x=>x&&x!=="К")||"Т1";
  const trial=data.owner?{trialUntil:new Date(Date.parse(now)+86400000).toISOString(),trialReturnSheet:firstSheet,assignedUntil:new Date(Date.parse(now)+86400000).toISOString(),assignmentStartedAt:now,sheet:"К",returnSheet:duplicate?clientSheet(duplicate):firstSheet}:{};
  if(duplicate){
   const next={...duplicate,...trial,owner:data.owner};
   const r=await d.prepare("UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=? AND json_extract(data,'$.owner')=''").bind(json(next),duplicate.id,duplicate.version).run();
   if(!r.meta.changes)throw Error("Клиент уже изменён. Обновите данные");
   await eventSQL(ev(duplicate.id,"","Клиент передан оператору на 24 часа без заказа")).run();message="Клиент передан оператору";
  }else{
   const c:Client={...data,id:id("C-"),assignedUntil:"",createdAt:now,version:1,...trial};
   await d.batch([d.prepare("INSERT INTO clients(id,phone,data) VALUES(?,?,?)").bind(c.id,c.phone,json(c)),eventSQL(ev(c.id,"","Клиент добавлен в базу"))]);message="Клиент добавлен";
  }
 }else if(p.action==="updateClient"){
  const c=s.clients.find(c=>c.id===p.id);if(!c)throw new Error("Клиент не найден");const data=clientSchema.parse(user.employee&&["operator","department_head"].includes(employee!.role)?{...p.client,phone:c.phone}:p.client);if(employee?.role==="operator")data.owner=c.owner;ownerValid(data.owner);if(employee?.role==="department_head"&&data.owner&&!s.employees.some(e=>e.id===data.owner&&e.role==="operator"&&!!employee.department&&e.department===employee.department))throw Error("Выберите оператора своего отдела");const mutation=id("M-");
  const firstSheet=s.clients.map(c=>sourceSheet(c.source)).find(x=>x&&x!=="К")||"Т1";
  const next={...c,...data,...clientAssignment(c,data.owner,now,firstSheet),addressReview:data.address===c.address?c.addressReview:false,_mutation:mutation};
  const e=ev(c.id,"","Обновлена карточка клиента"+(c.owner!==data.owner?data.owner?" · передан оператору на 24 часа без нового заказа":" · клиент освобождён":""));
  const result=await d.batch([d.prepare("UPDATE clients SET phone=?,data=?,version=version+1 WHERE id=? AND version=?").bind(next.phone,json(next),c.id,p.version),d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(e.id,e.clientId,e.orderId,e.at,json(e),c.id,mutation)]);
  if(!result[0].meta.changes)throw new Error("Карточка уже изменена. Обновите страницу и повторите");
 }else if(p.action==="requestOrder"||p.action==="decideOrderRequest"){
  const c=s.clients.find(c=>c.id===p.clientId);if(!c||!employee)throw Error("Клиент или сотрудник не найден");
  let request=c.orderRequest;
  if(p.action==="requestOrder"){
   const manager=s.employees.find(e=>e.id===c.owner&&e.role==="operator");
   if(!manager?.department)throw Error("Назначьте клиенту оператора с указанным отделом");
   if(employee.role==="operator"&&employee.id!==manager.id||employee.role==="department_head"&&employee.department!==manager.department)throw Error("Клиент другого оператора или отдела");
   if(!["operator","department_head","admin","logistic","chief_logistic","redemption"].includes(employee.role))throw Error("Нет доступа");
   if(!hasActiveOrder(s.orders,c.id))throw Error("Запрос не нужен — активных заказов нет");
   if(request&&["pending","approved"].includes(request.status))throw Error("Запрос уже отправлен или одобрен");
   request={id:id("REQ-"),actorId:employee.id,manager:manager.id,department:manager.department,status:"pending",at:now};
   message="Запрос отправлен руководителю отдела";
  }else{
   if(!request||request.status!=="pending"||request.id!==p.requestId)throw Error("Запрос уже обработан");
   if(employee.role!=="admin"&&(employee.role!=="department_head"||!employee.department||employee.department!==request.department))throw Error("Запрос доступен руководителю этого отдела");
   request={...request,status:z.enum(["approved","rejected"]).parse(p.decision)};message=request.status==="approved"?"Повторный заказ разрешён":"Запрос отклонён";
  }
  const r=await d.prepare("UPDATE clients SET data=json_set(data,'$.orderRequest',json(?)),version=version+1 WHERE id=? AND version=?").bind(json(request),c.id,c.version).run();if(!r.meta.changes)throw Error("Клиент изменился. Повторите действие");
  await eventSQL(ev(c.id,"",message)).run();
 }else if(p.action==="createOrder"){
  const c=s.clients.find(c=>c.id===p.clientId);if(!c)throw new Error("Выберите клиента");
  if(employee?.role==="operator"&&c.owner!==employee.id)throw Error("Можно оформить заказ только своему клиенту");
  if(employee?.role==="department_head"&&!s.employees.some(e=>e.id===c.owner&&e.role==="operator"&&!!employee.department&&e.department===employee.department))throw Error("Клиент другого отдела");
  const approved=c.orderRequest?.status==="approved"&&c.orderRequest.manager===c.owner&&(c.orderRequest.actorId===employee?.id||employee?.role==="admin");
  if(hasActiveOrder(s.orders,c.id)&&!approved)throw Error("У клиента уже есть активный заказ. Запросите разрешение руководителя отдела");
  const items=itemsSchema.parse(p.items);const comment=z.string().max(3000).parse(p.comment||"");
  if(employee?.role==="operator"&&c.owner&&c.owner!==employee.id)throw new Error("Клиент закреплён за другим оператором");const manager=employee?.role==="operator"?employee.id:c.owner;ownerValid(manager);if(!manager)throw new Error("Сначала закрепите клиента за оператором");
  const o:Order={id:id("SM-"),clientId:c.id,delivery:deliverySchema.parse(p.delivery??""),addressParts:addressPartsSchema.optional().parse(p.addressParts??c.addressParts),address:z.string().trim().max(500).parse(p.address??c.address),status:"draft",items,comment,reason:"",contact:"none",due:"",round:1,extra:false,createdAt:now,updatedAt:now,manager,logistic:"",version:1};
  const result=await d.batch([d.prepare("INSERT INTO orders(id,client_id,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?)").bind(o.id,c.id,json(o),c.id,c.version),d.prepare("UPDATE clients SET data=json_patch(json_set(json_remove(data,'$.orderRequest'),'$.owner',?,'$.assignedUntil',?,'$.assignmentStartedAt',?),json(?)),version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(manager,assignedUntil(),c.assignmentStartedAt||now,json(clientAddressFromOrder(o)||{}),c.id,o.id),eventSQL(ev(c.id,o.id,"Создан заказ · Оформление"+(clientAddressFromOrder(o)?" · адрес клиента обновлён из заказа":"")))]);if(!result[0].meta.changes)throw Error("Клиент изменился. Обновите данные перед оформлением");message="Заказ создан";
 }else if(["courierAccept","courierOutcome","receivePayment","saveManualDeliveryCost","returnToWarehouse","markPackingWaybill","updateWaybillComment","selectCdekTariff","updateDelivery","updateOrder","transition","contact","comment"].includes(p.action)){
  const o=s.orders.find(x=>x.id===p.id);if(!o)throw new Error("Заказ не найден");const c=s.clients.find(c=>c.id===o.clientId)!;if(!employee||(orderEditingLocked(employee,o)&&!(employee.role==="courier"&&["courierAccept","courierOutcome"].includes(p.action))&&!(isLogistic(employee.role)&&p.action==="updateOrder"&&canLogisticEditOrder(o))))throw new Error("Этот заказ доступен вам только для просмотра");const next={...o,updatedAt:now,_mutation:id("M-")};let text="";let cashReceipt:ReturnType<typeof d.prepare>[]=[];
  if(o.status==="rework"&&!next.returnReason)next.returnReason=o.reason;
  if((["updateOrder","updateDelivery","selectCdekTariff","saveManualDeliveryCost"].includes(p.action)||isLogistic(employee?.role)&&p.action==="updateWaybillComment")){
   const shipment=await d.prepare("SELECT data FROM settings WHERE id=?").bind(`cdek-shipment-${o.id}`).first<{data:string}>();
   if(shipment&&JSON.parse(shipment.data).state!=="invalid")throw Error("Заказ уже выгружен или отправляется в СДЭК. Изменение доставки и корзины заблокировано");
  }
  if(p.action==="courierAccept"){
   if(employee.role!=='courier'||o.courier?.id!==employee.id||o.delivery!=='moscow_courier'||!['shipping','pickup'].includes(o.status)||o.courier.acceptedAt)throw Error('Приём этой посылки недоступен или уже подтверждён');
   if(p.confirmed!==true)throw Error('Подтвердите фактическое получение посылки');
   next.courier={...o.courier,acceptedAt:now};text='Принято курьером · '+o.courier.name+' · '+o.courier.amount+' ₽';
  }else if(p.action==="courierOutcome"){
   if(!o.courier?.acceptedAt)throw Error('Сначала примите посылку у логиста');
   if(employee.role!=='courier'||o.courier?.id!==employee.id||o.delivery!=='moscow_courier'||!['shipping','pickup'].includes(o.status))throw Error('Этот заказ недоступен для действия курьера');
   const to=z.enum(['redeemed','returned']).parse(p.to);
   const reason=to==='returned'?z.string().trim().min(1,'Укажите причину возврата').max(1000).parse(p.reason):'';
   if(p.confirmed!==true)throw Error('Подтвердите получение денег или возврат посылки');
   next.status=to;Object.assign(next,orderDatesForTransition(o,to,now));next.reason=reason;next.contact='none';next.due='';
   text=to==='redeemed'?'Курьер получил оплату клиента · '+o.courier.amount+' ₽':'Курьер отметил возврат · ожидает приёма посылки на склад · '+reason;
  }else if(p.action==="receivePayment"){
   if(!canReceivePayment(o,employee.role))throw Error("Приём оплаты доступен логисту только для оплаченного заказа курьера Москвы или Почты России без ранее принятой оплаты");
   next.paymentReceipt={amount:z.number().finite().nonnegative().parse(o.courier?.amount??total(o)),operatorLogin:s.employees.find(e=>e.id===o.manager)?.login||"",receivedByName:employee.name,delivery:o.delivery!};next.paymentReceivedAt=now;next.paymentReceivedBy=employee.id;text="Оплата принята логистом · деньги получены · "+next.paymentReceipt.amount+" ₽";
   await initCash();
   const chiefs=s.employees.filter(e=>e.role==='chief_logistic');
   const chief=employee.role==='chief_logistic'?employee:chiefs.length===1?chiefs[0]:null;
   if(!chief)throw Error('Для приёма денег нужен один назначенный главный логист');
   if(next.paymentReceipt.amount>0)cashReceipt=[d.prepare("INSERT INTO cash_operations(id,kind,recipient,amount,purpose,date,created_at,accepted_at,actor,sender_name,recipient_name,order_id) SELECT ?,'receipt',?,?,?,?,?,?,?,'',?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind('receipt-'+o.id,chief.id,Math.round(next.paymentReceipt.amount*100),'Оплата заказа '+o.id+' · '+(o.delivery==='moscow_courier'?'Курьер Москва':'Почта России'),new Date(now).toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}),now,now,employee.id,chief.name,o.id,o.id,next._mutation)];

  }else if(p.action==="saveManualDeliveryCost"){
   if(!canManageDelivery(employee.role,o.status)||!["moscow_courier","russian_post"].includes(o.delivery||""))throw Error("Стоимость доступна логисту для курьера Москвы и Почты России до отправки");
   next.manualDeliveryCost=z.number().finite().min(0).max(1000000).parse(p.amount);text="Сохранена стоимость доставки: "+next.manualDeliveryCost+" ₽";
  }else if(p.action==="returnToWarehouse"){
   if(!["admin","logistic","chief_logistic"].includes(employee.role))throw Error("Возврат на склад подтверждают администратор и логист");
   if(o.status!=="returned")throw Error("Заказ должен быть в статусе «Возврат»");
   if(o.warehouseReturnedAt)throw Error("Товар уже возвращён на склад");
   next.warehouseReturnedAt=now;text="Возврат на склад · товар принят, резерв освобождён";
  }else if(p.action==="markPackingWaybill"){
   if(!employee||!["admin","logistic","chief_logistic"].includes(employee.role))throw Error("Нет доступа к накладным");
   next.packingWaybillAt=o.packingWaybillAt||now;text="Подготовлена накладная на сборку";
  }else if(p.action==="updateWaybillComment"){
   if(!employee||!["operator","logistic","chief_logistic","admin","redemption"].includes(employee.role))throw new Error("Нет доступа к комментарию заказа");
   next.waybillComment=z.string().trim().max(3000).parse(p.text);text="Изменён комментарий заказа для внутреннего бланка";
  }else if(p.action==="selectCdekTariff"){
   if(!employee||!canManageDelivery(employee.role,o.status))throw new Error("Выбор тарифа доступен только логисту до отправки");
   const row=await d.prepare("SELECT data FROM settings WHERE id=?").bind(`cdek-quote-${o.id}`).first<{data:string}>();const quote=row?JSON.parse(row.data):null;
   if(!quote||quote.id!==p.quoteId||Date.now()-Date.parse(quote.calculatedAt)>3600000||JSON.stringify(quote.items)!==JSON.stringify(o.items)||quote.address!==o.address||JSON.stringify(quote.addressParts)!==JSON.stringify(o.addressParts))throw new Error("Расчёт устарел. Рассчитайте доставку повторно");
   const tariff=quote.tariffs.find((t:any)=>t.code===p.code);if(!tariff)throw new Error("Тариф не найден в расчёте СДЭК");
   next.delivery=quote.params.delivery;next.cdekTariff={...tariff,account:quote.account,slot:quote.params.slot,calculatedAt:quote.calculatedAt,params:quote.params};text=`Выбран тариф СДЭК: ${tariff.name} (${tariff.code}), ${tariff.amount} ₽ · ${quote.account}`;
  }else if(p.action==="updateDelivery"){
   if(!employee||!canManageDelivery(employee.role,o.status))throw new Error("Способ доставки выбирает логист до отправки заказа");
   next.delivery=deliverySchema.parse(p.delivery);text="Изменён способ доставки";
  }else if(p.action==="updateOrder"){
   if(!isLogistic(employee.role)&&!["draft","rework"].includes(o.status))throw new Error("Корзину можно менять на этапе оформления или возврата оператору");
   next.delivery=deliverySchema.parse(p.delivery??o.delivery??"");next.addressParts=addressPartsSchema.optional().parse(p.addressParts);next.address=z.string().trim().max(500).parse(p.address??o.address??c.address);next.items=isLogistic(employee.role)?o.items:itemsSchema.parse(p.items);next.comment=z.string().max(3000).parse(p.comment||"");text=isLogistic(employee.role)?"Логист уточнил доставку, адрес и комментарий заказа":"Обновлены доставка, адрес, корзина и комментарий менеджера";
  }else if(p.action==="transition"){
   const to=z.enum(["draft","confirm","rework","check","extra","packing","phone","shipping","pickup","redeemed","refused","returned"]).parse(p.to);
   const reason=z.string().max(3000).parse(p.reason||"");validateTransition(o,to,c,reason,employee.role);
   if(to==='shipping'&&o.delivery==='moscow_courier'){
    if(!['admin','logistic','chief_logistic'].includes(employee.role)||o.courier)throw Error('Передача курьеру недоступна');
    const couriers=s.employees.filter(e=>e.role==='courier');
    const courier=p.courierId?couriers.find(e=>e.id===p.courierId):couriers.length===1?couriers[0]:undefined;
    if(!courier)throw Error('Выберите курьера для передачи заказа');
    const account=await d.prepare('SELECT enabled FROM auth_accounts WHERE employee_id=?').bind(courier.id).first<{enabled:number}>();
    if(personalAuth()&&!account?.enabled)throw Error('У курьера должен быть включён вход в CRM');
    if(!o.items.length)throw Error('В заказе нет товаров');
    next.courier={id:courier.id,name:courier.name,assignedAt:now,amount:total(o)};
   }
   if(to==="extra"&&o.status!=="rework"){delete next.finalHandoffAt;delete next.reworkDeadline;delete next.returnReason;}if(o.status==="rework"&&o.reworkDeadline&&["confirm","extra"].includes(to)){if(p.finalHandoffConfirmed!==true)throw Error("Подтвердите завершение работы с заказом");next.finalHandoffAt=now;}delete next.noAnswerDeadline;Object.assign(next,orderDatesForTransition(o,to,now));next.status=to;next.noAnswerDeadline=finalNoAnswerDeadline(next,next.contact,now);if(to==="rework"){next.returnReason=reason;next.reworkDeadline=reworkDeadlineFrom(now);}if(to!==o.status)delete next.warehouseReturnedAt;next.reason=reason;next.contact="none";next.due="";if(to==="extra")next.extra=true;if(o.status==="rework"&&["confirm","extra"].includes(to))next.round++;
   if(isLogistic(employee?.role))next.logistic=employee.id;
   const labels=await import("@/lib/crm");text=`${labels.statuses[o.status]} → ${labels.statuses[to]}${reason?" · "+reason:""}`;
  }else if(p.action==="contact"){
   if(!["draft","confirm","rework","extra","pickup"].includes(o.status))throw new Error("Звонок недоступен на этом этапе");
   next.contact=z.enum(["missed","callback"]).parse(p.contact);next.reason=z.string().trim().min(1,"Укажите причину").max(1000).parse(p.reason);
   next.noAnswerDeadline=finalNoAnswerDeadline(o,next.contact,now);
   if(p.due){const due=z.string().datetime().parse(p.due);validateReworkCall(o,due);if(next.noAnswerDeadline&&Date.parse(due)>Date.parse(next.noAnswerDeadline))throw Error("Звонок нельзя назначить позже срока автоотмены финального подтверждения");if(Date.parse(due)<=Date.now())throw new Error("Выберите будущее время звонка");next.due=due;}else{if(next.contact==="callback")throw new Error("Для перезвона нужно время звонка");next.due="";}
   if(isLogistic(employee?.role))next.logistic=employee.id;
   text=`${next.contact==="missed"?"Недозвон":"Перезвон"}: ${next.reason}${next.due?" · "+new Date(next.due).toLocaleString("ru-RU",{timeZone:"Europe/Moscow"})+" МСК":""}`;
  }else{text="Комментарий: "+z.string().trim().min(1).max(3000).parse(p.text);}
  if(o.courier&&['updateOrder','updateDelivery','saveManualDeliveryCost','selectCdekTariff','markPackingWaybill','updateWaybillComment'].includes(p.action))throw Error('Заказ уже передан курьеру. Данные отправления зафиксированы');
  if(p.action!=="selectCdekTariff"&&next.cdekTariff&&(next.delivery!==o.delivery||next.address!==o.address||JSON.stringify(next.addressParts)!==JSON.stringify(o.addressParts)||JSON.stringify(next.items)!==JSON.stringify(o.items)))delete next.cdekTariff;
  if(next.delivery!==o.delivery||next.address!==o.address||JSON.stringify(next.addressParts)!==JSON.stringify(o.addressParts)||JSON.stringify(next.items)!==JSON.stringify(o.items)){delete next.manualDeliveryCost;delete next.packingWaybillAt;}
  const deliveryChanged=next.delivery!==o.delivery||next.address!==o.address||JSON.stringify(next.addressParts)!==JSON.stringify(o.addressParts);
  if(deliveryChanged&&(o.cdekTariff||o.manualDeliveryCost!==undefined||o.packingWaybillAt)){
   next.deliveryReset={at:now,calculation:!next.cdekTariff&&next.manualDeliveryCost===undefined&&(!!o.cdekTariff||o.manualDeliveryCost!==undefined||!!o.deliveryReset?.calculation),waybill:!!o.packingWaybillAt||!!o.deliveryReset?.waybill};
   text+=" · прежний расчёт доставки или накладная на сборку сброшены: требуется обновление";
  }else if(o.deliveryReset){
   next.deliveryReset={...o.deliveryReset};
   if(["selectCdekTariff","saveManualDeliveryCost"].includes(p.action))next.deliveryReset.calculation=false;
   if(p.action==="markPackingWaybill")next.deliveryReset.waybill=false;
  }
  if(next.deliveryReset&&!next.deliveryReset.calculation&&!next.deliveryReset.waybill)delete next.deliveryReset;
  const proposedAddress=p.action==="updateOrder"||p.action==="transition"&&["confirm","extra"].includes(next.status)?clientAddressFromOrder(next):null;
  const addressPatch=proposedAddress&&(c.address!==proposedAddress.address||JSON.stringify(c.addressParts??null)!==JSON.stringify(proposedAddress.addressParts)||c.city!==proposedAddress.city||c.addressReview)?proposedAddress:null;
  if(addressPatch)text+=" · адрес клиента обновлён из заказа";
  const e=ev(c.id,o.id,text);
  const result=await d.batch([d.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=?"+((["updateOrder","updateDelivery","selectCdekTariff","saveManualDeliveryCost"].includes(p.action)||isLogistic(employee?.role)&&p.action==="updateWaybillComment")?" AND NOT EXISTS(SELECT 1 FROM settings WHERE id='cdek-shipment-' || orders.id AND json_extract(data,'$.state')<>'invalid')":"")).bind(json(next),o.id,p.version),d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(e.id,c.id,o.id,e.at,json(e),o.id,next._mutation),...(addressPatch?[d.prepare("UPDATE clients SET data=json_patch(data,json(?)),version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(json(addressPatch),c.id,o.id,next._mutation)]:[]),...cashReceipt]);
  if(!result[0].meta.changes)throw new Error("Заказ уже изменён. Обновите страницу и повторите");
 }else if(p.action==="deleteEmployee"){
  if(s.orders.some(o=>o.courier?.id===p.id&&courierOutstanding(o)))throw Error('Сначала примите у курьера все деньги и возвраты');
  const plan=removalPlan(s,employee,p.id,p.version,p.mode,p.targetId);
  await initCash();
  const cash=await d.prepare("SELECT COALESCE((SELECT balance FROM cash_balances WHERE employee=?),0) AS balance,EXISTS(SELECT 1 FROM cash_operations WHERE (sender=? OR recipient=?) AND kind='transfer' AND accepted_at IS NULL) AS pending").bind(p.id,p.id,p.id).first<{balance:number;pending:number}>();
  if(cash&&(cash.balance!==0||cash.pending))throw Error('Перед удалением сотрудника обнулите кассу и завершите ожидающие переводы');

  if(personalAuth())await ensureAuth();
  const key="deleted-employee-"+plan.employee.id,mutation=crypto.randomUUID();
  // Guard the whole batch against changes since the snapshot, including newly assigned records.
  const snapshot=(rows:{id:string;version:number}[])=>json([...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(x=>[x.id,x.version]));
  const guard="EXISTS(SELECT 1 FROM settings WHERE id=? AND json_extract(data,'$.mutation')=?)";
  const args=[key,mutation];
  const summary=`Удалён сотрудник ${plan.employee.name} (${plan.employee.login}). `+(plan.target?`Клиенты и заказы переданы ${plan.target.name} (${plan.target.login})`:'Клиенты освобождены, заказы сохранены без оператора');
  const statements=[d.prepare("INSERT INTO settings(id,data) SELECT ?,? WHERE (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM employees ORDER BY id))=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM clients ORDER BY id))=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM orders ORDER BY id))=?").bind(key,json({employee:plan.employee,at:now,actorId:employee!.id,mode:p.mode,targetId:plan.target?.id,mutation}),snapshot(s.employees),snapshot(s.clients),snapshot(s.orders))];
  for(const c of plan.clients)statements.push(d.prepare(`UPDATE clients SET data=?,version=version+1 WHERE id=? AND ${guard}`).bind(json(c),c.id,...args));
  for(const o of plan.orders)statements.push(d.prepare(`UPDATE orders SET data=?,version=version+1 WHERE id=? AND ${guard}`).bind(json(o),o.id,...args));
  const history=[ev('','',summary),...plan.clients.map(c=>ev(c.id,'',summary)),...plan.orders.map(o=>ev(o.clientId,o.id,summary))];
  for(const e of history)statements.push(d.prepare(`INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE ${guard}`).bind(e.id,e.clientId,e.orderId,e.at,json(e),...args));
  if(personalAuth()){
   statements.push(d.prepare(`DELETE FROM auth_sessions WHERE employee_id=? AND ${guard}`).bind(p.id,...args));
   statements.push(d.prepare(`DELETE FROM auth_accounts WHERE employee_id=? AND ${guard}`).bind(p.id,...args));
  }
  statements.push(d.prepare(`DELETE FROM employees WHERE id=? AND ${guard}`).bind(p.id,...args));
  const result=await d.batch(statements);
  if(!result[0].meta.changes)throw Error('Данные изменились. Обновите страницу и повторите удаление');
  message=summary;
 }else if(p.action==="saveEmployee"){
  const existing=s.employees.find(e=>e.id===p.id);
  const data=employeeForManager(employee,p.employee,existing);
  if(existing?.role==='courier'&&data.role!=='courier'&&s.orders.some(o=>o.courier?.id===existing.id&&courierOutstanding(o)))throw Error('Сначала примите у курьера все деньги и возвраты');
  data.login=data.login.trim();
  if(s.employees.some(e=>e.login.toLowerCase()===data.login.toLowerCase()&&e.id!==p.id))throw Error("Такой логин уже существует");
  if(p.id&&(!existing||existing.version!==p.version))throw Error("Карточка сотрудника уже изменена");
  const eid=p.id||id("E-");
  const enabled=p.employee.accessEnabled!==false;
  if(user.employee&&eid===user.employee.id&&(data.role!==user.employee.role||!enabled))throw Error("Нельзя отключить собственный вход или изменить собственную роль");
  let passwordHash:string|undefined;
  if(personalAuth()){
   await ensureAuth();
   const account=await d.prepare('SELECT enabled FROM auth_accounts WHERE employee_id=?').bind(eid).first();
   if(p.employee.password)passwordHash=await hashPassword(p.employee.password);
   if(enabled&&!account&&!passwordHash)throw Error("Задайте пароль для включения входа сотрудника");
  }
  const saved=json({...data,id:eid,...(!p.id?{version:1}:{})});
  const statements=[p.id?d.prepare("UPDATE employees SET data=?,version=version+1 WHERE id=? AND version=?").bind(saved,eid,p.version):d.prepare("INSERT INTO employees(id,data) VALUES(?,?)").bind(eid,saved)];
  const guard="EXISTS(SELECT 1 FROM employees WHERE id=? AND data=? AND version=?)";
  const args=[eid,saved,p.id?p.version+1:1];
  if(personalAuth()){
   if(passwordHash)statements.push(d.prepare(`INSERT INTO auth_accounts(employee_id,password_hash,enabled) SELECT ?,?,? WHERE ${guard} ON CONFLICT(employee_id) DO UPDATE SET password_hash=excluded.password_hash,enabled=excluded.enabled`).bind(eid,passwordHash,enabled?1:0,...args));
   else statements.push(d.prepare(`UPDATE auth_accounts SET enabled=? WHERE employee_id=? AND ${guard}`).bind(enabled?1:0,eid,...args));
   if(passwordHash||!enabled||existing&&(existing.login!==data.login||existing.role!==data.role||existing.department!==data.department))statements.push(d.prepare(`DELETE FROM auth_sessions WHERE employee_id=? AND ${guard}`).bind(eid,...args));
  }
  const results=await d.batch(statements);if(!results[0].meta.changes)throw Error("Карточка сотрудника уже изменена");
  message="Сотрудник сохранён";
 }else if(p.action==="settings"){
  const retentionDays=z.number().int().min(1).max(365).parse(p.retentionDays);await d.prepare("UPDATE settings SET data=? WHERE id='main'").bind(json({retentionDays})).run();message="Срок применяется к новым закреплениям и заказам";
 }else if(p.action==="releaseExpired"){
  message="Правило К проверено автоматически";
 }else if(p.action==="normalizeImportedAddresses"){
  if(employee?.role!=="admin")throw new Error("Обработку запускает администратор");
  const saved=await d.prepare("SELECT data FROM settings WHERE id='dadata'").first<{data:string}>();const keys=saved?JSON.parse(saved.data):{};
  const candidates=s.clients.filter(c=>/\.xlsx · /i.test(c.source)&&(!c.addressProcessed||c.addressProcessingError)&&!Object.values(c.addressParts||{}).some(Boolean));
  let processed=0,review=0,failed=0;
  for(const c of candidates){
   const result=await cleanImportedAddress(c.address||c.city,keys);if(result.addressProcessingError){failed++;keys.token="";}
   const next={...c,...result};const e=ev(c.id,"",result.addressReview?"Импортированный адрес требует проверки · исходный текст сохранён":"Адрес из Excel разобран ДаДатой");
   const changes=await d.batch([d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?)").bind(e.id,c.id,"",now,json(e),c.id,c.version),d.prepare("UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=?").bind(json(next),c.id,c.version)]);
   if(changes[1].meta.changes){processed++;if(result.addressReview)review++;}
  }
  message=`Обработано: ${processed}. Требуют проверки: ${review}. Ошибки сервиса: ${failed}`;
 }else if(p.action==="import"){
  const rows=z.array(clientSchema).min(1).max(1000,"За один импорт — до 1000 строк").parse(p.rows);const phones=new Set(s.clients.map(c=>c.phone));const saved=await d.prepare("SELECT data FROM settings WHERE id='dadata'").first<{data:string}>();const keys=saved?JSON.parse(saved.data):{};let review=0,errors=0;const statements=[];let added=0,duplicates=0;
  for(const row of rows){ownerValid(row.owner);if(phones.has(row.phone)){duplicates++;continue;}phones.add(row.phone);const address=await cleanImportedAddress(row.address||row.city,keys);if(address.addressReview)review++;if(address.addressProcessingError){errors++;keys.token="";}const c:Client={...row,...address,id:id("C-"),assignedUntil:row.owner?assignedUntil():"",createdAt:now,version:1};statements.push(d.prepare("INSERT OR IGNORE INTO clients(id,phone,data) VALUES(?,?,?)").bind(c.id,c.phone,json(c)));const e=ev(c.id,"","Импорт клиента · "+c.source);statements.push(d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=?)").bind(e.id,c.id,"",now,json(e),c.id));added++;}
  // ponytail: bounded imports; background chunked jobs when files exceed 1000 clients.
  let actual=0;for(let i=0;i<statements.length;i+=50){const results=await d.batch(statements.slice(i,i+50));actual+=results.filter((_,j)=>j%2===0).reduce((n,r)=>n+r.meta.changes,0);}message=`Добавлено: ${actual}. Дубли: ${duplicates+added-actual}. Адресов требуют проверки: ${review}. Ошибки ДаДата: ${errors}`;
 }else throw new Error("Неизвестное действие");
 return Response.json({state:await responseState(user),message});
 }catch(e){console.error(e);const error=e instanceof z.ZodError?e.issues.map(x=>x.message).join("; "):e instanceof Error?e.message:"Не удалось сохранить";return Response.json({error:error.includes("UNIQUE")?"Клиент с таким телефоном уже есть в базе":error},{status:400});}
}

export const GET=authenticated(handleGET);
export const POST=authenticated(handlePOST);

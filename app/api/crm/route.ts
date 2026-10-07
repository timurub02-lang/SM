import {courierReminderStatements} from '@/lib/reminder-store';
import {baseTypes,baseSettingsSchema,initialBaseSettings} from '@/lib/base-policy';
import {reconcileOrderTimers,reconcileClients} from '@/lib/base-retention-store';
import {initBaseStorage} from '@/lib/base-storage';
import {moscowDate,normalizedPhone} from '@/lib/base-distribution';
import {orderSettings} from '@/lib/order-policy-store';
import {orderDataEditingEnabled} from '@/lib/order-policy';
import {orderRouting,assertRoutingSlot} from '@/lib/cdek-routing-store';
import {courierDoorRefusal,canHandleCourierDoor,applyCourierCommand,canEditCourierOrder,canEditRecalledCourierOrder,courierRecalledAtWarehouse,pauseCourierOperatorBudget,courierPhase,courierStage,courierDeadline,courierWarehouseReturn,cancelCourierWork,courierOutstanding} from '@/lib/courier';
import {initReminders,orderDecisionReminder,saveReminders,employeeReminders} from '@/lib/reminders';
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
import {addressPartsSchema,orderAddressWarnings} from "@/lib/address";
import {db} from "@/lib/db";
import {getChatGPTUser} from "@/app/chatgpt-auth";
import {deliveryChangedAfterHandoff,deliveryLabels,cdekReviewOnDeliveryChange,clientAssignment,draftDeadline,confirmationDeadline,reworkDeadlineFrom,validateReworkCall,hasActiveOrder,employeeForManager,canLogisticEditOrder,canAdminEditReturnedCdekOrder,orderEditingLocked,clientAddressFromOrder,deliverySchema,applyRetention,sourceSheet,clientSheet,seed,orderDatesForTransition,clientSchema,itemsSchema,employeeSchema,validateTransition,roles,type State,type Client,type Order,type Employee,type Event,type Status} from "@/lib/crm";
import {z} from "zod";
export const dynamic="force-dynamic";
const json=JSON.stringify;
async function identity(){const u=await getChatGPTUser();if(!u)throw new Error("Требуется вход в CRM");return u;}
async function readState(reconcile=true,extraClientId='',includeFree=false):Promise<State>{
 await initInventory();const d=db();await initBaseStorage(d);const tables=await Promise.all([d.prepare("SELECT data,version FROM clients WHERE ?=1 OR id=? OR COALESCE(json_extract(data,'$.owner'),'')<>'' OR EXISTS(SELECT 1 FROM orders WHERE orders.client_id=clients.id) ORDER BY id").bind(includeFree?1:0,extraClientId).all(),d.prepare("SELECT o.data,o.version,EXISTS(SELECT 1 FROM settings s WHERE s.id='cdek-shipment-' || o.id AND json_extract(s.data,'$.state') IN ('ready','deleting') AND json_extract(s.data,'$.number') IS NOT NULL) AS cdek_exported,EXISTS(SELECT 1 FROM settings s WHERE s.id='cdek-shipment-' || o.id AND json_extract(s.data,'$.state')='deleting') AS cdek_deleting,EXISTS(SELECT 1 FROM settings s WHERE s.id='cdek-shipment-' || o.id AND json_extract(s.data,'$.downloadedAt') IS NOT NULL) AS cdek_waybill_received FROM orders o ORDER BY o.id DESC").all(),d.prepare("SELECT data,version FROM employees ORDER BY id").all(),d.prepare("SELECT data FROM events ORDER BY at DESC").all(),d.prepare("SELECT data FROM settings WHERE id='main'").first<{data:string}>()]);
 const state:State={clients:tables[0].results.map((r:any)=>({...JSON.parse(r.data),version:r.version})),orders:tables[1].results.map((r:any)=>({...JSON.parse(r.data),version:r.version,cdekExported:!!r.cdek_exported||(JSON.parse(r.data).testOnly===true&&JSON.parse(r.data).cdekExported===true),cdekDeleting:!!r.cdek_deleting,cdekWaybillReceived:!!r.cdek_waybill_received})),employees:tables[2].results.map((r:any)=>({...JSON.parse(r.data),version:r.version})),events:tables[3].results.map((r:any)=>JSON.parse(r.data)),settings:tables[4]?JSON.parse(tables[4].data):{retentionDays:30}};
 state.settings.orderPolicy=(await orderSettings()).policy;
 if(reconcile){
  if(await reconcileOrderTimers(d,state.orders,state.events))return readState(true,extraClientId,includeFree);
  if(await reconcileClients(d,state.clients,state.orders))return readState(false,extraClientId,includeFree);

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
 const p=JSON.parse(raw);const d=db();const s=await readState(true,typeof (p.clientId||p.id)==='string'?(p.clientId||p.id):'',['deleteEmployee','import'].includes(p.action));const now=new Date().toISOString();const id=(prefix:string)=>prefix+crypto.randomUUID().slice(0,12);let message="Сохранено";
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
  const data=clientSchema.parse(p.client);ownerValid(data.owner);const baseType=z.enum(baseTypes).default("M").parse(p.baseType);
  if(employee.role==="department_head"&&data.owner&&!s.employees.some(e=>e.id===data.owner&&e.role==="operator"&&!!employee.department&&e.department===employee.department))throw Error("Выберите оператора своего отдела");
  const duplicateRow=await d.prepare("SELECT c.data,c.version FROM clients c JOIN client_phone_index p ON p.client_id=c.id WHERE p.phone=?").bind(normalizedPhone(data.phone)).first<{data:string;version:number}>();const duplicate:Client|undefined=duplicateRow?{...JSON.parse(duplicateRow.data),version:duplicateRow.version}:undefined;
  if(duplicate?.owner)throw Error("Клиент уже существует и закреплён за "+(s.employees.find(e=>e.id===duplicate.owner)?.login||duplicate.owner));
  if(duplicate&&["ЧС","ПВ"].includes(clientSheet(duplicate)))throw Error("Клиент находится на листе "+clientSheet(duplicate)+" и не участвует в раздаче");
  if(duplicate&&!data.owner)throw Error("Выберите оператора для передачи клиента");
  const savedBase=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first<{data:string}>();
  const firstSheet=(savedBase?baseSettingsSchema.parse(JSON.parse(savedBase.data).config):initialBaseSettings())[baseType].importSheet;
  const trial=data.owner?{trialUntil:new Date(Date.parse(now)+86400000).toISOString(),trialReturnSheet:duplicate?clientSheet(duplicate)||firstSheet:firstSheet,assignedUntil:new Date(Date.parse(now)+86400000).toISOString(),assignmentStartedAt:now,sheet:"К",returnSheet:duplicate?clientSheet(duplicate):firstSheet}:{};
  if(duplicate){
   const next={...duplicate,...trial,owner:data.owner};
   const r=await d.prepare("UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=? AND json_extract(data,'$.owner')=''").bind(json(next),duplicate.id,duplicate.version).run();
   if(!r.meta.changes)throw Error("Клиент уже изменён. Обновите данные");
   await eventSQL(ev(duplicate.id,"","Клиент передан оператору на 24 часа без заказа")).run();message="Клиент передан оператору";
  }else{
   const c:Client={...data,baseType,sheet:firstSheet,id:id("C-"),assignedUntil:"",createdAt:now,version:1,...trial};
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
   request={...request,status:z.enum(["approved","rejected"]).parse(p.decision),decidedAt:now,decidedBy:employee.id};message=request.status==="approved"?"Повторный заказ разрешён":"Запрос отклонён";
  }
  const decision=orderDecisionReminder({...c,orderRequest:request},s.employees);
  if(decision)await initReminders();
  const r=await d.batch([d.prepare("UPDATE clients SET data=json_set(data,'$.orderRequest',json(?)),version=version+1 WHERE id=? AND version=?").bind(json(request),c.id,c.version),...(decision?[d.prepare("INSERT OR IGNORE INTO reminders(employee_id,id,data,at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=? AND json_extract(data,'$.orderRequest.id')=? AND json_extract(data,'$.orderRequest.status')=? AND json_extract(data,'$.orderRequest.decidedAt')=?)").bind(request.actorId,decision.id,json(decision),decision.at,c.id,c.version+1,request.id,request.status,request.decidedAt)]:[])]);
  if(!r[0].meta.changes)throw Error("Клиент изменился. Повторите действие");
  await eventSQL(ev(c.id,"",message)).run();
 }else if(p.action==="createOrder"){
  const c=s.clients.find(c=>c.id===p.clientId);if(!c)throw new Error("Выберите клиента");
  if(employee?.role==="operator"&&c.owner!==employee.id)throw Error("Можно оформить заказ только своему клиенту");
  if(employee?.role==="department_head"&&!s.employees.some(e=>e.id===c.owner&&e.role==="operator"&&!!employee.department&&e.department===employee.department))throw Error("Клиент другого отдела");
  const approved=c.orderRequest?.status==="approved"&&c.orderRequest.manager===c.owner&&(c.orderRequest.actorId===employee?.id||employee?.role==="admin");
  if(hasActiveOrder(s.orders,c.id)&&!approved)throw Error("У клиента уже есть активный заказ. Запросите разрешение руководителя отдела");
  const items=itemsSchema.parse(p.items);const comment=z.string().max(3000).parse(p.comment||"");
  if(employee?.role==="operator"&&c.owner&&c.owner!==employee.id)throw new Error("Клиент закреплён за другим оператором");const manager=employee?.role==="operator"?employee.id:c.owner;ownerValid(manager);if(!manager)throw new Error("Сначала закрепите клиента за оператором");
  const o:Order={id:id("SM-"),clientId:c.id,delivery:deliverySchema.parse(p.delivery??""),addressParts:addressPartsSchema.optional().parse(p.addressParts??c.addressParts),address:z.string().trim().max(500).parse(p.address??c.address),status:"draft",draftHours:s.settings.orderPolicy!.draftHours,items,comment,reason:"",contact:"none",due:"",round:1,extra:false,createdAt:now,updatedAt:now,manager,logistic:"",version:1};
  const addressWarnings=orderAddressWarnings(o.address||'',o.addressParts);
  if(addressWarnings.length&&p.addressConfirmed!==true)throw Error('В адресе возможна ошибка: '+addressWarnings.map(w=>w.message).join(' ')+' Проверьте адрес и подтвердите создание заказа вручную.');
  const result=await d.batch([d.prepare("INSERT INTO orders(id,client_id,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?)").bind(o.id,c.id,json(o),c.id,c.version),d.prepare("UPDATE clients SET data=json_patch(json_set(json_remove(data,'$.orderRequest'),'$.owner',?,'$.assignedUntil',?,'$.assignmentStartedAt',?),json(?)),version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(manager,assignedUntil(),c.assignmentStartedAt||now,json(clientAddressFromOrder(o)||{}),c.id,o.id),eventSQL(ev(c.id,o.id,"Создан заказ · Оформление"+(addressWarnings.length?" · адрес проверен вручную, создание подтверждено несмотря на предупреждение: "+addressWarnings.map(w=>w.message).join(" "):"")+(clientAddressFromOrder(o)?" · адрес клиента обновлён из заказа":"")))]);if(!result[0].meta.changes)throw Error("Клиент изменился. Обновите данные перед оформлением");message="Заказ создан";
 }else if(["markPV","courierAccept","courierOutcome","courierWorkflow","receivePayment","saveManualDeliveryCost","returnToWarehouse","markPackingWaybill","updateWaybillComment","selectCdekTariff","updateDelivery","updateOrder","transition","contact","comment"].includes(p.action)){
  const o=s.orders.find(x=>x.id===p.id);if(!o)throw new Error("Заказ не найден");const c=s.clients.find(c=>c.id===o.clientId)!;if(!employee||(orderEditingLocked(employee,o)&&!(p.action==='updateOrder'&&canEditRecalledCourierOrder(o,employee))&&!(p.action==='courierWorkflow'&&['claimDoor','resolveDoor'].includes(p.operation)&&canHandleCourierDoor(o,employee,s.employees))&&!(employee.role==="courier"&&["courierAccept","courierOutcome","courierWorkflow","contact"].includes(p.action))&&!(isLogistic(employee.role)&&p.action==="updateOrder"&&canLogisticEditOrder(o))))throw new Error("Этот заказ доступен вам только для просмотра");if(o.cdekDeleting)throw Error("СДЭК обрабатывает удаление. Дождитесь подтверждения");let next={...o,updatedAt:now,_mutation:id("M-")};let text="";let cashReceipt:ReturnType<typeof d.prepare>[]=[];
  if(["updateOrder","updateDelivery"].includes(p.action)&&!orderDataEditingEnabled(employee.role,canEditRecalledCourierOrder(o,employee)?'rework':o.status,s.settings.orderPolicy))throw Error("Редактирование данных заказа отключено администратором");
  if(courierDoorRefusal(o)){
   if(!(p.action==='courierWorkflow'&&['claimDoor','resolveDoor'].includes(p.operation)||['comment','updateOrder'].includes(p.action)))throw Error('Отказ у двери: курьер ждёт окончательного ответа. Недозвон, перезвон и другие переходы недоступны');
   if(p.action==='updateOrder'&&o.courier!.doorRefusal!.claimedBy!==employee.id)throw Error('Сначала возьмите срочное обращение в работу');
  }
  if(o.status==="rework"&&!next.returnReason)next.returnReason=o.reason;
  if((["updateOrder","updateDelivery","selectCdekTariff","saveManualDeliveryCost"].includes(p.action)||isLogistic(employee?.role)&&p.action==="updateWaybillComment")){
   const shipment=await d.prepare("SELECT data FROM settings WHERE id=?").bind(`cdek-shipment-${o.id}`).first<{data:string}>();
   if(shipment&&JSON.parse(shipment.data).state!=="invalid")throw Error("Заказ уже выгружен или отправляется в СДЭК. Изменение доставки и корзины заблокировано");
  }
  if(p.action==="markPV"){
   if(employee.role!=='admin'||o.status!=='check')throw Error('Метка ПВ ставится администратором на этапе проверки');next.pv=z.boolean().parse(p.value);next.pvMarkedAt=next.pv?now:undefined;text=next.pv?'Заказ отмечен ПВ':'Метка ПВ снята';
  }else if(p.action==="courierAccept"||p.action==="courierWorkflow"){
   const command=z.object({action:z.enum(['courierAccept','courierWorkflow']),operation:z.enum(['confirm','toOperator','resume','recall','returnRecall','receiveRecall','requestRepack','doorRefusal','claimDoor','resolveDoor']).optional(),reason:z.string().trim().max(1000).optional(),confirmed:z.boolean().optional(),result:z.enum(['deliver','return']).optional()}).parse(p);
   const result=applyCourierCommand(o,command,employee,s.settings.orderPolicy!,now,s.employees);next={...result.order,_mutation:next._mutation};text=result.text;
  }else if(p.action==="courierOutcome"){
   if(!o.courier?.acceptedAt)throw Error('Сначала примите посылку у логиста');
   if(employee.role!=='courier'||o.courier?.id!==employee.id||o.delivery!=='moscow_courier'||courierStage(o)!=='delivery')throw Error('Этот заказ недоступен для действия курьера');
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
   if(!courierWarehouseReturn(o))throw Error("Заказ должен ожидать физического возврата на склад");
   if(o.warehouseReturnedAt)throw Error("Товар уже возвращён на склад");
   next.warehouseReturnedAt=now;text="Возврат на склад · товар принят, резерв освобождён";
  }else if(p.action==="markPackingWaybill"){
   if(courierRecalledAtWarehouse(o)&&o.status==='rework')throw Error('Заказ в работе у оператора. Дождитесь возврата на сборку');
   if(!employee||!["admin","logistic","chief_logistic"].includes(employee.role))throw Error("Нет доступа к накладным");
   if(o.courierRepackRequest&&!o.courierRepackRequest.completedAt)throw Error('Сначала оператор или администратор должен сохранить исправленный заказ после приёма посылки');
   next.packingWaybillAt=o.packingWaybillAt||now;text="Подготовлена накладная на сборку";
  }else if(p.action==="updateWaybillComment"){
   if(!employee||!["operator","logistic","chief_logistic","admin","redemption"].includes(employee.role))throw new Error("Нет доступа к комментарию заказа");
   next.waybillComment=z.string().trim().max(3000).parse(p.text);text="Изменён комментарий заказа для внутреннего бланка";
  }else if(p.action==="selectCdekTariff"){
   if(!employee||!canManageDelivery(employee.role,o.status))throw new Error("Выбор тарифа доступен только логисту до отправки");
   const row=await d.prepare("SELECT data FROM settings WHERE id=?").bind(`cdek-quote-${o.id}`).first<{data:string}>();const quote=row?JSON.parse(row.data):null;
   if(!quote||quote.id!==p.quoteId||Date.now()-Date.parse(quote.calculatedAt)>3600000||JSON.stringify(quote.items)!==JSON.stringify(o.items)||quote.address!==o.address||JSON.stringify(quote.addressParts)!==JSON.stringify(o.addressParts))throw new Error("Расчёт устарел. Рассчитайте доставку повторно");
   assertRoutingSlot(await orderRouting(o),quote.params.slot);
   const tariff=quote.tariffs.find((t:any)=>t.code===p.code);if(!tariff)throw new Error("Тариф не найден в расчёте СДЭК");
   next.delivery=quote.params.delivery;next.cdekTariff={...tariff,account:quote.account,slot:quote.params.slot,calculatedAt:quote.calculatedAt,params:quote.params};text=`Выбран тариф СДЭК: ${tariff.name} (${tariff.code}), ${tariff.amount} ₽ · ${quote.account}`;
  }else if(p.action==="updateDelivery"){
   if(!employee||!canManageDelivery(employee.role,o.status))throw new Error("Способ доставки выбирает логист до отправки заказа");
   next.delivery=deliverySchema.parse(p.delivery);text="Изменён способ доставки";
  }else if(p.action==="updateOrder"){
   if(!isLogistic(employee.role)&&!["draft","rework"].includes(o.status)&&!canEditRecalledCourierOrder(o,employee)&&!(employee.role==="admin"&&canAdminEditReturnedCdekOrder(o)))throw new Error("Корзину можно менять на этапе оформления или возврата оператору");
   next.delivery=deliverySchema.parse(p.delivery??o.delivery??"");next.addressParts=addressPartsSchema.optional().parse(p.addressParts??(p.address===undefined||p.address===o.address?o.addressParts:undefined));next.address=z.string().trim().max(500).parse(p.address??o.address??c.address);next.items=isLogistic(employee.role)?o.items:itemsSchema.parse(p.items);next.comment=z.string().max(3000).parse(p.comment||"");text=isLogistic(employee.role)?"Логист уточнил доставку, адрес и комментарий заказа":"Обновлены доставка, адрес, корзина и комментарий менеджера";
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
    if(o.courierRepackRequest&&!o.courierRepackRequest.completedAt)throw Error('Ожидаются правки корзины после пересборки');
    if(!o.items.length)throw Error('В заказе нет товаров');
    next.courier={id:courier.id,name:courier.name,assignedAt:now,amount:total(o),phase:"pending",operatorBudgetMs:o.courierRecall?.operatorBudgetMs};
   }
   if(to==="extra"&&o.status!=="rework"){delete next.finalHandoffAt;delete next.reworkDeadline;delete next.returnReason;}if(o.status==="rework"&&["confirm","extra"].includes(to)){if(p.finalHandoffConfirmed!==true)throw Error("Подтвердите завершение работы с заказом");next.finalHandoffAt=now;next.finalConfirmHours=s.settings.orderPolicy!.finalHours;}if(["confirm","extra"].includes(to)&&o.status!=="rework"){next.confirmationStartedAt=now;next.confirmationHours=to==="extra"?s.settings.orderPolicy!.extraConfirmationHours:s.settings.orderPolicy!.confirmationHours;}
   delete next.noAnswerDeadline;Object.assign(next,orderDatesForTransition(o,to,now));next.status=to;next.noAnswerDeadline=confirmationDeadline(next);if(to==="rework"){next.returnReason=reason;next.reworkHours=s.settings.orderPolicy!.reworkHours;next.reworkDeadline=reworkDeadlineFrom(now,next.reworkHours);}if(to!==o.status)delete next.warehouseReturnedAt;next.reason=reason;next.contact="none";next.due="";if(to==="extra")next.extra=true;if(o.status==="rework"&&["confirm","extra"].includes(to))next.round++;
   if(to==='shipping'&&o.delivery==='moscow_courier'){next.status='packing';delete next.shippedAt;delete next.finalHandoffAt;delete next.reworkDeadline;}
   if(courierRecalledAtWarehouse(o)){
    if(to==='rework'){
     const budget=o.courierRecall!.operatorBudgetMs===undefined?(s.settings.orderPolicy!.reworkHours===null?null:s.settings.orderPolicy!.reworkHours!*3600000):o.courierRecall!.operatorBudgetMs;
     next.courierRecall={...o.courierRecall!,operatorBudgetMs:budget,operatorStartedAt:now};
     next.reworkHours=budget===null?null:budget/3600000;
     next.reworkDeadline=budget===null?undefined:new Date(Date.parse(now)+budget).toISOString();
     delete next.packingWaybillAt;delete next.finalHandoffAt;delete next.contactAuthor;next.extra=false;
    }else if(o.status==='rework'&&to==='packing'){
     if(o.courierRepackRequest&&!o.courierRepackRequest.completedAt)throw Error('Сначала сохраните исправленную корзину для пересборки');
     pauseCourierOperatorBudget(next,now);delete next.packingWaybillAt;delete next.returnReason;delete next.contactAuthor;next.round++;
    }
   }
   if(to==='refused')cancelCourierWork(next,now);
   if(next.confirmationRequest&&!next.confirmationRequest.handledAt)next.confirmationRequest={...next.confirmationRequest,handledAt:now};
   if(p.confirmationAt){
    if(o.status!=="draft"||to!=="confirm"||!["operator","admin"].includes(employee.role))throw Error("Время первого подтверждения задаётся при первой передаче оператором логисту");
    const at=z.string().datetime().parse(p.confirmationAt);
    if(moscowDate(new Date(at))!==moscowDate(new Date(now)))throw Error("Подтверждение ко времени можно назначить только на сегодня по Москве");
    if(Date.parse(at)<=Date.parse(now))throw Error("Выберите будущее время подтверждения");
    if(next.noAnswerDeadline&&Date.parse(at)>Date.parse(next.noAnswerDeadline))throw Error("Подтверждение нельзя назначить позже срока автоотмены: "+new Date(next.noAnswerDeadline).toLocaleString("ru-RU",{timeZone:"Europe/Moscow"})+" МСК");
    next.confirmationRequest={at,by:employee.id};
   }
   if(isLogistic(employee?.role))next.logistic=employee.id;
   const labels=await import("@/lib/crm");text=`${labels.statuses[o.status]} → ${labels.statuses[to]}${reason?" · "+reason:""}`;
   if(courierRecalledAtWarehouse(o)&&['rework','packing'].includes(to))text+=' · После пересборки · посылка на складе';
   if(to==='shipping'&&o.delivery==='moscow_courier')text="Передан курьеру · ожидает приёма посылки · заказ остаётся Принят";
   if(p.confirmationAt)text+=" · Просил подтверждения ко времени: "+new Date(next.confirmationRequest!.at).toLocaleString("ru-RU",{timeZone:"Europe/Moscow"})+" МСК · по просьбе клиента";
  }else if(p.action==="contact"){
   if(courierRecalledAtWarehouse(o)&&o.status==='rework'&&!['admin','operator'].includes(employee.role))throw Error('Заказ после пересборки находится в работе у оператора');
   if(o.courier){
    const phase=courierPhase(o);
    if(!(employee.role==='courier'&&o.courier.id===employee.id&&phase==='confirmation'||['admin','operator'].includes(employee.role)&&o.status==='rework'))throw Error('Звонок доступен только сотруднику, у которого заказ сейчас в работе');
   }else if(!["draft","confirm","rework","extra","pickup"].includes(o.status))throw new Error("Звонок недоступен на этом этапе");
   if(next.confirmationRequest&&!next.confirmationRequest.handledAt)next.confirmationRequest={...next.confirmationRequest,handledAt:now};
   next.contact=z.enum(["missed","callback"]).parse(p.contact);next.reason=z.string().trim().min(1,"Укажите причину").max(1000).parse(p.reason);
   next.contactAuthor={id:employee.id,name:employee.name,at:now};
   if(employee.role==='courier'&&next.contact==='missed'&&p.due&&moscowDate(new Date(z.string().datetime().parse(p.due)))!==moscowDate())throw Error('Повторный звонок после недозвона назначается только на сегодня по Москве');
   next.noAnswerDeadline=courierDeadline(o)||confirmationDeadline(o);
   if(p.due){const due=z.string().datetime().parse(p.due);validateReworkCall(o,due);const deadline=draftDeadline(o);if(deadline&&Date.parse(due)>Date.parse(deadline))throw Error("Звонок нельзя назначить позже срока оформления: "+new Date(deadline).toLocaleString("ru-RU",{timeZone:"Europe/Moscow"})+" МСК");if(next.noAnswerDeadline&&Date.parse(due)>Date.parse(next.noAnswerDeadline))throw Error("Звонок нельзя назначить позже срока подтверждения");if(Date.parse(due)<=Date.now())throw new Error("Выберите будущее время звонка");next.due=due;}else{if(employee.role==='courier')throw Error('Укажите время следующего звонка');if(next.contact==="callback")throw new Error("Для перезвона нужно время звонка");next.due="";}
   if(isLogistic(employee?.role))next.logistic=employee.id;
   text=`${next.contact==="missed"?"Недозвон":"Перезвон"}: ${next.reason}${next.due?" · "+new Date(next.due).toLocaleString("ru-RU",{timeZone:"Europe/Moscow"})+" МСК":""}`;
  }else{text="Комментарий: "+z.string().trim().min(1).max(3000).parse(p.text);}
  if(deliveryChangedAfterHandoff(o,next.delivery)){
   next.deliveryChange={from:o.delivery!,to:next.delivery!,at:now,by:employee.id,name:employee.name};
   text+=` · Способ доставки изменён: ${deliveryLabels[o.delivery!]} → ${deliveryLabels[next.delivery!]}`;
  }
  if(o.status==='extra'&&o.delivery!=='moscow_courier'&&next.delivery==='moscow_courier'&&['admin','logistic','chief_logistic'].includes(employee.role)){
   next.status='packing';next.extra=false;next.contact='none';next.due='';next.reason='';
   delete next.confirmationStartedAt;delete next.confirmationHours;delete next.noAnswerDeadline;delete next.finalHandoffAt;delete next.reworkDeadline;delete next.returnReason;delete next.packingWaybillAt;
   if(next.confirmationRequest&&!next.confirmationRequest.handledAt)next.confirmationRequest={...next.confirmationRequest,handledAt:now};
   text+=' · Курьер Москва → Новый · заказ направлен на сборку, следующее подтверждение выполнит курьер';
  }
  if(cdekReviewOnDeliveryChange(o,next.delivery)){
   if(p.adminReviewConfirmed!==true)throw Error("Для доставки СДЭК нужна проверка администратора. Подтвердите смену доставки и передачу заказа на проверку.");
   next.status="check";next.extra=false;next.contact="none";next.due="";next.reason="";
   delete next.adminReviewedAt;delete next.confirmationStartedAt;delete next.confirmationHours;delete next.noAnswerDeadline;delete next.finalHandoffAt;delete next.reworkDeadline;delete next.returnReason;
   if(next.confirmationRequest&&!next.confirmationRequest.handledAt)next.confirmationRequest={...next.confirmationRequest,handledAt:now};
   if(isLogistic(employee.role))next.logistic=employee.id;
   text+=" · Доставка изменена на СДЭК. Заказ передан администратору на проверку";
  }
  if(p.action==='updateOrder'&&canEditRecalledCourierOrder(o,employee)&&next.delivery!==o.delivery)throw Error('При пересборке заказа курьера способ доставки не меняется');
  if(p.action==='updateOrder'&&canEditRecalledCourierOrder(o,employee)&&o.courierRepackRequest&&!o.courierRepackRequest.completedAt){
   next.courierRepackRequest={...o.courierRepackRequest,completedAt:now};text+=' · правки для пересборки сохранены';
  }
  if(p.action==="updateOrder"){
   const addressWarnings=orderAddressWarnings(next.address||'',next.addressParts);
   if(addressWarnings.length&&p.addressConfirmed!==true)throw Error('В адресе возможна ошибка: '+addressWarnings.map(w=>w.message).join(' ')+' Проверьте адрес и подтвердите сохранение заказа вручную.');
   if(addressWarnings.length)text+=' · адрес проверен вручную, сохранение подтверждено несмотря на предупреждение: '+addressWarnings.map(w=>w.message).join(' ');
  }
  if(o.courier&&p.action==='updateOrder'&&canEditCourierOrder(o,employee)){
   if(next.delivery!==o.delivery)throw Error('После передачи курьеру нельзя менять способ доставки. Сначала отзовите посылку.');
   const contents=(items:Order['items'])=>JSON.stringify(items.map(({name,quantity})=>({name,quantity})));
   if(contents(next.items)!==contents(o.items))throw Error('Для изменения товара или количества сначала отзовите посылку на пересборку.');
   next.courier={...o.courier,amount:total(next)};
   text+=' · сумма под отчётом курьера обновлена: '+next.courier.amount+' ₽';
  }
  if(o.courier&&!(p.action==='updateOrder'&&canEditCourierOrder(o,employee))&&['updateOrder','updateDelivery','saveManualDeliveryCost','selectCdekTariff','markPackingWaybill','updateWaybillComment'].includes(p.action))throw Error('Заказ уже передан курьеру. Данные отправления зафиксированы');
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
  const courierNotices=await courierReminderStatements(d,o,next,e,next._mutation,s.employees);
  const result=await d.batch([d.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM settings WHERE id='cdek-shipment-' || orders.id AND json_extract(data,'$.state')='deleting')"+((["updateOrder","updateDelivery","selectCdekTariff","saveManualDeliveryCost"].includes(p.action)||isLogistic(employee?.role)&&p.action==="updateWaybillComment")?" AND NOT EXISTS(SELECT 1 FROM settings WHERE id='cdek-shipment-' || orders.id AND json_extract(data,'$.state')<>'invalid')":"")).bind(json(next),o.id,p.version),d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(e.id,c.id,o.id,e.at,json(e),o.id,next._mutation),...(addressPatch?[d.prepare("UPDATE clients SET data=json_patch(data,json(?)),version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)").bind(json(addressPatch),c.id,o.id,next._mutation)]:[]),...cashReceipt,...courierNotices]);
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

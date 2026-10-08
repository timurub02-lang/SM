import {draftDeadline,confirmationDeadline,scheduledCalls,canReceivePayment,isLogistic,type State,type Employee,type Order} from './crm.ts';
import {courierDoorRefusal,canHandleCourierDoor,courierDoorNoticeId,courierDoorPhase,courierStage,courierPhase,courierDeadline,courierWarehouseReturn,courierPendingAction} from './courier.ts';
import {seesOrder,ownsClient} from './permissions.ts';
import type {Reminder} from './reminders.ts';

// Tasks describe current work, not unread events. One task per order, regardless of its history.
export function employeeTasks(s:State,e:Employee,now=Date.now()):Reminder[]{
 const tasks:Reminder[]=[],clients=new Map(s.clients.map(c=>[c.id,c])),staff=new Map(s.employees.map(x=>[x.id,x]));
 const calls=new Map(scheduledCalls(s.orders,e).map(o=>[o.id,o]));
 const logistic=isLogistic(e.role),head=e.role==='department_head',admin=e.role==='admin';
 function add(o:Order,code:string,title:string,due?:string,at=o.updatedAt,kind:Reminder['kind']='task',text=''){
  tasks.push({kind,id:`task:${o.id}:${code}`,orderId:o.id,clientId:o.clientId,title,text:[clients.get(o.clientId)?.name,head?'Контроль отдела · '+(staff.get(o.manager)?.name||'Оператор'):undefined,text].filter(Boolean).join(' · '),at,due});
 }
 for(const o of s.orders){
  if(!seesOrder(e,o,s.employees)||o.cdekDeleting)continue;
  const door=courierDoorRefusal(o),phase=courierPhase(o),stage=courierStage(o);
  if(door){
   if(canHandleCourierDoor(o,e,s.employees)){
    const late=courierDoorPhase(o,now).endsWith('overdue');
    add(o,courierDoorNoticeId(o,now),late?'Срочно: курьер у двери — нужна помощь':door.claimedAt?'Дайте ответ курьеру у двери':'Возьмите отказ у двери в работу',door.decisionDueAt,door.at,'courier-door',door.claimedName?'В работе: '+door.claimedName+' · '+o.courier?.workReason:o.courier?.workReason);
   }
   continue; // The courier is waiting for an answer, not responsible for resolving this task.
  }
  const repack=o.courierRepackRequest&&!o.courierRepackRequest.completedAt;
  if(repack){
   if(!o.courier&&['packing','rework'].includes(o.status)&&(e.id===o.manager||head||admin))add(o,'repack-edit','Внесите правки для пересборки',o.reworkDeadline,o.courierRecall?.completedAt||o.updatedAt);
   else if(o.courier&&phase==='operator'&&logistic)add(o,'repack-recall','Запросите посылку на пересборку',undefined,o.courierRepackRequest!.at,'task',o.courierRepackRequest!.reason);
   if(!o.courier||phase==='operator')continue;
  }
  if(calls.has(o.id)){
   add(o,'call:'+o.due,Date.parse(o.due)<=now?'Пора позвонить клиенту':'Запланирован звонок',o.due,o.contactAuthor?.at||o.updatedAt,'call',[o.reason,o.contactAuthor?.name?'Кто назначил: '+o.contactAuthor.name:''].filter(Boolean).join(' · '));continue;
  }
  if(e.role==='operator'||head){
   if(o.status==='draft')add(o,'draft','Передайте заказ логисту',draftDeadline(o),o.createdAt,'draft','Заказ ещё на оформлении');
   if(o.status==='rework')add(o,'rework','Доработайте возвращённый заказ',o.reworkDeadline,o.courier?.operatorStartedAt||o.updatedAt,'task',o.returnReason||o.reason);
   continue;
  }
  if(admin){if(o.status==='check')add(o,'check','Проверьте заказ перед сборкой');continue;}
  if(e.role==='courier'){
   const action=courierPendingAction(o);
   if(action)add(o,phase||stage,action.title,undefined,action.at,'task',phase==='recall'?o.courier?.recall?.reason:stage==='return'?o.reason:'');
   else if(stage==='confirmation')add(o,'confirmation','Подтвердите заказ у клиента',courierDeadline(o),o.courier?.acceptedAt);
   else if(stage==='delivery')add(o,'delivery','Доставьте заказ клиенту',undefined,o.courier?.confirmedAt);
   else if(stage==='money')add(o,'money','Сдайте деньги логисту',undefined,o.redeemedAt);
   continue;
  }
  if(logistic){
   if(phase==='recall_returned'){add(o,'receive-recall','Подтвердите приём посылки на пересборку',undefined,o.courier?.recall?.returnedAt);continue;}
   if(canReceivePayment(o,e.role)){add(o,'receive-money','Примите деньги по заказу',undefined,o.redeemedAt);continue;}
   if(courierWarehouseReturn(o)&&!o.warehouseReturnedAt){add(o,'receive-return','Примите возвращённую посылку на склад',undefined,o.returnedAt||o.cancelledAt,'task',o.reason);continue;}
   if(o.courier)continue;
   if(['confirm','extra'].includes(o.status)){add(o,o.status,o.status==='extra'?'Повторно подтвердите заказ':'Подтвердите заказ',confirmationDeadline(o),o.confirmationStartedAt);continue;}
   if(o.cdekExported&&!o.cdekWaybillReceived&&['packing','phone','shipping','pickup'].includes(o.status)){add(o,'cdek-waybill','Получите накладную СДЭК');continue;}
   if(!o.cdekExported&&['packing','phone'].includes(o.status))add(o,o.packingWaybillAt?'dispatch':'assembly',o.packingWaybillAt?'Передайте собранный заказ в доставку':'Подготовьте заказ к сборке');
  }else if(e.role==='redemption'&&o.status==='pickup'&&!o.courier)add(o,'redemption','Свяжитесь с клиентом для выкупа');
 }
 for(const c of s.clients){
  const r=c.orderRequest;if(!r||!ownsClient(e,c,s.employees))continue;
  if(r.status==='pending'&&(admin||head&&e.department===r.department))tasks.push({kind:'task',id:'task:request:'+r.id,requestId:r.id,clientId:c.id,title:'Решите запрос на дополнительный заказ',text:c.name,at:r.at});
  if(r.status==='approved'&&r.actorId===e.id)tasks.push({kind:'order-decision',decision:'approved',id:'task:decision:'+r.id,requestId:r.id,clientId:c.id,title:'Оформите разрешённый дополнительный заказ',text:c.name,at:r.decidedAt||r.at});
 }
 return tasks.sort((a,b)=>Number(b.kind==='courier-door')-Number(a.kind==='courier-door')||(Date.parse(a.due||'')||Infinity)-(Date.parse(b.due||'')||Infinity)||a.at.localeCompare(b.at));
}

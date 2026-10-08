import type {Order,Employee} from './crm.ts';
import type {Reminder} from './reminders.ts';
import {defaultOrderPolicy,type OrderPolicy} from './order-policy.ts';
import {isDepartmentOrder} from './department-orders.ts';

export type CourierRecall={requestedAt:string;by:string;name:string;reason:string;returnedAt?:string;completedAt?:string;operatorBudgetMs?:number|null;operatorStartedAt?:string};
export const courierRecalledAtWarehouse=(o:Pick<Order,'delivery'|'courier'|'courierRecall'>)=>o.delivery==='moscow_courier'&&!o.courier&&!!o.courierRecall?.returnedAt&&!!o.courierRecall.completedAt;
export type CourierAssignment={
 recall?:CourierRecall;
 id:string;name:string;assignedAt:string;acceptedAt?:string;amount:number;
 // 'logistic' is read only to migrate orders from the retired queue.
 phase?:'pending'|'confirmation'|'logistic'|'operator'|'resume'|'delivery'|'recall'|'recall_returned';
 workStartedAt?:string;workHours?:number|null;
 confirmedBy?:'courier'|'logistic'|'operator'|'department_head';confirmedAt?:string;
 workReason?:string;atDoor?:boolean;
 doorRefusal?:{at:string;claimDueAt:string;decisionDueAt:string;claimedAt?:string;claimedBy?:string;claimedName?:string;resolvedAt?:string;result?:'deliver'|'return'};
 operatorBudgetMs?:number|null;operatorStartedAt?:string;
 postponement?:{at:string;reason:string;requestedAt:string;state:'pending'|'approved'|'rejected';decidedAt?:string;by?:string;name?:string};
};
export const courierDoorRefusal=(o:Order|undefined)=>o?.delivery==='moscow_courier'&&o.status==='rework'&&o.courier?.phase==='operator'&&o.courier.doorRefusal&&!o.courier.doorRefusal.resolvedAt?o.courier.doorRefusal:undefined;
export function canHandleCourierDoor(o:Order,e:Pick<Employee,'id'|'role'|'department'>,staff:Employee[]=[]){
 return !!courierDoorRefusal(o)&&(e.role==='admin'||e.role==='operator'&&o.manager===e.id||e.role==='department_head'&&!!e.department&&staff.some(x=>x.id===o.manager&&x.role==='operator'&&x.department===e.department));
}
export function courierDoorPhase(o:Order,now=Date.now()){
 const d=courierDoorRefusal(o);if(!d)return '';
 if(now>=Date.parse(d.decisionDueAt)||o.reworkDeadline&&now>=Date.parse(o.reworkDeadline))return 'decision-overdue';
 return d.claimedAt?'working':now>=Date.parse(d.claimDueAt)?'claim-overdue':'new';
}
export function courierDoorNoticeId(o:Order,now=Date.now()){
 const d=courierDoorRefusal(o);return d?`courier-door:${o.id}:${d.at}:${d.claimedAt||''}:${courierDoorPhase(o,now)}`:'';
}
export const courierOperatorReasons=['Недозвон','Клиент отказывается','У клиента вопросы по заказу','Клиент отказывается — дорого','Клиент отказывается — не разрешают родственники','Клиент отказывается — запрещает врач','У клиента вопросы — стоимость заказа','У клиента вопросы — по продукту','Не проходит по срокам доставки'] as const;
export const courierConfirmationTabs=[['new','Новый'],['expiring','Скоро вернётся оператору'],['missed','Недозвон'],['callback','Перезвон']] as const;
export function courierPhase(o:Order){
 if(o.delivery!=='moscow_courier'||!o.courier)return undefined;
 return o.courier.phase||(o.courier.acceptedAt?'delivery':'pending');
}
export function courierStage(o:Order){
 if(!o.courier||o.delivery!=='moscow_courier')return 'none';
 if(o.status==='redeemed')return o.paymentReceivedAt?'settled':'money';
 if(o.status==='returned'||o.status==='refused')return o.warehouseReturnedAt?'settled':o.courier.acceptedAt?'return':'none';
 const phase=courierPhase(o);
 if(phase==='recall'||phase==='recall_returned')return 'return';
 return phase==='confirmation'?'confirmation':phase==='logistic'||phase==='operator'?'waiting':phase==='pending'||phase==='resume'?'pending':'delivery';
}
export function courierBalance(orders:Order[],id:string){
 let parcels=0,cash=0,pending=0;
 for(const o of orders){if(o.courier?.id!==id)continue;const stage=courierStage(o),amount=Math.round(o.courier.amount*100);if(stage==='money')cash+=amount;else if(!['none','settled'].includes(stage)){if(o.courier.acceptedAt)parcels+=amount;else pending+=amount;}}
 return {pending:pending/100,parcels:parcels/100,cash:cash/100,total:(parcels+cash)/100};
}
export const courierOutstanding=(o:Order)=>!['none','settled'].includes(courierStage(o));
export const courierWarehouseReturn=(o:Order)=>o.status==='returned'||o.delivery==='moscow_courier'&&o.status==='refused'&&!!o.courier?.acceptedAt;
export function courierPendingAction(o:Order){
 const phase=courierPhase(o),stage=courierStage(o);
 if(phase==='recall')return {at:o.courier!.recall!.requestedAt,title:'Логист запросил возврат посылки на сборку'};
 if(phase==='recall_returned')return undefined;
 const at=stage==='pending'?(phase==='resume'?o.courier?.confirmedAt:o.courier?.assignedAt):stage==='return'?(o.returnedAt||o.cancelledAt):undefined;
 return at?{at,title:stage==='return'?'Верните посылку на склад':phase==='resume'?'Продолжите доставку — клиент готов выкупить заказ':'Примите посылку у логиста'}:undefined;
}
export function courierReminderNeedsAction(r:Reminder,o:Order|undefined,now=Date.now()){
 if(r.kind==='courier-door')return !r.resolved&&!!o&&r.id===courierDoorNoticeId(o,now);
 if(r.kind==='courier-receipt')return false; // Receipt is information; no acknowledgement is needed.
 if(r.resolved||!o?.courier||o.delivery!=='moscow_courier')return false;
 const phase=courierPhase(o),stage=courierStage(o);
 if(r.kind==='call')return phase==='confirmation'&&stage==='confirmation'&&!!r.due&&o.due===r.due&&['missed','callback'].includes(o.contact);
 if(r.kind==='courier-warning')return phase==='confirmation'&&courierDeadline(o)===r.due;
 if(r.kind==='courier-delivery')return stage==='delivery'&&o.courier.postponement?.state==='approved'&&o.courier.postponement.at===r.due&&Date.parse(r.due)<=now;
 if(r.kind!=='courier')return false;
 const started=courierPendingAction(o)?.at;
 return !!started&&Date.parse(r.at)>=Date.parse(started);
}
export function courierMissedCallTime(time:string,now=Date.now()){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Укажите время следующего звонка');
 const today=new Date(now+3*3600000).toISOString().slice(0,10);
 const due=Date.parse(today+'T'+time+':00+03:00');
 if(due<=now)throw Error('Выберите время позже текущего. Повторный звонок после недозвона назначается на сегодня по Москве.');
 return new Date(due).toISOString();
}
export function courierDeadline(o:Order){
 const c=o.courier;
 if(o.delivery!=='moscow_courier'||!c||c.phase!=='confirmation'||['redeemed','returned','refused'].includes(o.status)||!c.workStartedAt||c.workHours===null)return undefined;
 return new Date(Date.parse(c.workStartedAt)+(c.workHours??48)*3600000).toISOString();
}
export function courierConfirmationStage(o:Order,now=Date.now(),policy:OrderPolicy=defaultOrderPolicy){
 if(o.contact!=='none'&&o.due&&Date.parse(o.due)>now)return o.contact;
 if(o.due&&Date.parse(o.due)<=now)return 'new';
 const deadline=courierDeadline(o);
 if(deadline&&Date.parse(deadline)-now<=policy.courierWarningHours*3600000)return 'expiring';
 return o.contact==='none'?'new':o.contact;
}
export function courierTimeLeft(deadline:string,now=Date.now()){
 const minutes=Math.max(0,Math.ceil((Date.parse(deadline)-now)/60000));
 return `${Math.floor(minutes/60)} ч ${minutes%60} мин`;
}
export function courierWaitingSince(o:Order,now=Date.now()){
 const minutes=Math.max(0,Math.floor((now-Date.parse(o.courier!.assignedAt))/60000));
 return `${Math.floor(minutes/1440)} д ${Math.floor(minutes%1440/60)} ч ${minutes%60} мин`;
}
export function courierLabel(o:Order){
 const stage=courierStage(o),c=o.courier;
 if(o.delivery!=='moscow_courier')return '';
 if(!c){
  if(o.status==='refused')return 'Заказ отменён';
  if(o.status==='redeemed')return o.paymentReceivedAt?'Деньги приняты логистом':'Оплачен · ожидается приём денег';
  if(o.status==='returned')return o.warehouseReturnedAt?'Возврат принят на склад':'Окончательный возврат';
  if(o.status==='rework')return courierRecalledAtWarehouse(o)?'Заказ в работе у оператора · возврат после пересборки':o.extra?'Заказ в работе у оператора · возврат с повторного подтверждения логистом':'Заказ в работе у оператора · возврат с первого подтверждения логистом';
  if(o.status==='packing'||o.status==='phone')return o.packingWaybillAt?'Накладная на сборку получена':courierRecalledAtWarehouse(o)?'На пересборке у логиста':'На сборке у логиста';
  if(o.status==='draft')return 'Оформляет оператор';
  if(o.status==='confirm')return 'Первое подтверждение · логист';
  if(o.status==='extra')return 'Повторное подтверждение · логист';
  if(o.status==='check')return 'На проверке у администратора';
  return 'У курьера · доставка (2-й этап)';
 }
 if(c.phase==='recall')return 'Отозван логистом · вернуть посылку на сборку';
 if(c.phase==='recall_returned')return 'Передано логисту · ожидает подтверждения приёма';
 if(stage==='return')return o.status==='refused'?'Отменён · вернуть посылку на склад':'Окончательный возврат · вернуть на склад';
 if(stage==='settled')return o.paymentReceivedAt?'Деньги приняты логистом':'Посылка принята на склад';
 if(stage==='money')return 'Оплачен · деньги у курьера';
 if(c.phase==='resume')return c.confirmedBy==='department_head'?'Подтверждено руководителем · клиент готов выкупить заказ':c.confirmedBy==='operator'?'Подтверждено оператором · клиент готов выкупить заказ':'Подтверждено логистом · клиент ожидает заказ';
 if(stage==='pending')return 'Ожидает приёма курьером';
 if(stage==='confirmation')return 'У курьера на подтверждении · 1-й этап';
 if(courierDoorRefusal(o))return 'Отказ у двери · курьер ждёт решения';
 if(stage==='waiting')return c.phase==='operator'?(c.atDoor?'Заказ в работе у оператора · возврат с доставки (отказ у двери)':(o.shippedAt?'Заказ в работе у оператора · возврат с доставки':'Заказ в работе у оператора · возврат с подтверждения курьером')):'В работе у логиста · посылка у курьера';
 if(c.postponement?.state==='approved')return 'Доставка согласована ко времени';
 return 'У курьера · доставка (2-й этап)';
}
export function courierParcelLocation(o:Order){
 if(o.status==='redeemed')return 'Доставлена клиенту';
 if(o.warehouseReturnedAt||courierRecalledAtWarehouse(o))return 'На складе';
 if(o.courier){
  if(!o.courier.acceptedAt)return 'Приём курьером не подтверждён';
  if(o.courier.phase==='recall_returned')return 'Передана логисту · приём ещё не подтверждён';
  return 'У курьера';
 }
 if(['shipping','pickup'].includes(o.status))return 'У Курьера'; // Existing deliveries without an assignment.
 return ['packing','phone'].includes(o.status)?'На сборке у логиста':'Ещё не передана курьеру';
}
function clearCall(o:Order){o.contact='none';o.due='';delete o.contactAuthor;delete o.noAnswerDeadline;}
function stopCourierClock(o:Order){if(o.courier){delete o.courier.workStartedAt;delete o.courier.workHours;}}
export function courierToOperator(order:Order,reason:string,policy:OrderPolicy,at:string):Order{
 const o={...order,courier:{...order.courier!},status:'rework' as const,reason,returnReason:reason,updatedAt:at,extra:false};
 const c=o.courier;
 if(c.operatorBudgetMs===undefined){c.operatorBudgetMs=policy.reworkHours===null?null:policy.reworkHours*3600000;o.reworkHours=policy.reworkHours;}
 c.phase='operator';c.workReason=reason;c.operatorStartedAt=at;
 if(c.postponement&&c.postponement.state!=='rejected')c.postponement={...c.postponement,state:'rejected',decidedAt:at};
 o.reworkDeadline=c.operatorBudgetMs===null?undefined:new Date(Date.parse(at)+c.operatorBudgetMs).toISOString();
 stopCourierClock(o);clearCall(o);delete o.finalHandoffAt;
 return o;
}
export function pauseCourierOperatorBudget(o:Order,at:string){
 const c=o.courier||(courierRecalledAtWarehouse(o)?o.courierRecall={...o.courierRecall!}:undefined);
 if(!c)return;
 if(c.operatorStartedAt&&c.operatorBudgetMs!==null&&c.operatorBudgetMs!==undefined)c.operatorBudgetMs=Math.max(0,c.operatorBudgetMs-(Date.parse(at)-Date.parse(c.operatorStartedAt)));
 delete c.operatorStartedAt;delete o.reworkDeadline;
}
export function cancelCourierWork(o:Order,at:string){
 if(o.delivery!=='moscow_courier')return;
 if(o.courier)o.courier={...o.courier};pauseCourierOperatorBudget(o,at);stopCourierClock(o);clearCall(o);
}
export const canEditRecalledCourierOrder=(o:Order,e:Pick<Employee,'id'|'role'>)=>o.delivery==='moscow_courier'&&!o.courier&&['packing','rework'].includes(o.status)&&!!o.courierRecall?.completedAt&&!o.packingWaybillAt&&(e.role==='admin'||e.role==='operator'&&o.manager===e.id);
export const canEditCourierOrder=(o:Order,e:Pick<Employee,'id'|'role'>)=>o.delivery==='moscow_courier'&&o.courier?.phase==='operator'&&o.status==='rework'&&(e.role==='admin'||e.role==='operator'&&o.manager===e.id);
export type CourierCommand={action:'courierAccept'|'courierWorkflow';operation?:'confirm'|'toOperator'|'resume'|'recall'|'returnRecall'|'receiveRecall'|'requestRepack'|'doorRefusal'|'claimDoor'|'resolveDoor';reason?:string;confirmed?:boolean;result?:'deliver'|'return'};
// Shared by the API and tests; ordinary shipping cannot bypass this workflow.
export function applyCourierCommand(order:Order,p:CourierCommand,e:Pick<Employee,'id'|'role'|'name'|'department'>,policy:OrderPolicy,at:string,staff:Employee[]=[]){
 if(order.delivery!=='moscow_courier'||!order.courier||['redeemed','returned','refused'].includes(order.status))throw Error('Работа с этой посылкой недоступна');
 let o:Order={...order,courier:{...order.courier},updatedAt:at};const c=o.courier!,phase=courierPhase(o);
 const logistic=['admin','logistic','chief_logistic'].includes(e.role);
 const courier=e.role==='courier'&&c.id===e.id,operator=(e.role==='operator'&&o.manager===e.id)||e.role==='admin'||isDepartmentOrder(e,o,staff);
 const require=(ok:boolean,message='Это действие недоступно на текущем этапе')=>{if(!ok)throw Error(message);};
 const deadline=courierDeadline(o);
 require(!deadline||Date.parse(at)<Date.parse(deadline),'Срок подтверждения истёк. Обновите данные: заказ возвращается оператору');
 const door=courierDoorRefusal(o);
 if(door)require(['claimDoor','resolveDoor'].includes(p.operation||''),'Курьер ждёт у двери. Нужно принять обращение и дать окончательный ответ');
 require(!!door||!(o.status==='rework'&&o.reworkDeadline&&Date.parse(at)>=Date.parse(o.reworkDeadline)),'Срок доработки истёк. Обновите данные');
 const reason=()=>{const r=p.reason?.trim();require(!!r&&r.length<=1000,'Укажите причину (до 1000 символов)');return r!;};
 const sendToDelivery=(by:'courier'|'operator',resume=false)=>{pauseCourierOperatorBudget(o,at);stopCourierClock(o);clearCall(o);c.phase=resume?'resume':'delivery';c.confirmedBy=e.role==='department_head'?'department_head':by;c.confirmedAt=at;o.status='shipping';o.shippedAt||=at;o.reason='';delete o.finalHandoffAt;};
 const resetToPacking=()=>{
  o.courierRecall={...c.recall!,completedAt:at,operatorBudgetMs:c.operatorBudgetMs};o.courier=undefined;o.status='packing';o.extra=false;
  delete o.packingWaybillAt;delete o.returnReason;delete o.finalHandoffAt;delete o.noAnswerDeadline;delete o.reworkDeadline;
 };
 let text='';
 if(p.operation==='claimDoor'||p.operation==='resolveDoor'){
  require(canHandleCourierDoor(o,e,staff),'Срочное обращение доступно оператору заказа, руководителю его отдела и администратору');
  const d=door!;
  if(p.operation==='claimDoor'){
   require(d.claimedBy!==e.id,'Вы уже взяли обращение в работу');
   require(!d.claimedBy||['admin','department_head'].includes(e.role),'Обращение уже взято в работу другим сотрудником');
   c.doorRefusal={...d,claimedAt:at,claimedBy:e.id,claimedName:e.name};
   text=`Отказ у двери · ${e.name} взял обращение в работу${d.claimedName?' вместо '+d.claimedName:''} · курьер ждёт решения`;
  }else{
   require(d.claimedBy===e.id,'Сначала возьмите обращение в работу');
   require(p.result==='deliver'||p.result==='return','Выберите результат: клиент согласен выкупить или отказ подтверждён');
   require(p.confirmed===true,'Подтвердите окончательный ответ клиента');
   c.doorRefusal={...d,resolvedAt:at,result:p.result};
   if(p.result==='deliver'){sendToDelivery('operator',true);o.round++;text='Отказ у двери решён · клиент согласен выкупить · курьер может продолжить доставку';}
   else{pauseCourierOperatorBudget(o,at);stopCourierClock(o);clearCall(o);o.status='refused';o.cancelledAt=at;o.reason=p.reason?.trim()||c.workReason||'Клиент отказался у двери';o.returnReason=o.reason;text='Отказ у двери подтверждён · верните посылку на склад · '+o.reason;}
  }
 }else if(p.operation==='requestRepack'){
  require(canEditCourierOrder(o,e)&&(!o.courierRepackRequest||!!o.courierRepackRequest.completedAt));
  o.courierRepackRequest={at,by:e.id,name:e.name,reason:reason()};
  text='Оператор запросил пересборку посылки · '+o.courierRepackRequest.reason;
 }else if(p.operation==='recall'){
  require(logistic&&!['recall','recall_returned'].includes(phase||''));
  c.recall={requestedAt:at,by:e.id,name:e.name,reason:reason()};
  pauseCourierOperatorBudget(o,at);stopCourierClock(o);clearCall(o);o.status='packing';o.reason=c.recall.reason;
  if(!c.acceptedAt){resetToPacking();text='Логист отозвал заказ до приёма курьером · '+o.reason;}
  else{c.phase='recall';text='Логист запросил возврат посылки на сборку · '+o.reason;}
 }else if(p.operation==='returnRecall'){
  require(courier&&phase==='recall'&&!!c.acceptedAt);require(p.confirmed===true,'Подтвердите фактическую передачу посылки логисту');
  c.phase='recall_returned';c.recall={...c.recall!,returnedAt:at};o.status='packing';
  text='Курьер передал отозванную посылку логисту · ожидает подтверждения приёма';
 }else if(p.operation==='receiveRecall'){
  require(logistic&&phase==='recall_returned');require(p.confirmed===true,'Подтвердите фактический приём посылки');
  resetToPacking();text='Логист принял отозванную посылку · заказ возвращён на сборку';
 }else if(p.action==='courierAccept'){
  require(courier&&phase==='pending'&&!c.acceptedAt);require(p.confirmed===true,'Подтвердите фактический приём посылки');
  c.acceptedAt=at;
  if(c.phase==='pending'){c.phase='confirmation';c.workStartedAt=at;c.workHours=policy.courierConfirmationHours;clearCall(o);text='Принято курьером · начато подтверждение клиента';}
  else{text='Принято курьером · ранее подтверждённый заказ';} // Existing deliveries keep their completed confirmation.
 }else if(p.operation==='resume'){
  require(courier&&phase==='resume'&&!!c.acceptedAt);c.phase='delivery';clearCall(o);text='Курьер принял заказ обратно в работу · продолжает доставку';
 }else if(p.operation==='confirm'){
  require(courier&&phase==='confirmation'||operator&&phase==='operator');
  require(!o.courierRepackRequest||!!o.courierRepackRequest.completedAt,'Ожидается пересборка: сначала логист должен принять посылку, затем нужно сохранить исправленный заказ');
  const by=phase==='operator'?'operator':'courier';
  sendToDelivery(by,by!=='courier');o.round+=by==='operator'?1:0;
  text=by==='courier'?'Курьер подтвердил заказ · можно доставлять':e.role==='department_head'?'Подтверждено руководителем · клиент готов выкупить заказ':'Подтверждено оператором · клиент готов выкупить заказ';
 }else if(p.operation==='toOperator'||p.operation==='doorRefusal'){
  require(courier&&['confirmation','delivery'].includes(phase||''));
  c.atDoor=p.operation==='doorRefusal';
  if(c.atDoor){require(phase==='delivery','Отказ у двери доступен только на этапе доставки');require(p.confirmed===true,'Подтвердите, что вы у клиента и ждёте решения');c.doorRefusal={at,claimDueAt:new Date(Date.parse(at)+(policy.courierDoorClaimMinutes??2)*60000).toISOString(),decisionDueAt:new Date(Date.parse(at)+(policy.courierDoorDecisionMinutes??10)*60000).toISOString()};}
  const r=reason();o=courierToOperator(o,r,policy,at);
  text=(c.atDoor?'СРОЧНО: отказ у двери · курьер ждёт решения · ':phase==='delivery'?'Возврат с доставки · ':'Возврат с подтверждения курьером · ')+'Заказ передан в работу оператору · '+r+' · посылка остаётся у курьера';
 }else throw Error('Неизвестное действие курьера');
 return {order:o,text};
}

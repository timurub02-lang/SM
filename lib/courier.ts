import type {Order,Employee} from './crm.ts';
import type {Reminder} from './reminders.ts';
import {defaultOrderPolicy,type OrderPolicy} from './order-policy.ts';

export type CourierAssignment={
 id:string;name:string;assignedAt:string;acceptedAt?:string;amount:number;
 phase?:'pending'|'confirmation'|'logistic'|'operator'|'resume'|'delivery';
 workStartedAt?:string;workHours?:number|null;
 confirmedBy?:'courier'|'logistic'|'operator';confirmedAt?:string;
 workReason?:string;atDoor?:boolean;
 operatorBudgetMs?:number|null;operatorStartedAt?:string;
 postponement?:{at:string;reason:string;requestedAt:string;state:'pending'|'approved'|'rejected';decidedAt?:string;by?:string;name?:string};
};
export const courierReturnReasons=['Недозвон','Клиент отказывается','Просит перенести доставку'] as const;
export const courierOperatorReasons=['У клиента вопросы по заказу','Клиент отказывается — дорого','Клиент отказывается — не разрешают родственники','Клиент отказывается — запрещает врач','У клиента вопросы — стоимость заказа','У клиента вопросы — по продукту','Не проходит по срокам доставки'] as const;
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
 return phase==='confirmation'?'confirmation':phase==='logistic'||phase==='operator'?'waiting':phase==='pending'||phase==='resume'?'pending':'delivery';
}
export function courierBalance(orders:Order[],id:string){
 let parcels=0,cash=0,pending=0;
 for(const o of orders){if(o.courier?.id!==id)continue;const stage=courierStage(o),amount=Math.round(o.courier.amount*100);if(stage==='money')cash+=amount;else if(!['none','settled'].includes(stage)){if(o.courier.acceptedAt)parcels+=amount;else pending+=amount;}}
 return {pending:pending/100,parcels:parcels/100,cash:cash/100,total:(parcels+cash)/100};
}
export const courierOutstanding=(o:Order)=>!['none','settled'].includes(courierStage(o));
export const courierWarehouseReturn=(o:Order)=>o.status==='returned'||o.delivery==='moscow_courier'&&o.status==='refused'&&!!o.courier?.acceptedAt;
export function courierReminderNeedsAction(r:Reminder,o:Order|undefined,now=Date.now()){
 if(r.resolved||!o?.courier||o.delivery!=='moscow_courier')return false;
 const phase=courierPhase(o),stage=courierStage(o);
 if(r.kind==='call')return phase==='confirmation'&&stage==='confirmation'&&!!r.due&&o.due===r.due&&['missed','callback'].includes(o.contact);
 if(r.kind==='courier-warning')return phase==='confirmation'&&courierDeadline(o)===r.due;
 if(r.kind==='courier-delivery')return stage==='delivery'&&o.courier.postponement?.state==='approved'&&o.courier.postponement.at===r.due&&Date.parse(r.due)<=now;
 if(r.kind!=='courier')return false;
 const started=stage==='pending'?(phase==='resume'?o.courier.confirmedAt:o.courier.assignedAt):stage==='return'?(o.returnedAt||o.cancelledAt):undefined;
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
 if(o.delivery!=='moscow_courier'||!c||!['confirmation','logistic'].includes(c.phase||'')||['redeemed','returned','refused'].includes(o.status)||!c.workStartedAt||c.workHours===null)return undefined;
 return new Date(Date.parse(c.workStartedAt)+(c.workHours??48)*3600000).toISOString();
}
export function courierConfirmationStage(o:Order,now=Date.now(),policy:OrderPolicy=defaultOrderPolicy){
 const deadline=courierDeadline(o);
 if(deadline&&Date.parse(deadline)-now<=policy.courierWarningHours*3600000)return 'expiring';
 if(o.due&&Date.parse(o.due)<=now)return 'new';
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
 if(!c||stage==='none')return '';
 if(stage==='return')return 'Вернуть посылку на склад';
 if(stage==='settled')return o.paymentReceivedAt?'Деньги приняты логистом':'Посылка принята на склад';
 if(stage==='money')return 'Оплачен · деньги у курьера';
 if(c.phase==='resume')return c.confirmedBy==='operator'?'Подтверждено оператором · клиент готов выкупить заказ':'Подтверждено логистом · клиент ожидает заказ';
 if(stage==='pending')return 'Ожидает приёма курьером';
 if(stage==='confirmation')return 'У курьера на подтверждении';
 if(stage==='waiting')return c.phase==='operator'?(c.atDoor?'Отказ у курьера · в работе у оператора':'В работе у оператора · посылка у курьера'):'В работе у логиста · посылка у курьера';
 if(c.postponement?.state==='approved')return 'Доставка согласована ко времени';
 return 'У Курьера';
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
 if(!o.courier)return;
 const c=o.courier;
 if(c.operatorStartedAt&&c.operatorBudgetMs!==null&&c.operatorBudgetMs!==undefined)c.operatorBudgetMs=Math.max(0,c.operatorBudgetMs-(Date.parse(at)-Date.parse(c.operatorStartedAt)));
 delete c.operatorStartedAt;delete o.reworkDeadline;
}
export function cancelCourierWork(o:Order,at:string){
 if(o.delivery!=='moscow_courier'||!o.courier)return;
 o.courier={...o.courier};pauseCourierOperatorBudget(o,at);stopCourierClock(o);clearCall(o);
}
export type CourierCommand={action:'courierAccept'|'courierWorkflow';operation?:'confirm'|'toLogistic'|'toOperator'|'requestPostpone'|'approvePostpone'|'rejectPostpone'|'resume';reason?:string;at?:string;confirmed?:boolean};
// Shared by the API and tests; ordinary shipping cannot bypass this workflow.
export function applyCourierCommand(order:Order,p:CourierCommand,e:Pick<Employee,'id'|'role'|'name'>,policy:OrderPolicy,at:string){
 if(order.delivery!=='moscow_courier'||!order.courier||['redeemed','returned','refused'].includes(order.status))throw Error('Работа с этой посылкой недоступна');
 const o:Order={...order,courier:{...order.courier},updatedAt:at},c=o.courier!,phase=courierPhase(o);
 const courier=e.role==='courier'&&c.id===e.id,logistic=['admin','logistic','chief_logistic'].includes(e.role),operator=(e.role==='operator'&&o.manager===e.id)||e.role==='admin';
 const require=(ok:boolean,message='Это действие недоступно на текущем этапе')=>{if(!ok)throw Error(message);};
 const deadline=courierDeadline(o);
 require(!deadline||Date.parse(at)<Date.parse(deadline),'Срок подтверждения истёк. Обновите данные: заказ возвращается оператору');
 require(!(o.status==='rework'&&o.reworkDeadline&&Date.parse(at)>=Date.parse(o.reworkDeadline)),'Срок доработки истёк. Обновите данные');
 const reason=()=>{const r=p.reason?.trim();require(!!r&&r.length<=1000,'Укажите причину (до 1000 символов)');return r!;};
 const sendToDelivery=(by:'courier'|'logistic'|'operator',resume=false)=>{pauseCourierOperatorBudget(o,at);stopCourierClock(o);clearCall(o);c.phase=resume?'resume':'delivery';c.confirmedBy=by;c.confirmedAt=at;o.status='shipping';o.shippedAt||=at;o.reason='';delete o.finalHandoffAt;};
 let text='';
 if(p.action==='courierAccept'){
  require(courier&&phase==='pending'&&!c.acceptedAt);require(p.confirmed===true,'Подтвердите фактический приём посылки');
  c.acceptedAt=at;
  if(c.phase==='pending'){c.phase='confirmation';c.workStartedAt=at;c.workHours=policy.courierConfirmationHours;clearCall(o);text='Принято курьером · начато подтверждение клиента';}
  else{text='Принято курьером · ранее подтверждённый заказ';} // Existing deliveries keep their completed confirmation.
 }else if(p.operation==='resume'){
  require(courier&&phase==='resume'&&!!c.acceptedAt);c.phase='delivery';clearCall(o);text='Курьер принял заказ обратно в работу · продолжает доставку';
 }else if(p.operation==='confirm'){
  require(courier&&phase==='confirmation'||logistic&&phase==='logistic'||operator&&phase==='operator');
  const by=phase==='operator'?'operator':phase==='logistic'?'logistic':'courier';
  require(c.postponement?.state!=='pending','Сначала согласуйте или отклоните перенос доставки');
  sendToDelivery(by,by!=='courier');o.round+=by==='operator'?1:0;
  text=by==='courier'?'Курьер подтвердил заказ · можно доставлять':by==='operator'?'Подтверждено оператором · клиент готов выкупить заказ':'Подтверждено логистом · клиент ожидает заказ';
 }else if(p.operation==='toOperator'){
  require(courier&&['confirmation','delivery'].includes(phase||'')||logistic&&phase==='logistic');
  c.atDoor=courier&&phase==='delivery';
  const r=reason();Object.assign(o,courierToOperator(o,r,policy,at));
  text=(c.atDoor?'Отказ у курьера · ':'')+'Заказ передан в работу оператору · '+r+' · посылка остаётся у курьера';
 }else if(p.operation==='toLogistic'||p.operation==='requestPostpone'){
  require(courier&&['confirmation','delivery'].includes(phase||'')&&!!c.acceptedAt);
  const r=reason();
  if(p.operation==='requestPostpone'){
   require(!!p.at&&Number.isFinite(Date.parse(p.at))&&Date.parse(p.at)>Date.parse(at),'Укажите будущие дату и время доставки');
   c.postponement={at:p.at!,reason:r,requestedAt:at,state:'pending'};
  }else if(c.postponement?.state==='approved')c.postponement={...c.postponement,state:'rejected',decidedAt:at};
  c.phase='logistic';c.workStartedAt=at;c.workHours=policy.courierLogisticHours;c.workReason=r;clearCall(o);o.reason=r;
  text=(p.operation==='requestPostpone'?'Курьер запросил согласование переноса доставки':'Курьер передал заказ в работу логисту')+' · '+r+' · посылка остаётся у курьера';
 }else if(p.operation==='approvePostpone'||p.operation==='rejectPostpone'){
  require(logistic&&phase==='logistic'&&c.postponement?.state==='pending');
  if(p.operation==='approvePostpone')require(Date.parse(c.postponement!.at)>Date.parse(at),'Запрошенное время уже прошло. Отклоните перенос и согласуйте новое время');
  c.postponement={...c.postponement!,state:p.operation==='approvePostpone'?'approved':'rejected',decidedAt:at,by:e.id,name:e.name};
  if(p.operation==='approvePostpone'){sendToDelivery('logistic');text='Логист согласовал доставку ко времени · '+c.postponement.at+' · '+c.postponement.reason;}
  else{text='Логист отклонил перенос доставки · '+reason();o.reason=reason();}
 }else throw Error('Неизвестное действие курьера');
 return {order:o,text};
}

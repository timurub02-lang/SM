import type {Order} from './crm.ts';
import {orderDisplayGroup} from './order-premium-stage.ts';
import {premiumRemittance} from './cdek-remittance.ts';

// Missing historical event dates must not be replaced by creation/import dates.
export function orderStageDate(o:Order):{label:string;at?:string}{
 let label='Создан',at:string|undefined;
 switch(orderDisplayGroup(o).id){
  case 'new':at=o.createdAt;break;
  case 'transferred':label='Передан';at=o.finalHandoffAt||o.confirmationStartedAt;break;
  case 'accepted':label='Принят';at=o.confirmedAt;break;
  case 'sent':label='Отправлен';at=o.shippedAt;break;
  case 'paid':label='Оплачен';at=o.redeemedAt;break;
  case 'accrued':label='Деньги получены';at=premiumRemittance(o)?.paymentDate||o.paymentReceivedAt;break;
  case 'premium_paid':label='Выплачено';at=o.premiumStage?.paidAt;break;
  case 'cancelled':label='Отменён';at=o.cancelledAt;break;
  case 'returned':label='Возврат';at=o.returnedAt;break;
 }
 return {label,at:at&&Number.isFinite(Date.parse(at))?at:undefined};
}

export function orderStageDateLabel(o:Order){
 const {label,at}=orderStageDate(o);
 if(!at)return label+': Дата не указана';
 const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(at);
 return label+': '+new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',...(dateOnly?{}:{hour:'2-digit',minute:'2-digit'})});
}

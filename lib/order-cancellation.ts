import type {Order,Event} from './crm';
export function cancellationDetails(order:Order,events:Event[]){
 if(order.status!=='refused')return null;
 const event=events.filter(e=>e.orderId===order.id&&(/→ Отказ(?: ·|$)/.test(e.text)||e.text.startsWith('Заказ отменён:')||e.text.includes('Отказ у двери подтверждён'))).sort((a,b)=>b.at.localeCompare(a.at))[0];
 return {reason:order.reason?.trim()||'Причина не указана',author:order.cancellationAuthor?.name||event?.actor||'',at:order.cancellationAuthor?.at||order.cancelledAt||event?.at||''};
}

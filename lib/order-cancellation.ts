import type {Order,Employee,Event} from './crm.ts';
export type OrderCancellation={id:string;at:string;by:string;name:string;reason:string;incomingId:string;status:'pending'|'cancelled'|'rejected';decidedAt?:string;decidedBy?:string;decidedName?:string;decisionReason?:string};
export function cancellationBlockReason(o:Order){
 if(['refused','redeemed','returned'].includes(o.status))return 'Заказ уже закрыт';
 if(o.courier||o.shippedAt||['shipping','pickup'].includes(o.status)||o.cdekExported||o.cdekTransferredAt||o.cdekDeleting)return 'Заказ уже передан в доставку или выгружается в СДЭК. Отмена недоступна — требуется обработка возврата.';
 return '';
}
export function requestOrderCancellation(o:Order,e:Employee,reason:string,incomingId:string,id:string,at:string):Order{
 if(!['operator','department_head','admin'].includes(e.role))throw Error('Запрос отправляет оператор или руководитель');
 if(['refused','redeemed','returned'].includes(o.status))throw Error('Заказ уже закрыт');
 if(o.cancellationRequest?.status==='pending')throw Error('Запрос на отмену уже передан логисту');
 return {...o,cancellationRequest:{id,at,by:e.id,name:e.name,reason,incomingId,status:'pending'}};
}
export function resolveOrderCancellation(o:Order,e:Employee,requestId:string,decision:'cancel'|'reject',reason:string,at:string):Order{
 if(!['admin','logistic','chief_logistic'].includes(e.role))throw Error('Решение принимает логист');
 const r=o.cancellationRequest;if(!r||r.id!==requestId||r.status!=='pending')throw Error('Запрос уже обработан. Обновите данные');
 if(decision==='cancel'){const blocked=cancellationBlockReason(o);if(blocked)throw Error(blocked);}
 if(decision==='reject'&&!reason.trim())throw Error('Укажите причину отклонения');
 const next:Order={...o,cancellationRequest:{...r,status:decision==='cancel'?'cancelled':'rejected',decidedAt:at,decidedBy:e.id,decidedName:e.name,decisionReason:reason}};
 if(decision==='cancel'){
  next.status='refused';next.cancelledAt=at;next.contact='none';next.due='';next.reason=r.reason;
  delete next.noAnswerDeadline;delete next.reworkDeadline;delete next.clientWaiting;
  if(next.confirmationRequest)next.confirmationRequest={...next.confirmationRequest,handledAt:at};
 }
 return next;
}

export function cancellationDetails(order:Order,events:Event[]){
 if(order.status!=='refused')return null;
 const event=events.filter(e=>e.orderId===order.id&&(/→ Отказ(?: ·|$)/.test(e.text)||e.text.startsWith('Заказ отменён:')||e.text.includes('Отказ у двери подтверждён'))).sort((a,b)=>b.at.localeCompare(a.at))[0];
 return {reason:order.reason?.trim()||'Причина не указана',author:order.cancellationAuthor?.name||event?.actor||'',at:order.cancellationAuthor?.at||order.cancelledAt||event?.at||''};
}

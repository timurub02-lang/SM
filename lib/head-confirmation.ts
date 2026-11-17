import {allowedOrderTransitions,orderMissingField,validateTransition,type Order,type Client,type Employee,type Status} from './crm.ts';
import {isDepartmentOrder} from './department-orders.ts';
export function headConfirmationTarget(o:Order):Status|undefined{
 if(o.courier||o.courierRecall||o.shippedAt||o.cdekTransferredAt||o.cdekExported||o.cdekDeleting||o.zvd||o.cancellationRequest?.status==='pending'||o.packingReworkDelivery||o.editRequest?.status==='pending'||o.editRequest?.status==='editing'&&!o.editRequest.savedAt)return;
 if(o.status==='rework')return o.returnKind&&o.delivery?(o.delivery.startsWith('cdek_')?'check':'packing'):undefined;
 if(['confirm','extra'].includes(o.status)&&o.contact==='missed')return allowedOrderTransitions(o,'logistic').find(to=>['check','extra','packing'].includes(to));
}
export function confirmByHead(o:Order,c:Client,e:Employee,staff:Employee[],at:string,clientConfirmed:boolean,correctionsConfirmed:boolean):Order{
 const to=headConfirmationTarget(o);
 if(!isDepartmentOrder(e,o,staff)||!to)throw Error('Подтверждение РК доступно только по своему отделу: недозвон на подтверждении или возврат от логиста до отправки');
 if(!clientConfirmed)throw Error('Подтвердите согласие клиента выкупить заказ');
 if(o.status==='rework'&&!correctionsConfirmed)throw Error('Подтвердите исправление замечаний логиста');
 const editing=o.editRequest?.status==='editing';
 const source=editing?{...o,editRequest:undefined}:o;
 const validationTo=o.status==='rework'?(o.extra?'extra':'confirm'):to;
 validateTransition(source,validationTo,c,'',o.status==='rework'?'department_head':'logistic');
 const missing=orderMissingField(o,c,'department_head');if(missing)throw Error(missing.label);
 const next:Order={...o,status:to,contact:'none',due:'',reason:'',extra:to==='extra',confirmedAt:o.confirmedAt||at,updatedAt:at,confirmationAuthor:{id:e.id,name:e.name,role:e.role,at}};
 for(const key of ['reworkDeadline','reworkHours','returnReason','returnKind','finalHandoffAt','noAnswerDeadline','extraCallbackAt','confirmationStartedAt','confirmationHours','contactAuthor','clientWaiting','packingWaybillAt'] as const)delete next[key];
 if(o.finalHandoffAt)next.refusalHandoffAt=o.refusalHandoffAt||o.finalHandoffAt;
 if(o.status==='rework'&&o.returnKind==='refusal'){next.round=o.round+1;next.refusalHandoffAt=o.refusalHandoffAt||o.finalHandoffAt||at;}
 if(to==='check')delete next.adminReviewedAt;
 if(editing)next.editRequest={...o.editRequest!,status:'completed',completedAt:at};
 return next;
}

export const canHeadRequestEdit=(e:Employee,o:Order,staff:Employee[])=>isDepartmentOrder(e,o,staff)&&['confirm','extra'].includes(o.status)&&!o.courier&&!o.shippedAt&&!o.cdekTransferredAt&&!o.cdekExported&&!o.cdekDeleting&&!['pending','editing'].includes(o.editRequest?.status||'');

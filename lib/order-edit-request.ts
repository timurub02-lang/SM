import type {Order,Employee,Status} from './crm.ts';
export type OrderEditRequest={id:string;status:'pending'|'editing'|'completed'|'rejected';reason:string;incomingId:string;by:string;name:string;at:string;from:Status;decidedAt?:string;decidedName?:string;savedAt?:string;completedAt?:string;decisionReason?:string};
export function beforeShipment(o:Pick<Order,'status'|'shippedAt'|'courier'|'cdekTransferredAt'>){return ['draft','confirm','extra','check','packing','phone','rework'].includes(o.status)&&!o.shippedAt&&!o.courier&&!o.cdekTransferredAt;}
export function requestOrderEdit(o:Order,e:Employee,reason:string,incomingId:string,id:string,at:string):Order{
 if(!['admin','operator','department_head'].includes(e.role))throw Error('Запрос отправляет оператор или руководитель');
 if(!beforeShipment(o)||o.status==='rework')throw Error('Запрос редактирования доступен до отправки, пока заказ не возвращён оператору');
 if(o.cancellationRequest?.status==='pending'||['pending','editing'].includes(o.editRequest?.status||''))throw Error('По заказу уже есть незавершённый запрос');
 return {...o,editRequest:{id,status:'pending',reason,incomingId,by:e.id,name:e.name,at,from:o.status}};
}
export function resolveOrderEdit(o:Order,e:Employee,requestId:string,decision:'edit'|'reject',reason:string,at:string):Order{
 if(!['admin','logistic','chief_logistic'].includes(e.role))throw Error('Решение принимает логист');
 const r=o.editRequest;if(!r||r.id!==requestId||r.status!=='pending')throw Error('Запрос уже обработан. Обновите данные');
 if(decision==='reject'&&!reason.trim())throw Error('Укажите причину отклонения');
 if(decision==='edit'&&(!beforeShipment(o)||o.status!==r.from))throw Error('Этап заказа изменился. Обновите запрос');
 return {...o,...(decision==='edit'?{status:'rework' as const,returnKind:'clarification' as const,returnReason:r.reason,reason:r.reason,contact:'none' as const,due:''}:{}),editRequest:{...r,status:decision==='edit'?'editing':'rejected',decidedAt:at,decidedName:e.name,decisionReason:reason}};
}
export function completeOrderEdit(o:Order,e:Employee,requestId:string,at:string):Order{
 const r=o.editRequest;
 if(!r||r.id!==requestId||r.status!=='editing'||o.status!=='rework'||!beforeShipment(o))throw Error('Заказ не находится на редактировании');
 if(!['admin','department_head'].includes(e.role)&&!(e.role==='operator'&&o.manager===e.id))throw Error('Передать заказ может его оператор');
 if(!r.savedAt)throw Error('Сначала сохраните исправления заказа');
 const next:Order={...o,status:r.from,editRequest:{...r,status:'completed',completedAt:at},contact:'none',due:'',reason:''};
 delete next.reworkDeadline;delete next.reworkHours;delete next.returnKind;delete next.returnReason;
 return next;
}

import type {Order,Employee} from './crm.ts';
import {isDepartmentOrder} from './department-orders.ts';
export type PostalBuyoutReport={id:string;at:string;by:string;name:string;status:'pending'|'paid'|'returned'|'sent';decidedAt?:string;decidedBy?:string;decidedName?:string};
export const postalBuyoutPending=(o:Order)=>o.delivery==='russian_post'&&['shipping','pickup'].includes(o.status)&&o.postalBuyoutReport?.status==='pending';
export const mayReportPostalBuyout=(o:Order,e:Employee,staff:Employee[])=>o.delivery==='russian_post'&&['shipping','pickup'].includes(o.status)&&(e.role==='operator'&&o.manager===e.id||e.role==='department_head'&&isDepartmentOrder(e,o,staff));
export function reportPostalBuyout(o:Order,e:Employee,staff:Employee[],at:string,id:string):Partial<Order>{
 if(!mayReportPostalBuyout(o,e,staff))throw Error('Сообщить о выкупе может оператор заказа или руководитель его отдела');
 if(postalBuyoutPending(o))throw Error('Сообщение о выкупе уже ожидает проверки логистом');
 return {postalBuyoutReport:{id,at,by:e.id,name:e.name,status:'pending'}};
}
export function resolvePostalBuyout(o:Order,e:Employee,at:string,result:'paid'|'returned'|'sent'):Partial<Order>{
 if(!['admin','logistic','chief_logistic'].includes(e.role)||!postalBuyoutPending(o))throw Error('Сообщение о выкупе недоступно для проверки');
 return {postalBuyoutReport:{...o.postalBuyoutReport!,status:result,decidedAt:at,decidedBy:e.id,decidedName:e.name}};
}

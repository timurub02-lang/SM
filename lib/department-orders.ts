import type {Employee,Order} from './crm.ts';

export const isDepartmentOrder=(e:Pick<Employee,'role'|'department'>,o:Pick<Order,'manager'>,staff:Employee[])=>
 e.role==='department_head'&&!!e.department&&staff.some(x=>x.id===o.manager&&x.role==='operator'&&x.department===e.department);
export const departmentWorkStage=(o:Pick<Order,'status'|'courier'|'cdekExported'|'cdekDeleting'>)=>
 !o.cdekExported&&!o.cdekDeleting&&['confirm','extra','rework'].includes(o.status)&&(!o.courier||o.status==='rework'&&o.courier.phase==='operator');
export function usesOrderLease(e:Pick<Employee,'id'|'role'>,o:Order){
 if(['logistic','chief_logistic'].includes(e.role))return true;
 if(o.courier?.doorRefusal&&!o.courier.doorRefusal.resolvedAt)return false; // Urgent doorstep takeover keeps its existing claim protocol.
 return e.role==='department_head'?departmentWorkStage(o):e.role==='operator'&&o.manager===e.id&&['draft','rework'].includes(o.status);
}
export type OrderActionAuthor={id:string;name:string;role:Employee['role'];at:string};
export function headOrderMarks(o:Order){
 const marks:{text:string;author:OrderActionAuthor}[]=[];
 if(o.confirmationAuthor?.role==='department_head')marks.push({text:'Подтверждено руководителем',author:o.confirmationAuthor});
 if(o.contact!=='none'&&o.contactAuthor?.role==='department_head')marks.push({text:o.contact==='missed'?'Недозвон руководителем':'Перезвон руководителем',author:o.contactAuthor as OrderActionAuthor});
 if(o.status==='refused'&&o.cancellationAuthor?.role==='department_head')marks.push({text:'Отменено руководителем',author:o.cancellationAuthor});
 return marks;
}

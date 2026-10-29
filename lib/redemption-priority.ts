import type {Employee,Order} from './crm.ts';
export function eligibleForRedemption(order:Pick<Order,'delivery'|'cdekStatus'>,statuses:readonly string[]){
 return !!order.delivery?.startsWith('cdek_')&&!!order.cdekStatus?.code&&statuses.includes(order.cdekStatus.code);
}
export function compareRedemptionPriority(a:Pick<Order,'id'|'delivery'|'cdekStatus'>,b:Pick<Order,'id'|'delivery'|'cdekStatus'>,statuses:readonly string[],workedToday:ReadonlySet<string>=new Set(),awaitingOperator:ReadonlySet<string>=new Set()){
 return Number(awaitingOperator.has(b.id))-Number(awaitingOperator.has(a.id))||Number(eligibleForRedemption(b,statuses))-Number(eligibleForRedemption(a,statuses))||(eligibleForRedemption(a,statuses)?Number(workedToday.has(a.id))-Number(workedToday.has(b.id)):0);
}

export function canEditOrderRedemption(employee:Pick<Employee,'id'|'role'|'department'>,order:Pick<Order,'manager'|'status'|'delivery'>,manager?:Pick<Employee,'id'|'role'|'department'>){
 return order.status==='shipping'&&!!order.delivery?.startsWith('cdek_')&&(employee.role==='operator'&&order.manager===employee.id||employee.role==='department_head'&&!!employee.department&&manager?.id===order.manager&&manager.role==='operator'&&manager.department===employee.department);
}

import type {Order} from './crm.ts';
export function eligibleForRedemption(order:Pick<Order,'delivery'|'cdekStatus'>,statuses:readonly string[]){
 return !!order.delivery?.startsWith('cdek_')&&!!order.cdekStatus?.code&&statuses.includes(order.cdekStatus.code);
}
export function compareRedemptionPriority(a:Pick<Order,'id'|'delivery'|'cdekStatus'>,b:Pick<Order,'id'|'delivery'|'cdekStatus'>,statuses:readonly string[],workedToday:ReadonlySet<string>=new Set()){
 return Number(eligibleForRedemption(b,statuses))-Number(eligibleForRedemption(a,statuses))||(eligibleForRedemption(a,statuses)?Number(workedToday.has(a.id))-Number(workedToday.has(b.id)):0);
}

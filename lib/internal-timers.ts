// The 5/2 policy starts on this Moscow date; earlier elapsed time is not refunded.
export const weekdayTimersSince=Date.parse('2026-11-13T00:00:00+03:00');
const day=86400000,offset=10800000;
const midnight=(at:number)=>Math.floor((at+offset)/day)*day-offset;
const weekend=(at:number)=>[0,6].includes(new Date(at+offset).getUTCDay());
export function weekdayMilliseconds(from:number,to:number){
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return 0;
 let amount=0;
 while(from<to){const next=Math.min(to,midnight(from)+day);if(!weekend(from))amount+=next-from;from=next;}
 return amount;
}
export function addWeekdayMilliseconds(from:number,amount:number){
 if(!Number.isFinite(from)||!Number.isFinite(amount))throw Error('Некорректный срок обработки');
 const direction=amount<0?-1:1;amount=Math.abs(amount);
 while(amount>0){
  const edge=direction>0?midnight(from)+day:midnight(from-1);
  if(weekend(direction>0?from:from-1)){from=edge;continue;}
  const used=Math.min(amount,Math.abs(edge-from));from+=direction*used;amount-=used;
 }
 return new Date(from).toISOString();
}
export function internalDeadline(at:string,hours:number){
 const start=Date.parse(at),end=start+hours*3600000;
 if(end<=weekdayTimersSince)return new Date(end).toISOString();
 return addWeekdayMilliseconds(Math.max(start,weekdayTimersSince),end-Math.max(start,weekdayTimersSince));
}
export function internalElapsed(from:number,to:number){
 return Math.max(0,Math.min(to,weekdayTimersSince)-from)+weekdayMilliseconds(Math.max(from,weekdayTimersSince),to);
}
export const upgradeInternalDeadline=(at:string)=>!Number.isFinite(Date.parse(at))||Date.parse(at)<=weekdayTimersSince?at:addWeekdayMilliseconds(weekdayTimersSince,Date.parse(at)-weekdayTimersSince);

// Stored deadlines are upgraded once; do not change completed orders or restart any clock.
export function upgradeOrderTimers<T extends {status:string;timerCalendar?:string;reworkDeadline?:string;noAnswerDeadline?:string;courier?:any}>(order:T):T{
 if(order.timerCalendar==='weekdays-v1'||['redeemed','returned','refused'].includes(order.status))return order;
 if(!['draft','rework','confirm','extra'].includes(order.status)&&order.courier?.phase!=='confirmation')return order;
 if(!order.reworkDeadline&&!order.noAnswerDeadline&&!order.courier?.doorRefusal)return order;
 const next={...order,timerCalendar:'weekdays-v1'};
 if(next.reworkDeadline)next.reworkDeadline=upgradeInternalDeadline(next.reworkDeadline);
 if(next.noAnswerDeadline)next.noAnswerDeadline=upgradeInternalDeadline(next.noAnswerDeadline);
 if(order.courier?.doorRefusal&&!order.courier.doorRefusal.resolvedAt){
  const door=order.courier.doorRefusal;
  next.courier={...order.courier,doorRefusal:{...door,claimDueAt:upgradeInternalDeadline(door.claimDueAt),decisionDueAt:upgradeInternalDeadline(door.decisionDueAt)}};
 }
 return next as T;
}

export function internalWarningAt(deadline:string,hours:number){
 const end=Date.parse(deadline),amount=hours*3600000;
 if(end<=weekdayTimersSince)return new Date(end-amount).toISOString();
 const elapsed=weekdayMilliseconds(weekdayTimersSince,end);
 return amount<=elapsed?addWeekdayMilliseconds(end,-amount):new Date(weekdayTimersSince-(amount-elapsed)).toISOString();
}

import {total,type State,type Employee} from './crm.ts';
const moscowDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'});
export function operatorStats(state:Pick<State,'employees'|'orders'>,actor:Employee,from:string,to:string){
 const operators=state.employees.filter(e=>e.role==='operator'&&(actor.role==='admin'||actor.role==='department_head'&&!!actor.department&&e.department===actor.department||actor.role==='operator'&&e.id===actor.id));
 // Imports retain their LV creation date but are not new SK/CRM sales.
 const cohort=[...new Map(state.orders.map(o=>[o.id,o])).values()].filter(o=>{
  if(o.testOnly||o.legacyLv)return false;
  const date=new Date(o.createdAt);if(Number.isNaN(date.getTime()))return false;
  const day=moscowDate.format(date);return (!from||day>=from)&&(!to||day<=to);
 });
 const buyouts=[...new Map(state.orders.map(o=>[o.id,o])).values()].filter(o=>{
  if(o.testOnly||o.status!=='redeemed'||!o.redeemedAt)return false;
  const date=new Date(o.redeemedAt);if(Number.isNaN(date.getTime()))return false;
  const day=moscowDate.format(date);return (!from||day>=from)&&(!to||day<=to);
 });
 return operators.map(employee=>{
  const redeemed=buyouts.filter(o=>o.manager===employee.id);
  const buyoutCdek=redeemed.filter(o=>o.delivery==='cdek_pickup'||o.delivery==='cdek_courier').length;
  const buyoutPost=redeemed.filter(o=>o.delivery==='russian_post').length;
  const buyoutMoscow=redeemed.filter(o=>o.delivery==='moscow_courier').length;
  const created=cohort.filter(o=>o.manager===employee.id);
  // First-occurrence dates keep completed stages counted after the order moves on.
  const confirmed=created.filter(o=>!!o.confirmedAt);
  const sent=created.filter(o=>!!o.shippedAt||!!o.cdekAcceptedAt||['shipping','pickup','redeemed','returned'].includes(o.status));
  const cancelled=created.filter(o=>!!o.cancelledAt||o.status==='refused');
  const awaitingShipment=confirmed.filter(o=>!sent.includes(o)&&!cancelled.includes(o));
  const inWork=created.filter(o=>!confirmed.includes(o)&&!cancelled.includes(o));
  const amount=created.reduce((sum,o)=>sum+Math.round(total(o)*100),0)/100;
  return {buyoutCount:redeemed.length,buyoutAmount:redeemed.reduce((n,o)=>n+Math.round(total(o)*100),0)/100,buyoutCdek,buyoutPost,buyoutMoscow,id:employee.id,login:employee.login,department:employee.department||'',inWork:inWork.length,created:created.length,amount,average:created.length?amount/created.length:0,cancelled:cancelled.length,confirmed:confirmed.length,awaitingShipment:awaitingShipment.length,sent:sent.length,orderLists:{redeemed,created,inWork,cancelled,confirmed,awaitingShipment,sent}};
 });
}

export type StatsSortKey='login'|'created'|'inWork'|'average'|'amount'|'cancelled'|'confirmed'|'awaitingShipment'|'sent'|'buyoutCount'|'buyoutAmount'|'buyoutCdek'|'buyoutPost'|'buyoutMoscow';
export function sortOperatorStats(rows:ReturnType<typeof operatorStats>,key:StatsSortKey,ascending:boolean){
 return [...rows].sort((a,b)=>{
  const comparison=key==='login'?a.login.localeCompare(b.login,'ru',{numeric:true}):a[key]-b[key];
  return (ascending?comparison:-comparison)||a.login.localeCompare(b.login,'ru',{numeric:true});
 });
}

export function operatorStatsSummary(state:Pick<State,'employees'|'orders'>,actor:Employee,from:string,to:string,byDay=false,department=''){
 if(!['admin','department_head'].includes(actor.role))throw Error('Недостаточно прав');
 const rows=operatorStats(state,{...actor,role:'admin'},from,to).filter(r=>!department||r.department===department);
 return (byDay?buyoutStatsByDay(rows):rows).map(({orderLists,...summary})=>summary);
}

export function buyoutStatsByDay(rows:ReturnType<typeof operatorStats>){
 const days=new Map<string,ReturnType<typeof operatorStats>[number]>();
 for(const row of rows)for(const order of row.orderLists.redeemed){
  const day=moscowDate.format(new Date(order.redeemedAt!));
  let result=days.get(day);
  if(!result){result={...row,id:day,login:day,department:'',created:0,inWork:0,amount:0,average:0,cancelled:0,confirmed:0,awaitingShipment:0,sent:0,buyoutCount:0,buyoutAmount:0,buyoutCdek:0,buyoutPost:0,buyoutMoscow:0,orderLists:{redeemed:[],created:[],inWork:[],cancelled:[],confirmed:[],awaitingShipment:[],sent:[]}};days.set(day,result);}
  result.buyoutCount++;result.buyoutAmount=(Math.round(result.buyoutAmount*100)+Math.round(total(order)*100))/100;
  if(order.delivery==='cdek_pickup'||order.delivery==='cdek_courier')result.buyoutCdek++;
  if(order.delivery==='russian_post')result.buyoutPost++;
  if(order.delivery==='moscow_courier')result.buyoutMoscow++;
  result.orderLists.redeemed.push(order);
 }
 return [...days.values()];
}

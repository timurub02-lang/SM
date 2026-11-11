import {total,type State,type Employee} from './crm.ts';
const moscowDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'});
export function operatorStats(state:State,actor:Employee,from:string,to:string){
 const operators=state.employees.filter(e=>e.role==='operator'&&(actor.role==='admin'||actor.role==='department_head'&&!!actor.department&&e.department===actor.department||actor.role==='operator'&&e.id===actor.id));
 // Imports retain their LV creation date but are not new SK/CRM sales.
 const cohort=[...new Map(state.orders.map(o=>[o.id,o])).values()].filter(o=>{
  if(o.testOnly||o.legacyLv)return false;
  const date=new Date(o.createdAt);if(Number.isNaN(date.getTime()))return false;
  const day=moscowDate.format(date);return (!from||day>=from)&&(!to||day<=to);
 });
 return operators.map(employee=>{
  const created=cohort.filter(o=>o.manager===employee.id);
  // First-occurrence dates keep completed stages counted after the order moves on.
  const confirmed=created.filter(o=>!!o.confirmedAt);
  const sent=created.filter(o=>!!o.shippedAt||!!o.cdekAcceptedAt||['shipping','pickup','redeemed','returned'].includes(o.status));
  const cancelled=created.filter(o=>!!o.cancelledAt||o.status==='refused');
  const amount=created.reduce((sum,o)=>sum+Math.round(total(o)*100),0)/100;
  return {id:employee.id,login:employee.login,created:created.length,amount,average:created.length?amount/created.length:0,cancelled:cancelled.length,confirmed:confirmed.length,sent:sent.length,orderLists:{created,cancelled,confirmed,sent}};
 });
}

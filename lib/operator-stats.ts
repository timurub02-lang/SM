import {total,orderGroup,type State,type Employee} from './crm.ts';
export function operatorStats(state:State,actor:Employee,from:string,to:string){
 const reviewed=new Set(state.events.filter(e=>/^Проверка → (Упаковка|Доп\. подтверждение)(?: ·|$)/.test(e.text)).map(e=>e.orderId));
 const operators=state.employees.filter(e=>e.role==='operator'&&(actor.role==='admin'||actor.role==='department_head'&&!!actor.department&&e.department===actor.department||actor.role==='operator'&&e.id===actor.id));
 return operators.map(employee=>{
  const orders=state.orders.filter(o=>!o.testOnly&&o.manager===employee.id).filter(o=>{const day=new Date(o.createdAt).toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});return (!from||day>=from)&&(!to||day<=to);});
  const accepted=orders.filter(o=>(o.adminReviewedAt||reviewed.has(o.id))&&o.status!=='refused');
  const sent=orders.filter(o=>orderGroup(o).id==='sent');
  const redeemed=orders.filter(o=>o.status==='redeemed');
  const amount=accepted.reduce((sum,o)=>sum+Math.round(total(o)*100),0)/100;
  return {orderLists:{sent,redeemed,created:orders,newOrders:orders.filter(o=>orderGroup(o).id==='new'),reviewed:accepted,cancelled:orders.filter(o=>o.status==='refused')},sent:sent.length,redeemed:redeemed.length,id:employee.id,login:employee.login,created:orders.length,cancelled:orders.filter(o=>o.status==='refused').length,newOrders:orders.filter(o=>orderGroup(o).id==='new').length,reviewed:accepted.length,amount,average:accepted.length?amount/accepted.length:0};
 });
}

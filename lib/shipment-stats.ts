import {operatorStats} from './operator-stats.ts';
import {total,type Order,type State,type Employee} from './crm.ts';
const moscowDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'});
export function shipmentDay(order:Order){
 const at=order.delivery?.startsWith('cdek_')?order.cdekTransferredAt||order.shippedAt:order.shippedAt;
 if(!at||!Number.isFinite(Date.parse(at)))return '';
 return moscowDate.format(new Date(at));
}
export function shipmentStats(state:Pick<State,'employees'|'orders'>,actor:Employee,from:string,to:string,department='',byDay=false){
 const operators=operatorStats({...state,orders:[]},actor,'','').filter(e=>!department||e.department===department);
 const allowed=new Map(operators.map(e=>[e.id,e]));
 const rows=new Map<string,{id:string;label:string;sentCdek:number;sentPost:number;sentMoscow:number;sent:number;sentAmountCents:number;redeemed:number;returned:number;orders:Order[]}>();
 for(const order of new Map(state.orders.map(o=>[o.id,o])).values()){
  const employee=allowed.get(order.manager),day=shipmentDay(order);
  if(!employee||order.testOnly||!day||from&&day<from||to&&day>to||!['cdek_pickup','cdek_courier','russian_post','moscow_courier'].includes(order.delivery||''))continue;
  const id=byDay?day:employee.id;
  let row=rows.get(id);
  if(!row){row={id,label:byDay?day:employee.login,sentCdek:0,sentPost:0,sentMoscow:0,sent:0,sentAmountCents:0,redeemed:0,returned:0,orders:[]};rows.set(id,row);}
  row.sent++;row.sentAmountCents+=Math.round(total(order)*100);if(order.status==='redeemed')row.redeemed++;if(order.status==='returned')row.returned++;
  if(order.delivery?.startsWith('cdek_'))row.sentCdek++;
  if(order.delivery==='russian_post')row.sentPost++;
  if(order.delivery==='moscow_courier')row.sentMoscow++;
  row.orders.push(order);
 }
 return [...rows.values()].map(({sentAmountCents,...row})=>({...row,sentAmount:sentAmountCents/100}));
}

export function shipmentBuyoutRate(row:{sent:number;redeemed:number}){return row.sent>0?row.redeemed/row.sent*100:0;}

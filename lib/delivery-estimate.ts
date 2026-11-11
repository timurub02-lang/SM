import type {Order} from './crm.ts';
import {shiftDate,workingDay} from './premium-periods.ts';

export function deliveryEstimate(order:Pick<Order,'delivery'|'cdekTariff'|'cdekAcceptedAt'>){
 if(!order.delivery?.startsWith('cdek_')||!order.cdekTariff)return null;
 const {min,max}=order.cdekTariff;
 if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<min||max>365)return null;
 const accepted=Date.parse(order.cdekAcceptedAt||'');
 if(!Number.isFinite(accepted))return {min,max};
 const start=new Date(accepted+3*3600000).toISOString().slice(0,10);
 const add=(count:number)=>{
  let day=start,remaining=count;
  while(remaining){day=shiftDate(day,1);if(workingDay(day))remaining--;}
  return day;
 };
 try{return {min,max,start,from:add(min),to:add(max)};}
 catch{return {min,max,start};}
}

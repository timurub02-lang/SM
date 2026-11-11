import {packingStage,type Order,type Client,type Employee} from './crm.ts';

export function internalWaybill(order:Order,client:Client,manager?:Employee,callbacks?:{printBoth?:boolean;phones:string[];departments:Record<string,string>}){
 return {
  id:order.id,
  operator:manager?.login||'—',
  client:client.name,
  phone:client.phone,
  address:order.address??client.address,
  callbackPhone:callbacks?.printBoth?(callbacks.phones.filter(Boolean).join(' · ')||'—'):(manager?.department&&callbacks?.phones[Number(callbacks.departments[manager.department])-1])||'—',
  comment:order.logisticComment||'—',
  items:order.items.map(({name,quantity,price})=>({name,quantity,price})),
 };
}
export type WaybillData=ReturnType<typeof internalWaybill>;

export function selectedPackingOrders(orders:Order[],ids:string[]){
 return orders.filter(order=>ids.includes(order.id)&&(order.delivery==="moscow_courier"?packingStage(order)==="new":packingStage(order)==="calculated"));
}

export function courierCheatsheet(order:Order,client:Client,manager?:Employee,courier?:Employee){
 return {id:order.id,client:client.name,phone:client.phone,address:order.address??client.address,
  comment:order.logisticComment||'—',courier:courier?.name||order.courier?.name||'—',
  author:manager?.name||order.legacyLv?.originalOperatorLogin||order.manager||'—',
  amount:order.items.reduce((sum,item)=>sum+item.quantity*Math.round(item.price*100),0)/100};
}
export type CourierCheatsheetData=ReturnType<typeof courierCheatsheet>;

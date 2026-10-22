import type {Order,Client,Employee} from './crm.ts';

export function internalWaybill(order:Order,client:Client,manager?:Employee,callbacks?:{printBoth?:boolean;phones:string[];departments:Record<string,string>}){
 return {
  id:order.id,
  operator:manager?.login||'—',
  client:client.name,
  phone:client.phone,
  address:order.address??client.address,
  callbackPhone:callbacks?.printBoth?(callbacks.phones.filter(Boolean).join(' · ')||'—'):(manager?.department&&callbacks?.phones[Number(callbacks.departments[manager.department])-1])||'—',
  comment:order.waybillComment||'—',
  items:order.items.map(({name,quantity,price})=>({name,quantity,price})),
 };
}
export type WaybillData=ReturnType<typeof internalWaybill>;

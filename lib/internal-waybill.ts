import type {Order,Client,Employee} from './crm.ts';

export function internalWaybill(order:Order,client:Client,manager?:Employee,callbacks?:{phones:string[];departments:Record<string,string>}){
 return {
  id:order.id,
  operator:manager?.login||'—',
  client:client.name,
  phone:client.phone,
  address:order.address??client.address,
  callbackPhone:(manager?.department&&callbacks?.phones[Number(callbacks.departments[manager.department])-1])||'—',
  comment:order.waybillComment||'—',
  items:order.items.map(({name,quantity,price})=>({name,quantity,price})),
 };
}
export type WaybillData=ReturnType<typeof internalWaybill>;

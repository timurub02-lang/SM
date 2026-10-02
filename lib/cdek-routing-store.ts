import {db} from './db';
export {routingReservationGuard} from './cdek-routing';
import {shipmentAmountSql,chooseRouting,routingAmount,type RoutingConfig,type RoutingAccount,type RoutingUsage} from './cdek-routing';
import type {Order} from './crm';
export const routingKey='cdek-routing';
export async function routingSettings(){
 const d=db();const [row,rows]=await Promise.all([d.prepare('SELECT data FROM settings WHERE id=?').bind(routingKey).first<{data:string}>(),d.prepare("SELECT id,data FROM settings WHERE id IN ('cdek-1','cdek-2','cdek-3','cdek-4') ORDER BY id").all<{id:string;data:string}>()]);
 const config:RoutingConfig=row?JSON.parse(row.data):{enabled:false,revision:'',rules:[]};
 const accounts:RoutingAccount[]=rows.results.map(r=>{const a=JSON.parse(r.data);return {slot:Number(r.id.slice(-1)),name:a.name,configured:!!(a.clientId&&a.clientSecret)};});
 return {config,accounts,raw:row?.data||''};
}
export async function orderRouting(order:Order){
 const settings=await routingSettings();const d=db();
 const manager=await d.prepare('SELECT data FROM employees WHERE id=?').bind(order.manager).first<{data:string}>();
 // ponytail: load shipment summaries for this small CRM; aggregate per window in SQL if volume grows.
 const rows=await d.prepare(`SELECT json_extract(s.data,'$.slot') slot,json_extract(s.data,'$.createdAt') createdAt,json_extract(s.data,'$.state') state,${shipmentAmountSql} amountCents FROM settings s WHERE s.id LIKE 'cdek-shipment-%' AND s.id<>?`).bind(`cdek-shipment-${order.id}`).all<RoutingUsage>();
 const choice=chooseRouting(settings.config,settings.accounts,order,manager?JSON.parse(manager.data).department||'':'',rows.results);
 return {...settings,choice,managerRaw:manager?.data||'',amountCents:routingAmount(order)};
}
export function assertRoutingSlot(route:Awaited<ReturnType<typeof orderRouting>>,slot:number){if(route.choice&&route.choice.slot!==slot)throw Error('СДЭК: изменился аккаунт по правилам. Пересчитайте доставку перед выгрузкой');}

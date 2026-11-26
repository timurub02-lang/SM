import {accountRowsWhere,accountVersionSql,publicAccount,departmentAAccount} from './cdek-accounts';
import {db} from './db';
export {routingReservationGuard} from './cdek-routing';
import {shipmentAmountSql,chooseRouting,routingAmount,type RoutingConfig,type RoutingUsage} from './cdek-routing';
import type {Order} from './crm';
export const routingKey='cdek-routing';
export async function routingSettings(){
 const d=db();const [row,rows]=await Promise.all([
  d.prepare('SELECT data FROM settings WHERE id=?').bind(routingKey).first<{data:string}>(),
  d.prepare(`SELECT id,data,${accountVersionSql} AS version FROM settings WHERE ${accountRowsWhere} ORDER BY CAST(substr(id,6) AS INTEGER)`).all<{id:string;data:string;version:string}>()
 ]);
 const config:RoutingConfig=row?JSON.parse(row.data):{enabled:false,revision:'',rules:[]};
 const accounts=rows.results.map(publicAccount);
 return {config,accounts,accountVersion:String(rows.results[0]?.version||'[]'),raw:row?.data||''};
}
export async function orderRouting(order:Pick<Order,'id'|'manager'|'items'>){
 const settings=await routingSettings();const d=db();
 const manager=await d.prepare('SELECT data FROM employees WHERE id=?').bind(order.manager).first<{data:string}>();
 // ponytail: load shipment summaries for this small CRM; aggregate per window in SQL if volume grows.
 const rows=await d.prepare(`SELECT json_extract(s.data,'$.slot') slot,json_extract(s.data,'$.createdAt') createdAt,json_extract(s.data,'$.state') state,${shipmentAmountSql} amountCents FROM settings s WHERE s.id LIKE 'cdek-shipment-%' AND s.id<>?`).bind(`cdek-shipment-${order.id}`).all<RoutingUsage>();
 const department=manager?JSON.parse(manager.data).department||'':'';
 const choice=chooseRouting(settings.config,settings.accounts,order,department,rows.results);
 return {...settings,accounts:settings.accounts.filter(a=>departmentAAccount(a)===(department==='5')),choice,managerRaw:manager?.data||'',amountCents:routingAmount(order)};
}

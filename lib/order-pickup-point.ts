import type {Order,Employee} from './crm.ts';
import {isDepartmentOrder} from './department-orders.ts';
export type PickupPoint={code:string;address:string;workTime:string;city?:string;sameLocality?:boolean;postalCode?:string;sameStreet?:boolean;samePostalCode?:boolean;allowedCod?:boolean};
export const pickupPointContext=(o:Pick<Order,'delivery'|'address'|'addressParts'|'items'>)=>JSON.stringify([o.delivery,o.address,o.addressParts,o.items.map(i=>[i.name,i.quantity])]);
export function orderPickupPoint(o:Pick<Order,'delivery'|'address'|'addressParts'|'items'|'cdekTariff'|'cdekPickupPoint'>){
 if(o.delivery!=='cdek_pickup')return undefined;
 return o.cdekTariff?.deliveryPoint||(o.cdekPickupPoint?.context===pickupPointContext(o)?o.cdekPickupPoint:undefined);
}
export const canPreviewOrderDelivery=(o:Order,e:Employee,staff:Employee[])=>['draft','rework'].includes(o.status)&&!o.cdekExported&&(e.role==='admin'||e.role==='operator'&&o.manager===e.id||isDepartmentOrder(e,o,staff));
export const canSelectOrderPickupPoint=(o:Order,e:Employee,staff:Employee[])=>o.delivery==='cdek_pickup'&&canPreviewOrderDelivery(o,e,staff);
export const orderPostalCode=(o:Pick<Order,'addressParts'|'address'>)=>o.addressParts?.postalCode?.trim()||o.address?.match(/^\s*(\d{6})(?=[\s,]|$)/)?.[1]||'';
export function selectedCachedPickupPoint(o:Order,cache:any,code:string,selectionId:string,now:number){
 if(!cache||cache.id!==selectionId||cache.context!==pickupPointContext(o)||!Number.isFinite(cache.expiresAt)||cache.expiresAt<now)throw Error('Адрес или корзина изменились либо список устарел. Загрузите ПВЗ заново');
 const point:PickupPoint|undefined=cache.points?.find((p:PickupPoint)=>p.code===code);
 if(point&&point.allowedCod!==true)throw Error('Загрузите ПВЗ заново и выберите пункт с наложенным платежом');
 if(!point)throw Error('Выберите ПВЗ из загруженного списка');
 return {code:point.code,address:point.address,workTime:point.workTime,...(point.postalCode?{postalCode:point.postalCode}:{}),context:cache.context};
}

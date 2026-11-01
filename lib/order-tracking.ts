import type {Order} from './crm.ts';
export const cdekTrackingUrl=(number:string)=>'https://www.cdek.ru/ru/tracking/?order_id='+encodeURIComponent(number.trim());
export function orderTracking(order:Pick<Order,'delivery'|'cdekTrackingNumber'|'legacyLv'>){
 if(!order.delivery?.startsWith('cdek_'))return null;
 const number=(order.cdekTrackingNumber||order.legacyLv?.track||'').trim();
 return number?{number,url:cdekTrackingUrl(number)}:null;
}

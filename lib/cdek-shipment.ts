import {z} from 'zod';
import type {Order,Client} from './crm.ts';
import {normalizePhone} from './crm.ts';
import type {Product} from './warehouse.ts';
export const shipmentFormSchema=z.object({shipmentPoint:z.string().trim().max(255).default(''),deliveryPoint:z.string().trim().max(255).default(''),senderAddress:z.string().trim().max(255).default(''),payment:z.enum(['cod','prepaid']),deliveryCost:z.number().min(0).max(1000000)});
export type ShipmentForm=z.infer<typeof shipmentFormSchema>;
export type Shipment={recipientPhone?:string;routingAmountCents?:number;routingRuleId?:string;routingReason?:string;attempt:string;slot:number;account:string;state:'sending'|'pending'|'ready'|'invalid'|'unknown';uuid?:string;number?:string;error?:string;createdAt:string;form:ShipmentForm;downloadedAt?:string;printId?:string;printAt?:string};
export function shipmentPayload(order:Order,client:Client,products:Product[],form:ShipmentForm){
 const recipientPhone=normalizePhone(client.phone||'');if(!recipientPhone)throw Error('Укажите корректный телефон в карточке клиента перед выгрузкой в СДЭК');
 const tariff=order.cdekTariff;if(!tariff||tariff.params.delivery!==order.delivery)throw Error('Сначала сохраните тариф доставки');
 if(!['packing','phone'].includes(order.status))throw Error('Выгрузка доступна на упаковке или подготовке отправления');
 const p=tariff.params;
 if(p.originMode==='warehouse'&&!form.shipmentPoint)throw Error('Выберите пункт сдачи посылки');
 if(p.originMode==='door'&&(!form.senderAddress||!/[а-яa-z]/i.test(form.senderAddress)||!/[0-9]/.test(form.senderAddress)))throw Error('Укажите полный адрес склада с домом');
 if(order.delivery==='cdek_pickup'&&!form.deliveryPoint)throw Error('Выберите ПВЗ получателя');
 if(order.delivery==='cdek_courier'&&(!order.addressParts?.house||!order.address))throw Error('Укажите полный адрес получателя с домом в заказе');
 if(!order.items.length)throw Error('Корзина заказа пуста');
 const items=order.items.map(item=>{
  const product=products.find(x=>x.name.trim().toLowerCase()===item.name.trim().toLowerCase());
  if(!product?.sku||!product.weight||product.cost===null||product.payment===null)throw Error(`Заполните артикул, вес, стоимость и оплату товара «${item.name}» на складе`);
  return {name:item.name,ware_key:product.sku,payment:{value:form.payment==='prepaid'?0:product.payment},cost:product.cost,weight:product.weight,amount:item.quantity};
 });
 if(new Set(items.map(i=>i.ware_key)).size!==items.length)throw Error('Объедините одинаковые товары в одну строку корзины');
 if(items.reduce((n,i)=>n+i.weight*i.amount,0)>Math.ceil(p.weight*1000))throw Error('Вес посылки меньше суммарного веса товаров. Пересчитайте доставку');
 return {type:1,number:order.id,tariff_code:tariff.code,recipient:{name:client.name,phones:[{number:recipientPhone}]},
  ...(p.originMode==='warehouse'?{shipment_point:form.shipmentPoint}:{from_location:{country_code:'RU',postal_code:p.originPostalCode,address:form.senderAddress}}),
  ...(order.delivery==='cdek_pickup'?{delivery_point:form.deliveryPoint}:{to_location:{country_code:'RU',postal_code:order.addressParts?.postalCode,address:order.address}}),
  delivery_recipient_cost:{value:form.deliveryCost},packages:[{number:'1',weight:Math.ceil(p.weight*1000),length:p.length,width:p.width,height:p.height,items}]};
}
export function cdekErrors(data:any){return [...(data.errors||[]),...(data.requests||[]).flatMap((r:any)=>r.errors||[])].map((e:any)=>[e.code,e.message].filter(Boolean).join(': ')).join('; ').slice(0,1200);}
export function shipmentResult(data:any):Pick<Shipment,'state'|'uuid'|'number'|'error'>{
 const request=(data.requests||[]).filter((r:any)=>r.type==='CREATE').sort((a:any,b:any)=>String(b.date_time||'').localeCompare(String(a.date_time||'')))[0]||data.requests?.[0];
 const error=cdekErrors({errors:data.errors,requests:request?[request]:[]});const uuid=typeof data.entity?.uuid==='string'?data.entity.uuid:undefined;
 const number=data.entity?.cdek_number?String(data.entity.cdek_number):undefined;
 if(request?.state==='INVALID'||error)return {state:'invalid',uuid,error:error||'СДЭК отклонил отправление'};
 return {state:request?.state==='SUCCESSFUL'&&number?'ready':'pending',uuid,number};
}

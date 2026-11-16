import type {Order,Employee} from './crm.ts';
import {courierWarehouseReturn} from './courier.ts';
import {isBasketTotal} from './basket-total.ts';

export function canReceiveWarehouseReturn(o:Order,role:Employee['role']){
 return ['admin','logistic','chief_logistic'].includes(role)&&courierWarehouseReturn(o)&&!o.warehouseReturnedAt&&(!o.legacyLv||o.legacyLv.trial===false&&(['moscow_courier','russian_post'].includes(o.delivery||'')||!!o.cdekReturn?.verifiedAt));
}
export function legacyReturnItems(o:Order,products:{id:string;name:string;blocked?:boolean}[]){
 const quantities=new Map<string,number>();
 for(const item of o.items.filter(item=>!isBasketTotal(item))){
  const matches=products.filter(p=>p.name.trim().toLocaleLowerCase('ru')===item.name.trim().toLocaleLowerCase('ru'));
  if(matches.length!==1)throw Error('Не найден однозначный складской товар: '+item.name);
  const product=matches[0];
  if(product.blocked)throw Error('Сначала сверьте незавершённую складскую операцию ЛВ: '+item.name);
  if(!Number.isSafeInteger(item.quantity)||item.quantity<=0)throw Error('Проверьте количество товара: '+item.name);
  quantities.set(product.id,(quantities.get(product.id)||0)+item.quantity);
 }
 if(!quantities.size)throw Error('В заказе нет товаров для приёма на склад');
 return [...quantities].map(([productId,quantity])=>({productId,quantity}));
}

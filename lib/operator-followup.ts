import {canOperatorAmendMissed,markClientWaiting,type Employee,type Order} from './crm.ts';
export function operatorFollowup(e:Employee,before:Order,after:Order,message:string,now:string,staff:Employee[]=[]){
 if(!canOperatorAmendMissed(e,before,staff))throw Error('Изменения доступны только в своём заказе с недозвоном логиста до выгрузки');
 if(after.delivery!==before.delivery)throw Error('Способ доставки меняет логист');
 const changes:string[]=[];
 if(after.address!==before.address||JSON.stringify(after.addressParts)!==JSON.stringify(before.addressParts))changes.push(`Адрес: ${before.address||'не указан'} → ${after.address||'не указан'}`);
 const basket=(items:Order['items'])=>items.map(i=>`${i.name} × ${i.quantity}, ${i.price} ₽/шт.`).join('; ')||'пусто';
 if(JSON.stringify(after.items)!==JSON.stringify(before.items))changes.push(`Корзина: ${basket(before.items)} → ${basket(after.items)}`);
 if(after.comment!==before.comment)changes.push(`Комментарий к заказу: ${before.comment||'—'} → ${after.comment||'—'}`);
 const next=markClientWaiting(e,after,now,staff);
 next.clientWaiting={...next.clientWaiting!,message,changes};
 return next;
}

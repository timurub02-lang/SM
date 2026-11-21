import {z} from 'zod';
import {type Order} from './crm.ts';
import {orderTracking} from './order-tracking.ts';

export function canSyncCdekAmount(o:Order,exported=o.cdekExported){
 return o.delivery?.startsWith('cdek_') && ['packing','phone','shipping','pickup'].includes(o.status)
  && !o.testOnly && !o.cdekDeleting && !o.cdekReturn && !o.paymentReceivedAt && !o.cdekRemittances?.length
  && !!(exported || o.cdekTransferredAt || orderTracking(o));
}

const rubles=z.number().min(0).max(10000000).multipleOf(0.01);
const payment=z.object({value:rubles});
const invoice=z.object({
 packages:z.array(z.object({items:z.array(z.object({amount:z.number().int().positive(),payment})).min(1)})).min(1),
 delivery_recipient_cost:payment.optional(),
 delivery_recipient_cost_adv:z.array(z.unknown()).max(0).optional(),
 recipient_currency:z.literal('RUB').optional(),
 is_return:z.literal(false).optional(),is_reverse:z.literal(false).optional(),is_client_return:z.literal(false).optional()
});

export function cdekPayableAmount(entity:unknown){
 const result=invoice.safeParse(entity);
 if(!result.success)throw Error('Не удалось подтвердить однозначную сумму к оплате в рублях по этой накладной');
 const data=result.data;
 let cents=Math.round((data.delivery_recipient_cost?.value??0)*100);
 for(const box of data.packages)for(const item of box.items)cents+=item.amount*Math.round(item.payment.value*100);
 if(cents===0)throw Error('В накладной нет суммы к получению. Проверьте предоплату в СДЭК');
 if(!Number.isSafeInteger(cents)||cents>1000000000)throw Error('Сумма СДЭК выходит за допустимый диапазон заказа');
 return cents/100;
}

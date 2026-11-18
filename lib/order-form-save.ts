import {z} from 'zod';
import {addressPartsSchema} from './address.ts';
import {deliverySchema} from './crm.ts';
const name={name:z.string().trim().min(1,'Укажите ФИО получателя').max(200),clientVersion:z.number().int().positive()};
export const orderFormSchema=z.array(z.discriminatedUnion('action',[
 z.object({action:z.literal('updateOrder'),delivery:deliverySchema,address:z.string().trim().max(500),addressParts:addressPartsSchema,items:z.array(z.object({name:z.string(),quantity:z.number(),price:z.number()})).max(100).optional(),newOrderComment:z.string().trim().max(3000).optional(),operatorFollowup:z.boolean().optional(),logisticMessage:z.string().trim().max(3000).optional(),addressConfirmed:z.boolean().optional()}),
 z.object({action:z.literal('updateMoscowDetails'),...name,address:z.string().trim().min(1).max(500),addressParts:addressPartsSchema,logisticComment:z.string().trim().max(3000),addressConfirmed:z.boolean().optional()}),
 z.object({action:z.literal('updateRecipientName'),...name}),
 z.object({action:z.literal('updateDelivery'),delivery:deliverySchema}),
 z.object({action:z.literal('saveManualDeliveryCost'),amount:z.number().finite().min(0).max(1000000)}),
 z.object({action:z.literal('savePostalTracking'),trackingNumber:z.string().transform(v=>v.replace(/\s+/g,'').toUpperCase()).pipe(z.string().max(40).regex(/^[A-Z0-9]*$/,'Трек-номер должен содержать только латинские буквы и цифры'))}),
 z.object({action:z.literal('updateLogisticComment'),text:z.string().trim().max(3000)}),
 z.object({action:z.literal('transition'),to:z.enum(['redeemed','returned']),reason:z.string().trim().max(3000).optional()}),
 z.object({action:z.literal('comment'),text:z.string().trim().min(1).max(3000)}),
 z.object({action:z.literal('selectOrderPickupPoint'),code:z.string().trim().min(1).max(50),selectionId:z.string().uuid()})
])).min(1,'Нет изменений для сохранения').max(9).superRefine((changes,ctx)=>{
 const actions=changes.map(c=>c.action);
 if(actions.includes('transition')&&actions.some(a=>!['transition','updateLogisticComment','savePostalTracking','comment'].includes(a)))ctx.addIssue({code:'custom',message:'Перед сменой статуса сохраните остальные данные заказа'});
 if(new Set(actions).size!==actions.length||actions.includes('updateOrder')&&actions.some(a=>['updateMoscowDetails','updateDelivery'].includes(a))||actions.includes('updateMoscowDetails')&&actions.some(a=>['updateRecipientName','updateLogisticComment','updateDelivery'].includes(a)))ctx.addIssue({code:'custom',message:'Повторяющиеся изменения заказа'});
});
export type OrderFormChange=z.infer<typeof orderFormSchema>[number];
export function primaryOrderFormChange(changes:OrderFormChange[]){return changes.find(c=>c.action==='transition')||changes.find(c=>c.action==='updateMoscowDetails')||changes.find(c=>c.action==='updateOrder')||changes.find(c=>c.action==='updateDelivery')||changes[0];}

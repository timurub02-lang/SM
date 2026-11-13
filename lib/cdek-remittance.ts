import type {Order} from './crm.ts';
export type CdekRemittance={slot:number;registry:string;tracking:string;paymentDate:string;amountCents:number;collectedCents:number};
export const isCdekOrder=(o:Pick<Order,'delivery'|'cdekHistoryRecovery'>)=>(!o.delivery&&!!o.cdekHistoryRecovery)||['cdek_pickup','cdek_courier'].includes(o.delivery||'');
// Keep the first recorded receipt/date so later duplicates cannot move an order between periods.
export function premiumRemittance(o:Pick<Order,'cdekRemittances'>){
 const rows=o.cdekRemittances||[],first=rows[0];
 return first&&rows.every(r=>r.amountCents===first.amountCents&&r.collectedCents===first.collectedCents)?first:undefined;
}
export const hasRemittanceConflict=(o:Pick<Order,'cdekRemittances'>)=>(o.cdekRemittances?.length||0)>1&&!premiumRemittance(o);
export function cdekMoneyLabel(o:Order){
 if(o.status!=='redeemed')return '';
 if(!isCdekOrder(o))return o.importedPayment?'Деньги получены · '+o.importedPayment.source:o.priorPremiumPaid?.paymentAccepted?'Историческая оплата принята · '+o.priorPremiumPaid.source:'';
 const r=premiumRemittance(o);
 if(r)return `Деньги получены · реестр №${r.registry} · ${r.paymentDate.split('-').reverse().join('.')}${o.cdekRemittances!.length>1?' · дубль не начисляется':''}${o.cdekHistoryRecovery?' · заказ создан из истории по реестру СДЭК':''}`;
 if((o.cdekRemittances?.length||0)>1)return 'Несколько перечислений · требуется проверка администратора';
 if(o.importedPayment)return 'Деньги получены · '+o.importedPayment.source;
 return 'Оплачен · ожидается приём денег';
}
export function sameRemittance(a:CdekRemittance,b:CdekRemittance){return a.slot===b.slot&&a.registry===b.registry&&a.tracking===b.tracking&&a.paymentDate===b.paymentDate&&a.amountCents===b.amountCents&&a.collectedCents===b.collectedCents;}

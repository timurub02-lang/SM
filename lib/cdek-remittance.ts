import type {Order} from './crm.ts';
export type CdekRemittance={slot:number;registry:string;tracking:string;paymentDate:string;amountCents:number;collectedCents:number};
export const isCdekOrder=(o:Pick<Order,'delivery'>)=>['cdek_pickup','cdek_courier'].includes(o.delivery||'');
export function cdekMoneyLabel(o:Order){
 if(!isCdekOrder(o)||o.status!=='redeemed')return '';
 if(o.cdekRemittances?.length===1){const r=o.cdekRemittances[0];return `Деньги получены · реестр №${r.registry} · ${r.paymentDate.split('-').reverse().join('.')}`;}
 if((o.cdekRemittances?.length||0)>1)return 'Несколько перечислений · требуется проверка администратора';
 if(o.importedPayment)return 'Деньги получены · '+o.importedPayment.source;
 return 'Оплачен · ожидается приём денег';
}
export function sameRemittance(a:CdekRemittance,b:CdekRemittance){return a.slot===b.slot&&a.registry===b.registry&&a.tracking===b.tracking&&a.paymentDate===b.paymentDate&&a.amountCents===b.amountCents&&a.collectedCents===b.collectedCents;}

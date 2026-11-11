import {draftDeadline,hasActiveOrder,reworkTimeLeft,type Client,type Order} from './crm.ts';

export function clientRetentionLabel(client:Client,orders:Order[],now=Date.now()){
 if(!client.owner)return 'Доступен всем';
 const related=orders.filter(o=>o.clientId===client.id);
 if(hasActiveOrder(related,client.id)){
  const handoff=related.filter(o=>o.manager===client.owner).map(draftDeadline).filter((x):x is string=>!!x).sort()[0];
  return handoff?`Есть активный заказ · До передачи логисту: ${reworkTimeLeft(handoff,now)}`:'Есть активный заказ';
 }
 // Only a paid payroll period confirms payment, just as in the retention reconciler.
 if(related.some(o=>o.manager===client.owner&&o.status==='redeemed'&&o.premiumStage?.status!=='paid'))return 'Ожидается выплата премии';
 const remaining=Date.parse(client.assignedUntil||'')-now;
 if(Number.isFinite(remaining))return remaining>0?`До открепления: ${Math.ceil(remaining/86400000)} дн.`:'Срок закрепления истёк';
 return 'Срок закрепления не определён';
}

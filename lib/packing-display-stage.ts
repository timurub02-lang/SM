import {packingStage,type Order} from './crm.ts';
import {moscowDate} from './base-distribution.ts';
export function packingDisplayStage(order:Order,now=Date.now()){
 const stage=packingStage(order);
 if(stage!=='dispatched')return stage;
 const at=Date.parse(order.cdekTransferredAt||order.shippedAt||'');
 return Number.isFinite(at)&&moscowDate(new Date(at))===moscowDate(new Date(now))?'dispatched':'in_cdek';
}

export function manualDeliveryStageCounts(orders:Order[],stage:string,now=Date.now()){
 const today=moscowDate(new Date(now));
 return {total:orders.length,today:orders.filter(o=>{
  const value=stage==='payment_received'?(!o.importedPayment&&!o.priorPremiumPaid?.paymentAccepted?o.paymentReceivedAt:undefined):stage==='warehouse_returned'?o.warehouseReturnedAt:undefined;
  const at=Date.parse(value||'');return Number.isFinite(at)&&moscowDate(new Date(at))===today;
 }).length};
}

import {legacyPremiumPaid} from './legacy-premium-paid.ts';
import {type Order,type Employee} from './crm.ts';
import {isCdekOrder,premiumRemittance} from './cdek-remittance.ts';
import {seesOrder} from './permissions.ts';

export function premiumOrders(orders:Order[],employee:Employee,staff:Employee[]):{order:Order;date:string;amount:number;registry:string;periodId?:string}[]{
 if(!['admin','operator','department_head'].includes(employee.role))return [];
 return orders.filter(o=>!o.testOnly&&!legacyPremiumPaid(o)&&o.status==='redeemed'&&seesOrder(employee,o,staff)).flatMap(order=>{
  const receipt=premiumRemittance(order);
  if(order.importedPayment){const r=order.importedPayment;return [{order,date:receipt?receipt.paymentDate:'',amount:receipt?receipt.amountCents/100:r.amount,registry:receipt?receipt.registry:'',periodId:r.periodId}];}
  if(isCdekOrder(order)){
   if(!receipt)return [];
   const r=receipt;
   if(r.amountCents<=0||r.collectedCents<=0||!/^\d{4}-\d{2}-\d{2}$/.test(r.paymentDate))return [];
   return [{order,date:r.paymentDate,amount:r.amountCents/100,registry:r.registry}];
  }
  if(!['moscow_courier','russian_post'].includes(order.delivery||'')||!order.paymentReceivedAt)return [];
  const timestamp=Date.parse(order.paymentReceivedAt),amount=order.paymentReceipt?.amount??order.paymentReceivedAmount;
  if(!Number.isFinite(timestamp)||!Number.isFinite(amount)||!amount||amount<=0)return [];
  return [{order,date:new Date(timestamp+3*3600000).toISOString().slice(0,10),amount,registry:''}];
 }).sort((a,b)=>b.date.localeCompare(a.date)||a.order.id.localeCompare(b.order.id));
}

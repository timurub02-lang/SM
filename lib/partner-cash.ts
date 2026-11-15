import type {Employee,Order} from './crm.ts';
import type {PayrollOrder,PayrollRow} from './premium-ledger.ts';
import {premiumRemittance} from './cdek-remittance.ts';
export const isEmil=(e:Pick<Employee,'login'>)=>e.login==='A_Emil';
export type PartnerSettings={revision:string;taxRate:number|null;communication:number;bank:number;productPrices?:Record<string,number>};
export const defaultPartnerSettings:PartnerSettings={revision:'',taxRate:null,communication:0,bank:0};
export function partnerCalculation(members:PayrollOrder[],orders:Order[],payroll:PayrollRow[],settings:PartnerSettings){
 const byId=new Map(orders.map(o=>[o.id,o]));
 const byExternal=new Map(orders.map(o=>[o.legacyLv?.orderId||o.id.replace(/^LV-/,''),o]));
 const products=new Map<string,{name:string;quantity:number;price:number;total:number;orders:string[]}>();
 const seen=new Set<string>();let missingProducts=0;
 const receipts=members.filter(m=>m.department==='5'&&!m.historyOnly).flatMap(m=>{
  if(seen.has(m.externalId))return [];seen.add(m.externalId);
  const o=(m.id?byId.get(m.id):undefined)||byExternal.get(m.externalId);
  if(!o||!o.items?.length)missingProducts++;
  const items=(o?.items||[]).filter(item=>!/^итого$/i.test(item.name.trim()));
  if(o?.items?.length&&!items.length)missingProducts++;
  for(const item of items){
   if(!Number.isFinite(item.quantity)||item.quantity<=0){missingProducts++;continue;}
   const row=products.get(item.name)||{name:item.name,quantity:0,price:settings.productPrices?.[item.name]??300,total:0,orders:[]};
   row.quantity+=item.quantity;row.total=Math.round(row.quantity*Math.round(row.price*100));if(!row.orders.includes(o!.id))row.orders.push(o!.id);products.set(item.name,row);
  }
  const r=o&&premiumRemittance(o);if(!r)return [];
  return [{order:o!.id,registry:r.registry,date:r.paymentDate,collected:r.collectedCents,transferred:r.amountCents,tax:settings.taxRate===null?null:Math.round(r.collectedCents*settings.taxRate/100)}];
 });
 const transferred=receipts.reduce((s,r)=>s+r.transferred,0),collected=receipts.reduce((s,r)=>s+r.collected,0);
 const tax=settings.taxRate===null?null:receipts.reduce((s,r)=>s+r.tax!,0);
 const goods=[...products.values()].reduce((s,r)=>s+r.total,0);
 const normal=payroll.filter(r=>r.department==='5'&&!r.input.sz);
 const premium=normal.some(r=>r.payout===null)?null:normal.reduce((s,r)=>s+Math.round(r.payout!*100),0);
 const balance=tax===null?null:transferred-tax-Math.round((settings.communication+settings.bank)*100)-goods;
 const remaining=balance===null||premium===null||missingProducts?null:balance-premium;
 const share=remaining===null?null:Math.floor(remaining/2);
 return {receipts,products:[...products.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru')),orderCount:seen.size,missingProducts,collected,transferred,tax,goods,premium,balance,remaining,ourShare:share,partnerShare:remaining===null?null:remaining-share!};
}

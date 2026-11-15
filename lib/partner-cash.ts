import {communicationCents,type PartnerMinutes} from './partner-minutes.ts';
import type {Employee,Order} from './crm.ts';
import type {PayrollOrder,PayrollRow} from './premium-ledger.ts';
import {premiumRemittance} from './cdek-remittance.ts';
export const isEmil=(e:Pick<Employee,'login'>)=>e.login==='A_Emil';
export type PartnerExpense={id:string;name:string;date:string;amount:number;at:string;by:string;removedAt?:string;removedBy?:string};
export type PartnerSettings={revision:string;taxRate:number|null;communication:number;bank:number;minutePrice?:number;minutes?:PartnerMinutes;expenses?:PartnerExpense[];productUnitPrice?:number;productPrices?:Record<string,number>};
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
   const row=products.get(item.name)||{name:item.name,quantity:0,price:settings.productUnitPrice??settings.productPrices?.[item.name]??300,total:0,orders:[]};
   row.quantity+=item.quantity;row.total=Math.round(row.quantity*Math.round(row.price*100));if(!row.orders.includes(o!.id))row.orders.push(o!.id);products.set(item.name,row);
  }
  const r=o&&premiumRemittance(o);if(!r)return [];
  return [{order:o!.id,slot:r.slot,registry:r.registry,date:r.paymentDate,collected:r.collectedCents,transferred:r.amountCents,tax:settings.taxRate===null?null:Math.round(r.collectedCents*settings.taxRate/100)}];
 });
 const transferred=receipts.reduce((s,r)=>s+r.transferred,0),collected=receipts.reduce((s,r)=>s+r.collected,0);
 const tax=settings.taxRate===null?null:receipts.reduce((s,r)=>s+r.tax!,0);
 const goods=[...products.values()].reduce((s,r)=>s+r.total,0);
 const normal=payroll.filter(r=>r.department==='5'&&!r.input.sz);
 const premium=normal.some(r=>r.payout===null)?null:normal.reduce((s,r)=>s+Math.round(r.payout!*100),0);
 const communication=communicationCents(settings),expenses=(settings.expenses||[]).filter(e=>!e.removedAt).reduce((sum,e)=>sum+e.amount,0);
 const balance=tax===null||communication===null?null:transferred-tax-communication-Math.round(settings.bank*100)-goods-expenses;
 const remaining=balance===null||premium===null||missingProducts?null:balance-premium;
 const share=remaining===null?null:Math.floor(remaining/2);
 return {receipts,products:[...products.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru')),expenses,communication,orderCount:seen.size,missingProducts,collected,transferred,tax,goods,premium,balance,remaining,ourShare:share,partnerShare:remaining===null?null:remaining-share!};
}

export function partnerRegistries(receipts:(Omit<ReturnType<typeof partnerCalculation>['receipts'][number],'slot'>&{slot?:number})[]){
 const groups=new Map<string,{key:string;registry:string;date:string;slot?:number;orders:typeof receipts;collected:number;transferred:number;tax:number|null}>();
 for(const r of receipts){
  const key=JSON.stringify([r.slot??null,r.registry,r.date]);
  const group=groups.get(key)||{key,registry:r.registry,date:r.date,slot:r.slot,orders:[],collected:0,transferred:0,tax:0};
  group.orders.push(r);group.collected+=r.collected;group.transferred+=r.transferred;group.tax=group.tax===null||r.tax===null?null:group.tax+r.tax;groups.set(key,group);
 }
 return [...groups.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.registry.localeCompare(b.registry));
}

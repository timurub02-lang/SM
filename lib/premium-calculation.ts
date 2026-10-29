import {z} from 'zod';
import {type Employee,type Order} from './crm.ts';
import {premiumOrders} from './premium-orders.ts';
import {isCdekOrder} from './cdek-remittance.ts';
import {periodForReceipt} from './premium-periods.ts';
const amount=z.number().finite().min(0).max(100000000);
export const premiumAdjustmentSchema=z.object({salary:amount,vacation:amount,official:amount,debt:amount,penalty:amount,extra:amount,sz:z.boolean(),firstHalfBonus:amount.nullable()});
export type PremiumAdjustment=z.infer<typeof premiumAdjustmentSchema>;
export type PremiumSaved=PremiumAdjustment&{revision:string};
export function premiumStaff(actor:Employee,target:Employee){return actor.role==='admin'&&['operator','department_head'].includes(target.role)||actor.id===target.id&&['operator','department_head'].includes(actor.role)||actor.role==='department_head'&&!!actor.department&&target.role==='operator'&&target.department===actor.department;}
export function defaultPremiumAdjustment(e:Employee):PremiumAdjustment{return {salary:e.leaderPremium?.fixedPerPeriod??0,vacation:0,official:0,debt:0,penalty:0,extra:0,sz:false,firstHalfBonus:null};}
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function premiumCalculation(orders:Order[],actor:Employee,employees:Employee[],period:string,adjustments:Record<string,PremiumSaved>){
 const eligible=premiumOrders(orders,actor,employees).filter(r=>(r.periodId||r.order.premiumStage?.periodId||periodForReceipt(r.date)?.id)===period);
 const amounts=new Map<string,number>();
 for(const r of eligible){const cents=r.order.importedPayment?Math.round(r.order.importedPayment.amount*100):isCdekOrder(r.order)?r.order.cdekRemittances![0].collectedCents:Math.round(r.amount*100);amounts.set(r.order.manager,(amounts.get(r.order.manager)||0)+cents);}
 const rows=employees.filter(e=>premiumStaff(actor,e)&&(e.role==='operator'||!!e.leaderPremium)).map(employee=>{
  const input=adjustments[employee.id]||defaultPremiumAdjustment(employee),terms=employee.leaderPremium;
  const volume=(amounts.get(employee.id)||0)/100;
  const commission=terms?round(terms.links.reduce((sum,l)=>sum+round((amounts.get(l.operatorId||'')||0)/100*l.rate/100),0)):round(volume*employee.bonus/100);
  const second=period.endsWith('-2'),missingPrior=terms?.model==='udl_guarantee'&&second&&input.firstHalfBonus===null;
  const salary=terms?.model==='udl_guarantee'?(second?Math.max(terms.monthlyGuarantee,commission+(input.firstHalfBonus||0))-terms.firstPeriod:terms.firstPeriod):input.salary;
  const raw=round((terms?.model==='udl_guarantee'?salary:salary+commission)+input.vacation-input.official-input.debt-input.penalty+input.extra);
  const result=missingPrior?null:raw>0?Math.round(raw/50)*50:raw;
  return {employee,input,volume,commission,salary,result,payout:result===null?null:Math.max(0,result),missingPrior};
 });
 return {rows,count:eligible.length,volume:[...amounts.values()].reduce((s,n)=>s+n,0)/100};
}

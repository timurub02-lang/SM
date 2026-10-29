import type {Employee,Order} from './crm.ts';
import {premiumCalculation,type PremiumAdjustment,type PremiumSaved} from './premium-calculation.ts';
import {premiumOrders} from './premium-orders.ts';
import {premiumPeriods} from './premium-periods.ts';

export type PayrollRow={id:string;employeeId?:string;login:string;name:string;department:string;role:'operator'|'department_head';rate:number;volume:number;commission:number;salary:number;input:PremiumAdjustment;result:number|null;payout:number|null;terms?:Employee['leaderPremium']};
export type PayrollOrder={id?:string;externalId:string;employeeId?:string;login:string;department:string;amount:number;amountUnknown?:boolean};
export type PayrollPeriod={status:'open'|'frozen'|'paid';source?:{name:string;sha256:string;importedAt:string};rows?:PayrollRow[];orders?:PayrollOrder[];frozenAt?:string;frozenBy?:string;paidAt?:string;paidBy?:string;signers?:{id:string;name:string;department:string}[];signatures:Record<string,{at:string;by:string}>;knownReceipts?:string[];returns?:{at:string;by:string;rows:PayrollRow[];signatures:PayrollPeriod['signatures']}[]};
export type PremiumLedger={revision:string;activePeriod:string;initialPeriod:string;periods:Record<string,PayrollPeriod>;historyReconciled?:boolean};
export const ledgerKey='premium-ledger';
export const orderKey=(o:Order)=>o.legacyLv?.orderId||o.id.replace(/^LV-/, '');
const admin={id:'premium-system',role:'admin'} as Employee;
export function payrollVisible(actor:Employee,row:Pick<PayrollRow,'employeeId'|'department'>){return actor.role==='admin'||actor.role==='department_head'&&!!actor.department&&row.department===actor.department||actor.role==='operator'&&row.employeeId===actor.id;}
export function rowFromCalculation(r:ReturnType<typeof premiumCalculation>['rows'][number]):PayrollRow{return {id:r.employee.id,employeeId:r.employee.id,login:r.employee.login,name:r.employee.name,department:r.employee.department||'',role:r.employee.role as PayrollRow['role'],rate:r.employee.bonus,volume:r.volume,commission:r.commission,salary:r.salary,input:r.input,result:r.result,payout:r.payout,terms:r.employee.leaderPremium};}
export function recalculateRow(row:PayrollRow,input:PremiumAdjustment,rate:number,period:string):PayrollRow{
 const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
 const commission=row.role==='operator'?round(row.volume*rate/100):row.commission;
 const terms=row.terms,second=period.endsWith('-2'),missing=terms?.model==='udl_guarantee'&&second&&input.firstHalfBonus===null;
 const salary=terms?.model==='udl_guarantee'?(second?Math.max(terms.monthlyGuarantee,commission+(input.firstHalfBonus||0))-terms.firstPeriod:terms.firstPeriod):input.salary;
 const raw=round((terms?.model==='udl_guarantee'?salary:salary+commission)+input.vacation-input.official-input.debt-input.penalty+input.extra);
 const result=missing?null:raw>0?Math.round(raw/50)*50:raw;
 return {...row,rate,commission,salary,input,result,payout:result===null?null:Math.max(0,result)};
}
export function periodOrders(ledger:PremiumLedger,periodId:string,orders:Order[],employees:Employee[]):PayrollOrder[]{
 const p=ledger.periods[periodId];if(!p)return [];
 if(p.orders)return p.orders;
 const period=premiumPeriods.find(x=>x.id===periodId);if(!period)return [];
 const used=new Set(Object.entries(ledger.periods).filter(([id])=>id!==periodId).flatMap(([,v])=>(v.orders||[]).map(o=>o.externalId)));
 const prior=Object.entries(ledger.periods).filter(([id,v])=>id<periodId&&v.status==='paid').sort(([a],[b])=>b.localeCompare(a))[0]?.[1];
 const known=new Set(prior?.knownReceipts||[]);
 return premiumOrders(orders,admin,employees).filter(r=>!used.has(orderKey(r.order))&&r.date<=period.cutoff&&(r.date>=period.from||!!prior&&!known.has(orderKey(r.order)))).map(r=>{
  const e=employees.find(e=>e.id===r.order.manager);
  return {id:r.order.id,externalId:orderKey(r.order),employeeId:r.order.manager,login:e?.login||'',department:e?.department||'',amount:r.order.cdekRemittances?.length===1?r.order.cdekRemittances[0].collectedCents/100:r.amount};
 });
}
export function ledgerRows(ledger:PremiumLedger,period:string,orders:Order[],employees:Employee[],adjustments:Record<string,PremiumSaved>):PayrollRow[]{
 const p=ledger.periods[period];if(!p)return [];
 if(p.rows)return p.status==='open'?p.rows.map(r=>{
  const e=employees.find(e=>e.id===r.employeeId),saved=adjustments[r.employeeId||''];
  const row=saved?recalculateRow(r,saved,e?.bonus??r.rate,period):r;
  return {...row,input:{...row.input,sz:e?.sz??row.input.sz}};
 }):p.rows;
 const eligible=periodOrders(ledger,period,orders,employees),ids=new Set(eligible.map(o=>o.id));
 // Feed selected membership to the existing percentage calculation, including late receipts.
 const cutoff=premiumPeriods.find(p=>p.id===period)!.cutoff;
 const selected=orders.filter(o=>ids.has(o.id)).map(o=>({...o,cdekRemittances:o.cdekRemittances?.map(r=>({...r,paymentDate:cutoff})),paymentReceivedAt:o.paymentReceivedAt?cutoff+'T12:00:00Z':undefined}));
 return premiumCalculation(selected,admin,employees,period,adjustments).rows.map(rowFromCalculation);
}
export function nextPremiumPreview(ledger:PremiumLedger|null,orders:Order[],employees:Employee[]){
 if(!ledger)return null;
 const active=ledger.periods[ledger.activePeriod],index=premiumPeriods.findIndex(p=>p.id===ledger.activePeriod);
 const next=index>=0?premiumPeriods[index+1]:undefined;if(!active||!next)return null;
 // Simulate rollover for membership only. No status, signature or payment is persisted.
 const preview:PremiumLedger={...ledger,periods:{...ledger.periods,[ledger.activePeriod]:{...active,status:'paid',orders:periodOrders(ledger,ledger.activePeriod,orders,employees),knownReceipts:active.knownReceipts??premiumOrders(orders,admin,employees).map(r=>orderKey(r.order))},[next.id]:ledger.periods[next.id]??{status:'open',signatures:{}}}};
 return {period:next.id,orderIds:new Set(periodOrders(preview,next.id,orders,employees).map(o=>o.id))};
}
export function applyPremiumStages(ledger:PremiumLedger|null,orders:Order[],employees:Employee[]){
 const stages=new Map<string,{status:'accrued'|'paid';periodId:string}>();
 if(ledger)for(const [id,p] of Object.entries(ledger.periods))if(p.status==='paid'||id===ledger.activePeriod)for(const o of periodOrders(ledger,id,orders,employees))stages.set(o.externalId,{status:p.status==='paid'?'paid':'accrued',periodId:id});
 return orders.map(o=>({...o,premiumStage:stages.get(orderKey(o))}));
}
export function freezePeriod(ledger:PremiumLedger,period:string,orders:Order[],employees:Employee[],adjustments:Record<string,PremiumSaved>,actor:string,at:string){
 const p=ledger.periods[period];if(period!==ledger.activePeriod||p?.status!=='open')throw Error('Можно зафиксировать только открытый текущий период');
 const membership=periodOrders(ledger,period,orders,employees),rows=ledgerRows(ledger,period,orders,employees,adjustments);
 if(!p.source&&!ledger.historyReconciled&&membership.some(r=>orders.some(o=>o.id===r.id&&o.legacyLv)))throw Error('Сначала сверьте ранее выплаченные заказы ЛВ');
 if(membership.some(r=>orders.some(o=>o.id===r.id&&(o.cdekRemittances?.length||0)>1)))throw Error('Есть заказы с несколькими перечислениями СДЭК. Требуется сверка.');
 if(rows.some(r=>r.result===null))throw Error('Не все суммы рассчитаны');
 if(new Set(membership.map(o=>o.externalId)).size!==membership.length)throw Error('Повтор заказа в ведомости');
 const paid=new Set(Object.values(ledger.periods).filter(v=>v.status==='paid').flatMap(v=>(v.orders||[]).map(o=>o.externalId)));
 if(membership.some(o=>paid.has(o.externalId)))throw Error('Заказ уже оплачен в другой ведомости');
 const departments=[...new Set(rows.map(r=>r.department))];
 const signers=departments.map(department=>{const heads=employees.filter(e=>e.role==='department_head'&&e.department===department&&e.leaderPremium);if(heads.length!==1)throw Error('Не определён единственный руководитель отдела '+department);return {id:heads[0].id,name:heads[0].name,department};});
 if(!signers.length)throw Error('В ведомости нет получателей');
 const frozen:PayrollPeriod={...p,status:'frozen',rows,orders:membership,signers,signatures:{},frozenAt:at,frozenBy:actor,knownReceipts:p.knownReceipts??premiumOrders(orders,admin,employees).map(r=>orderKey(r.order))};
 return {...ledger,revision:crypto.randomUUID(),periods:{...ledger.periods,[period]:frozen}};
}
export function signPeriod(ledger:PremiumLedger,period:string,actor:Employee,at:string){
 const p=ledger.periods[period];if(p?.status!=='frozen'||actor.role!=='department_head'||!p.signers?.some(e=>e.id===actor.id))throw Error('Подписание недоступно');
 if(p.signatures[actor.id])return ledger;
 return {...ledger,revision:crypto.randomUUID(),periods:{...ledger.periods,[period]:{...p,signatures:{...p.signatures,[actor.id]:{at,by:actor.id}}}}};
}
export function payPeriod(ledger:PremiumLedger,period:string,actor:string,at:string){
 const p=ledger.periods[period];if(period!==ledger.activePeriod||p?.status!=='frozen')throw Error('Сначала зафиксируйте текущий период');
 if(!p.signers?.length||p.signers.some(e=>!p.signatures[e.id]))throw Error('Не все руководители подписали расчёт');
 const next=premiumPeriods[premiumPeriods.findIndex(p=>p.id===period)+1];if(!next||ledger.periods[next.id])throw Error('Следующий период недоступен');
 return {...ledger,revision:crypto.randomUUID(),activePeriod:next.id,periods:{...ledger.periods,[period]:{...p,status:'paid' as const,paidAt:at,paidBy:actor},[next.id]:{status:'open' as const,signatures:{}}}};
}

export function reopenPeriod(ledger:PremiumLedger,period:string,actor:string,at:string){
 const p=ledger.periods[period];if(period!==ledger.activePeriod||p?.status!=='frozen')throw Error('Вернуть можно только зафиксированный, ещё не выплаченный период');
 return {...ledger,revision:crypto.randomUUID(),periods:{...ledger.periods,[period]:{...p,status:'open' as const,signatures:{},returns:[...(p.returns||[]),{at,by:actor,rows:p.rows||[],signatures:p.signatures}]}}};
}

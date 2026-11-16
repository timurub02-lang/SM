import type {ActivityDb} from './activity-store.ts';
import type {Employee,Order} from './crm.ts';
import {periodOrders,type PremiumLedger} from './premium-ledger.ts';
import {premiumRemittance} from './cdek-remittance.ts';
import {periodForReceipt} from './premium-periods.ts';
import {bankRegistryKey,readBankRegistries,type BankRegistry} from './cdek-bank-registry.ts';

export type PartnerBank={registries:BankRegistry[];excludedKeys:string[]};
export async function readPartnerBank(d:ActivityDb,ledger:PremiumLedger,period:string,orders:Order[],staff:Employee[]){
 const bank=await readBankRegistries(d);
 const closed:{id:string;data:string}[]=(await d.prepare("SELECT id,data FROM settings WHERE id LIKE 'partner-cash-closed:%' ORDER BY id").all()).results;
 const account:{data:string}|null=await d.prepare("SELECT data FROM settings WHERE id='partner-cash-account'").first();
 const start=account?JSON.parse(account.data).startPeriod:ledger.activePeriod;
 return {...partnerBankForPeriod(ledger,period,orders,staff,bank.registries,closed.map(r=>({period:r.id.slice('partner-cash-closed:'.length),report:JSON.parse(r.data)})),start),revision:bank.revision};
}

export function partnerBankForPeriod(ledger:PremiumLedger,period:string,orders:Order[],staff:Employee[],registries:BankRegistry[],closed:{period:string;report:{bankKeys?:string[];receipts?:{slot?:number;registry:string;date:string}[]}}[],start:string):PartnerBank{
 const byId=new Map(orders.map(o=>[o.id,o])),byExternal=new Map(orders.map(o=>[String(o.legacyLv?.orderId||o.id.replace(/^LV-/,'')),o]));
 const owner=new Map<string,string>(),legacyClosed=new Set<string>(),slots=new Set<number>();
 for(const snapshot of closed){
  for(const key of snapshot.report.bankKeys||[])owner.set(key,snapshot.period);
  for(const r of snapshot.report.receipts||[])if(r.slot!==undefined){const key=bankRegistryKey({...r,slot:r.slot});if(!snapshot.report.bankKeys?.includes(key))legacyClosed.add(key);}
 }
 for(const id of Object.keys(ledger.periods).filter(id=>id>=start).sort())for(const m of periodOrders(ledger,id,orders,staff)){
  if(m.department!=='5'||m.historyOnly)continue;
  const o=(m.id?byId.get(m.id):undefined)||byExternal.get(m.externalId),r=o&&premiumRemittance(o);if(!r)continue;
  slots.add(r.slot);const key=bankRegistryKey({slot:r.slot,registry:r.registry,date:r.paymentDate});
  if(!owner.has(key)&&!legacyClosed.has(key))owner.set(key,id);
 }
 // Unmatched payments and fee-only registries still affect the bank account, never payroll.
 for(const r of registries){
  const key=bankRegistryKey(r);if(owner.has(key)||legacyClosed.has(key)||!slots.has(r.slot))continue;
  const target=periodForReceipt(r.date)?.id;
  if(target&&target>=start&&ledger.periods[target]&&ledger.periods[target].status!=='paid')owner.set(key,target);
 }
 return {registries:registries.filter(r=>owner.get(bankRegistryKey(r))===period&&!legacyClosed.has(bankRegistryKey(r))),excludedKeys:[...owner].filter(([key,id])=>id!==period&&(registries.some(r=>bankRegistryKey(r)===key)||closed.some(s=>s.report.bankKeys?.includes(key)))).map(([key])=>key)};
}

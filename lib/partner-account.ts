import {readPartnerBank} from './partner-bank';
import {db} from './db';
import {initCash} from './cash-db';
import {readPremiumState} from './premium-store';
import {periodOrders,ledgerRows} from './premium-ledger';
import {partnerCalculation,defaultPartnerSettings,isEmil,type PartnerSettings} from './partner-cash';
import {emptySettlements,partnerObligations,type PartnerSettlements} from './partner-settlements';
export async function partnerAccountView(period:string){
 const d=db(),state=await readPremiumState(period);if(!state.ledger)throw Error('Расчёт не настроен');
 const account=await d.prepare("SELECT data FROM settings WHERE id='partner-cash-account'").first<{data:string}>();
 const costRows=await d.prepare("SELECT id,data FROM settings WHERE id LIKE 'partner-cash:%' ORDER BY id").all<{id:string;data:string}>();
 const config=account?JSON.parse(account.data):{startPeriod:state.ledger.activePeriod,taxRate:null};
 const stored=await d.prepare("SELECT data FROM settings WHERE id='partner-settlements'").first<{data:string}>();
 const settlements:PartnerSettlements=stored?JSON.parse(stored.data):emptySettlements;
 const emil=state.employees.find(isEmil);if(!emil)throw Error('Не найдена касса Эмиля');
 await initCash();
 const cash=await d.prepare('SELECT id,amount,accepted_at,recipient,sender FROM cash_operations WHERE sender=? OR recipient=?').bind(emil.id,emil.id).all<{id:string;amount:number;accepted_at:string|null;recipient:string|null;sender:string|null}>();
 const accepted=new Set(cash.results.filter(r=>r.accepted_at).map(r=>r.id));
 const obligations:ReturnType<typeof partnerObligations>=[];let transferred=0,taxReserve:number|null=0,opening=settlements.opening,bankRevision:string|undefined;
 for(const id of Object.keys(state.ledger.periods).filter(id=>id>=config.startPeriod&&id<=period).sort()){
  const s=id===period||state.ledger.periods[id].status==='paid'?state:await readPremiumState(id);
  const saved=costRows.results.find(r=>r.id==='partner-cash:'+id);
  let settings:PartnerSettings=saved?JSON.parse(saved.data):{...defaultPartnerSettings,taxRate:config.taxRate,bank:config.bank??0};
  const frozen=await d.prepare('SELECT data FROM settings WHERE id=?').bind('partner-cash-closed:'+id).first<{data:string}>();
  const bank=await readPartnerBank(d,s.ledger!,id,s.orders,s.employees);
  if(bankRevision!==undefined&&bankRevision!==bank.revision)throw Error('Реестры изменились. Обновите кассу');bankRevision=bank.revision;
  const report:ReturnType<typeof partnerCalculation>=frozen?JSON.parse(frozen.data):partnerCalculation(periodOrders(s.ledger!,id,s.orders,s.employees),s.orders,ledgerRows(s.ledger!,id,s.orders,s.employees,s.adjustments),settings,bank);
  if(frozen)settings=JSON.parse(frozen.data).settings;
  const rows=partnerObligations(id,report,settings,settlements,accepted,s.ledger!.periods[id].status==='paid');obligations.push(...rows);
  transferred+=report.transferred;
  const reserve=rows.find(r=>r.kind==='tax')!.remaining;taxReserve=taxReserve===null||reserve===null?null:taxReserve+reserve;
  const ids=new Set(settlements.entries.filter(e=>e.period===id&&e.action==='pay').map(e=>e.id));
  const spent=cash.results.filter(r=>ids.has(r.id)||r.id==='premium:'+id+':'+emil.id||r.id.startsWith('partner-expense:'+id+':')).reduce((sum,r)=>sum+(r.sender===emil.id?r.amount:-r.amount),0);
  if(id<period)opening+=report.transferred-spent;
 }
 const selectedIds=new Set(settlements.entries.filter(e=>e.period>=config.startPeriod&&e.period<=period&&e.action==='pay').map(e=>e.id));
 const spent=cash.results.filter(r=>selectedIds.has(r.id)||Object.keys(state.ledger!.periods).some(id=>id>=config.startPeriod&&id<=period&&(r.id==='premium:'+id+':'+emil.id||r.id.startsWith('partner-expense:'+id+':')))).reduce((sum,r)=>sum+(r.sender===emil.id?r.amount:-r.amount),0);
 const balance=settlements.opening+transferred-spent;
 return {bankRevision:bankRevision??'[]',costVersions:JSON.stringify(costRows.results.map(r=>[r.id,r.data])),state,account,stored,settlements,emil,opening,obligations,balance,taxReserve,available:taxReserve===null?null:balance-taxReserve,administrators:state.employees.filter(e=>e.role==='admin'&&!e.cashDisabled).map(e=>({id:e.id,name:e.name})),config};
}

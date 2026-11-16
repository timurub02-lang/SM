import {readProductCosts,productCostsGuard} from './warehouse-cost';
import {readPartnerBank} from './partner-bank';
import {premiumPeriods} from './premium-periods';
import {partnerCalculation,defaultPartnerSettings,type PartnerSettings} from './partner-cash';
import {readPremiumStateFrom} from './premium-read';
import {db} from './db';
import {initCash} from './cash-db';
import {premiumCashSpends} from './premium-cash';
import type {Employee,Order} from './crm';
import {ledgerKey,type PremiumLedger} from './premium-ledger';
import {defaultPremiumAdjustment,type PremiumSaved} from './premium-calculation';
export async function readPremiumState(period:string){return readPremiumStateFrom(db(),period);}
export async function savePremiumLedger(state:Awaited<ReturnType<typeof readPremiumState>>,next:PremiumLedger,period:string){
 const d=db(),paid=state.ledger?.periods[period]?.status!=='paid'&&next.periods[period]?.status==='paid';
 const spends=paid?premiumCashSpends(period,next.periods[period],state.employees):[];
 if(paid)await initCash();
 const partnerAccount=paid?await d.prepare("SELECT data FROM settings WHERE id='partner-cash-account'").first<{data:string}>():null;
 const partnerDraft=partnerAccount?await d.prepare('SELECT data FROM settings WHERE id=?').bind('partner-cash:'+period).first<{data:string}>():null;
 const partnerSettings:PartnerSettings=partnerDraft?JSON.parse(partnerDraft.data):{...defaultPartnerSettings,taxRate:partnerAccount?JSON.parse(partnerAccount.data).taxRate:null,bank:partnerAccount?JSON.parse(partnerAccount.data).bank??0:0};
 const bank=partnerAccount?await readPartnerBank(d,state.ledger!,period,state.orders,state.employees):undefined;
 const catalog=partnerAccount?await readProductCosts(d):undefined;
 const partnerReport=partnerAccount?partnerCalculation(next.periods[period].orders||[],state.orders,next.periods[period].rows||[],partnerSettings,bank,catalog!.prices):null;
 if(partnerReport&&partnerReport.remaining===null)throw Error('Заполните налог и проверьте товары и минуты СК в кассе Эмиля перед закрытием периода');
 if(partnerReport&&(partnerSettings.minutePrice??0)>0&&Date.parse(partnerSettings.minutes?.through||'')<Date.parse(premiumPeriods.find(p=>p.id===period)!.cutoff+'T23:59:59+03:00'))throw Error('Обновите минуты СК за весь период в кассе Эмиля перед закрытием');
 const partnerGuard=partnerAccount?" AND EXISTS(SELECT 1 FROM settings WHERE id='partner-cash-account' AND data=?) AND COALESCE((SELECT data FROM settings WHERE id=?),'')=? AND (SELECT json_group_array(json_array(id,data)) FROM (SELECT id,data FROM settings WHERE id LIKE 'cdek-bank-registry:%' ORDER BY id))=?":paid?" AND NOT EXISTS(SELECT 1 FROM settings WHERE id='partner-cash-account')":'';
 const partnerGuardValues=partnerAccount?[partnerAccount.data,'partner-cash:'+period,partnerDraft?.data||'',bank!.revision]:[];
 const serialized=JSON.stringify(next);
 const update=d.prepare("UPDATE settings SET data=? WHERE id=? AND data=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM employees ORDER BY id))=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM orders ORDER BY id))=? AND (SELECT json_group_array(json_array(id,data)) FROM (SELECT id,data FROM settings WHERE id LIKE ? ORDER BY id))=?"+(partnerGuard+(partnerAccount?" AND "+productCostsGuard:""))).bind(serialized,ledgerKey,state.raw,state.staffVersions,state.orderVersions,'premium-draft:'+period+':%',state.draftVersions,...partnerGuardValues,...(catalog?[catalog.revision]:[]));
 // A cash failure rolls back the ledger too; a lost CAS cannot create spends.
 const carry=paid?(next.periods[period].rows||[]).filter(row=>row.result!==null&&row.result<0).map(row=>{
  const employee=state.employees.find(e=>e.id===row.employeeId);if(!employee)throw Error('Не найден сотрудник для переноса долга '+row.login);
  const debt=Math.round(-row.result!*100)/100,revision=crypto.randomUUID();
  const data=JSON.stringify({...defaultPremiumAdjustment(employee),debt,revision,carriedFrom:period});
  return d.prepare("INSERT INTO settings(id,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?) ON CONFLICT(id) DO UPDATE SET data=json_set(settings.data,'$.debt',round(COALESCE(json_extract(settings.data,'$.debt'),0)+?,2),'$.revision',?,'$.carriedFrom',?)").bind('premium-draft:'+next.activePeriod+':'+employee.id,data,ledgerKey,serialized,debt,revision,period);
 }):[];
 const partnerSnapshot=partnerReport?[d.prepare("INSERT OR IGNORE INTO settings(id,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)").bind('partner-cash-closed:'+period,JSON.stringify({...partnerReport,settings:partnerSettings}),ledgerKey,serialized)]:[];
 const [r]=await d.batch([update,...partnerSnapshot,...carry,...spends.map(s=>d.prepare("INSERT INTO cash_operations(id,kind,sender,recipient,amount,purpose,date,created_at,accepted_at,actor,sender_name,recipient_name) SELECT ?,'spend',?,NULL,?,?,?,?,NULL,?,?,'' WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)").bind(s.id,s.sender,s.amount,s.purpose,s.date,s.at,s.actor,s.senderName,ledgerKey,serialized))]);
 if(!r.meta.changes)throw Error('Данные изменились. Обновите расчёт и повторите действие.');
}

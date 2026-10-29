import {db} from './db';
import {initCash} from './cash-db';
import {premiumCashSpends} from './premium-cash';
import type {Employee,Order} from './crm';
import {ledgerKey,type PremiumLedger} from './premium-ledger';
import {defaultPremiumAdjustment,type PremiumSaved} from './premium-calculation';
export async function readPremiumState(period:string){
 const d=db();
 const [staff,orders,drafts,stored]=await Promise.all([
  d.prepare('SELECT id,data,version FROM employees ORDER BY id').all<{id:string;data:string;version:number}>(),
  d.prepare('SELECT id,data,version FROM orders ORDER BY id').all<{id:string;data:string;version:number}>(),
  d.prepare('SELECT id,data FROM settings WHERE id LIKE ? ORDER BY id').bind('premium-draft:'+period+':%').all<{id:string;data:string}>(),
  d.prepare('SELECT data FROM settings WHERE id=?').bind(ledgerKey).first<{data:string}>()
 ]);
 return {employees:staff.results.map(r=>({...JSON.parse(r.data),version:r.version}) as Employee),orders:orders.results.map(r=>({...JSON.parse(r.data),version:r.version}) as Order),adjustments:Object.fromEntries(drafts.results.map(r=>[r.id.slice(('premium-draft:'+period+':').length),JSON.parse(r.data)])) as Record<string,PremiumSaved>,ledger:stored?JSON.parse(stored.data) as PremiumLedger:null,raw:stored?.data||'',staffVersions:JSON.stringify(staff.results.map(r=>[r.id,r.version])),orderVersions:JSON.stringify(orders.results.map(r=>[r.id,r.version])),draftVersions:JSON.stringify(drafts.results.map(r=>[r.id,r.data]))};
}
export async function savePremiumLedger(state:Awaited<ReturnType<typeof readPremiumState>>,next:PremiumLedger,period:string){
 const d=db(),paid=state.ledger?.periods[period]?.status!=='paid'&&next.periods[period]?.status==='paid';
 const spends=paid?premiumCashSpends(period,next.periods[period]):[];
 if(paid)await initCash();
 const serialized=JSON.stringify(next);
 const update=d.prepare("UPDATE settings SET data=? WHERE id=? AND data=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM employees ORDER BY id))=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM orders ORDER BY id))=? AND (SELECT json_group_array(json_array(id,data)) FROM (SELECT id,data FROM settings WHERE id LIKE ? ORDER BY id))=?").bind(serialized,ledgerKey,state.raw,state.staffVersions,state.orderVersions,'premium-draft:'+period+':%',state.draftVersions);
 // A cash failure rolls back the ledger too; a lost CAS cannot create spends.
 const carry=paid?(next.periods[period].rows||[]).filter(row=>row.result!==null&&row.result<0).map(row=>{
  const employee=state.employees.find(e=>e.id===row.employeeId);if(!employee)throw Error('Не найден сотрудник для переноса долга '+row.login);
  const debt=Math.round(-row.result!*100)/100,revision=crypto.randomUUID();
  const data=JSON.stringify({...defaultPremiumAdjustment(employee),debt,revision,carriedFrom:period});
  return d.prepare("INSERT INTO settings(id,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?) ON CONFLICT(id) DO UPDATE SET data=json_set(settings.data,'$.debt',round(COALESCE(json_extract(settings.data,'$.debt'),0)+?,2),'$.revision',?,'$.carriedFrom',?)").bind('premium-draft:'+next.activePeriod+':'+employee.id,data,ledgerKey,serialized,debt,revision,period);
 }):[];
 const [r]=await d.batch([update,...carry,...spends.map(s=>d.prepare("INSERT INTO cash_operations(id,kind,sender,recipient,amount,purpose,date,created_at,accepted_at,actor,sender_name,recipient_name) SELECT ?,'spend',?,NULL,?,?,?,?,NULL,?,?,'' WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)").bind(s.id,s.sender,s.amount,s.purpose,s.date,s.at,s.actor,s.senderName,ledgerKey,serialized))]);
 if(!r.meta.changes)throw Error('Данные изменились. Обновите расчёт и повторите действие.');
}

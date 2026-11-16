import {readPartnerBank} from '@/lib/partner-bank';
import {minutesFinal} from '@/lib/partner-minutes';
import {partnerExpense} from '@/lib/partner-expense';
import {readPartnerMinutes} from '@/lib/partner-minutes-sync';
import {partnerAccountView} from '@/lib/partner-account';
import {partnerPayment} from '@/lib/partner-payment';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {readPremiumState} from '@/lib/premium-store';
import {periodOrders,ledgerRows} from '@/lib/premium-ledger';
import {premiumPeriods} from '@/lib/premium-periods';
import {defaultPartnerSettings,isEmil,partnerCalculation,type PartnerSettings} from '@/lib/partner-cash';
import type {Employee} from '@/lib/crm';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function handle(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const d=db(),q=new URL(req.url).searchParams;
  const record=await d.prepare('SELECT data FROM employees WHERE id=?').bind(q.get('actorId')||'').first<{data:string}>();
  const actor=record?JSON.parse(record.data) as Employee:null;
  if(!actor||actor.role!=='admin'&&!isEmil(actor))return Response.json({error:'Касса партнёра недоступна'},{status:403});
  const initial=await d.prepare("SELECT data FROM settings WHERE id='premium-ledger'").first<{data:string}>();const ledger=initial?JSON.parse(initial.data) as import('@/lib/premium-ledger').PremiumLedger:null;
  if(!ledger)throw Error('Расчётные периоды не настроены');
  const period=q.get('period')||ledger.activePeriod;
  const calendar=premiumPeriods.find(p=>p.id===period);
  if(!calendar||!ledger.periods[period])throw Error('Период не найден');
  const account=await d.prepare("SELECT data FROM settings WHERE id='partner-cash-account'").first<{data:string}>();
  const accountData=account?JSON.parse(account.data) as {startPeriod:string;taxRate:number|null;bank?:number}:null;
  const key='partner-cash:'+period;
  const old=await d.prepare('SELECT data FROM settings WHERE id=?').bind(key).first<{data:string}>();
  let settings:PartnerSettings=old?JSON.parse(old.data):{...defaultPartnerSettings,taxRate:accountData?.taxRate??null,bank:accountData?.bank??0};
  const bodyInput=req.method==='POST'?await req.json():null;
  if(bodyInput&&typeof bodyInput==='object'&&'action' in bodyInput&&bodyInput.action==='refresh_minutes'){
   if(ledger.periods[period].status==='paid')return handle(new Request(req.url,{headers:req.headers}));
   if(minutesFinal(calendar,settings.minutes))return handle(new Request(req.url,{headers:req.headers}));
   const settlements=await d.prepare("SELECT data FROM settings WHERE id='partner-settlements'").first<{data:string}>();
   if(settlements&&JSON.parse(settlements.data).entries.some((e:{period:string;action:string})=>e.period===period&&e.action==='pay'))throw Error('По периоду начаты выплаты; минуты защищены от изменений');
   const minutes=await readPartnerMinutes(calendar,d);
   const updated=JSON.stringify({...settings,minutes,revision:crypto.randomUUID()});
   const guard="EXISTS(SELECT 1 FROM settings WHERE id='premium-ledger' AND data=?) AND COALESCE((SELECT data FROM settings WHERE id='partner-settlements'),'')=?";
   const result=old?await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=? AND '+guard).bind(updated,key,old.data,initial!.data,settlements?.data||'').run():await d.prepare('INSERT OR IGNORE INTO settings(id,data) SELECT ?,? WHERE '+guard).bind(key,updated,initial!.data,settlements?.data||'').run();
   if(!result.meta.changes)throw Error('Данные изменились во время загрузки минут. Обновите окно.');
   return handle(new Request(req.url,{headers:req.headers}));
  }
  if(bodyInput&&typeof bodyInput==='object'&&'action' in bodyInput&&['expense_add','expense_remove'].includes(String(bodyInput.action))){await partnerExpense(actor,bodyInput);return handle(new Request(req.url,{headers:req.headers}));}
  if(bodyInput&&typeof bodyInput==='object'&&'action' in bodyInput){await partnerPayment(actor,bodyInput);return handle(new Request(req.url,{headers:req.headers}));}
  if(req.method==='POST'){
   if(actor.role!=='admin')return Response.json({error:'Настройки изменяет администратор'},{status:403});
   const settlements=await d.prepare("SELECT data FROM settings WHERE id='partner-settlements'").first<{data:string}>();
   if(settlements&&JSON.parse(settlements.data).entries.some((e:{period:string;action:string})=>e.period===period&&e.action==='pay'))return Response.json({error:'По периоду уже начаты выплаты. Расходы защищены от изменений.'},{status:409});
   if(ledger.periods[period].status==='paid')return Response.json({error:'Период уже выплачен'},{status:409});
   const body=z.object({revision:z.string(),taxRate:z.number().finite().min(0).max(100).nullable(),minutePrice:z.number().finite().min(0).max(100000).multipleOf(0.01).optional(),communication:z.number().finite().min(0).max(100000000),bank:z.number().finite().min(0).max(100000000),productUnitPrice:z.number().finite().min(0).max(100000000).multipleOf(0.01).optional(),productPrices:z.record(z.string().min(1).max(500),z.number().finite().min(0).max(100000000).multipleOf(0.01)).optional()}).parse(bodyInput);
   if(body.revision!==settings.revision)return Response.json({error:'Данные изменились. Обновите окно.'},{status:409});
   settings={...body,minutes:settings.minutes,expenses:settings.expenses,revision:crypto.randomUUID()};const data=JSON.stringify(settings);
   const guard="EXISTS(SELECT 1 FROM settings WHERE id='premium-ledger' AND data=?) AND COALESCE((SELECT data FROM settings WHERE id='partner-cash-account'),'')=? AND COALESCE((SELECT data FROM settings WHERE id='partner-settlements'),'')=?";
   const change=old?d.prepare('UPDATE settings SET data=? WHERE id=? AND data=? AND '+guard).bind(data,key,old.data,initial!.data,account?.data||'',settlements?.data||''):d.prepare('INSERT OR IGNORE INTO settings(id,data) SELECT ?,? WHERE '+guard).bind(key,data,initial!.data,account?.data||'',settlements?.data||'');
   const accountValue=JSON.stringify({startPeriod:accountData?.startPeriod||ledger.activePeriod,taxRate:settings.taxRate,bank:settings.bank});
   const [result]=await d.batch([change,d.prepare("INSERT INTO settings(id,data) SELECT 'partner-cash-account',? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(accountValue,key,data)]);
   if(!result.meta.changes)return Response.json({error:'Данные изменились. Обновите окно.'},{status:409});
  }
  const state=await readPremiumState(period);
  const frozen=await d.prepare('SELECT data FROM settings WHERE id=?').bind('partner-cash-closed:'+period).first<{data:string}>();
  const bank=await readPartnerBank(d,state.ledger!,period,state.orders,state.employees);
  const calculation=frozen?JSON.parse(frozen.data) as ReturnType<typeof partnerCalculation>:partnerCalculation(periodOrders(state.ledger!,period,state.orders,state.employees),state.orders,ledgerRows(state.ledger!,period,state.orders,state.employees,state.adjustments),settings,bank);
  if(frozen)settings=JSON.parse(frozen.data).settings;
  const view=await partnerAccountView(period);const opening=view.opening,startPeriod=view.config.startPeriod;
  return Response.json({payroll:ledgerRows(state.ledger!,period,state.orders,state.employees,state.adjustments).filter(r=>r.department==='5').sort((a,b)=>Number(a.role==='department_head')-Number(b.role==='department_head')||a.login.localeCompare(b.login,'ru')),period,calendar,opening,startPeriod,accountBalance:view.balance,accountRemaining:view.available===null||view.obligations.some(r=>r.remaining===null)?null:view.available-view.obligations.filter(r=>r.kind!=='tax'&&!r.kind.startsWith('share')).reduce((n,r)=>n+(r.remaining||0),0)-(ledger.periods[period].status==='paid'?0:calculation.premium||0),taxReserve:view.taxReserve,available:view.available,settlementRevision:view.settlements.revision,initialBalance:view.settlements.opening,canSetOpening:actor.role==='admin'&&!view.settlements.entries.length,obligations:view.obligations.filter(r=>r.period===period||(r.remaining||0)>0||r.pending>0),administrators:view.administrators,settlements:view.settlements.entries,closed:ledger.periods[period].status==='paid',periods:Object.keys(ledger.periods).sort().reverse().map(id=>({id,label:premiumPeriods.find(p=>p.id===id)?.label||id})),settings,editable:actor.role==='admin'&&ledger.periods[period].status!=='paid'&&!view.settlements.entries.some(e=>e.period===period&&e.action==='pay'),...calculation},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте налог и расходы':e instanceof Error?e.message:'Ошибка кассы'},{status:400});}
}
export const GET=authenticated(handle);export const POST=authenticated(handle);

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
  const accountData=account?JSON.parse(account.data) as {startPeriod:string;taxRate:number|null}:null;
  const key='partner-cash:'+period;
  const old=await d.prepare('SELECT data FROM settings WHERE id=?').bind(key).first<{data:string}>();
  let settings:PartnerSettings=old?JSON.parse(old.data):{...defaultPartnerSettings,taxRate:accountData?.taxRate??null};
  if(req.method==='POST'){
   if(actor.role!=='admin')return Response.json({error:'Настройки изменяет администратор'},{status:403});
   if(ledger.periods[period].status==='paid')return Response.json({error:'Период уже выплачен'},{status:409});
   const body=z.object({revision:z.string(),taxRate:z.number().finite().min(0).max(100).nullable(),communication:z.number().finite().min(0).max(100000000),bank:z.number().finite().min(0).max(100000000)}).parse(await req.json());
   if(body.revision!==settings.revision)return Response.json({error:'Данные изменились. Обновите окно.'},{status:409});
   settings={...body,revision:crypto.randomUUID()};const data=JSON.stringify(settings);
   const guard="EXISTS(SELECT 1 FROM settings WHERE id='premium-ledger' AND data=?) AND COALESCE((SELECT data FROM settings WHERE id='partner-cash-account'),'')=?";
   const change=old?d.prepare('UPDATE settings SET data=? WHERE id=? AND data=? AND '+guard).bind(data,key,old.data,initial!.data,account?.data||''):d.prepare('INSERT OR IGNORE INTO settings(id,data) SELECT ?,? WHERE '+guard).bind(key,data,initial!.data,account?.data||'');
   const accountValue=JSON.stringify({startPeriod:accountData?.startPeriod||ledger.activePeriod,taxRate:settings.taxRate});
   const [result]=await d.batch([change,d.prepare("INSERT INTO settings(id,data) SELECT 'partner-cash-account',? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(accountValue,key,data)]);
   if(!result.meta.changes)return Response.json({error:'Данные изменились. Обновите окно.'},{status:409});
  }
  const state=await readPremiumState(period);
  const frozen=await d.prepare('SELECT data FROM settings WHERE id=?').bind('partner-cash-closed:'+period).first<{data:string}>();
  const calculation=frozen?JSON.parse(frozen.data) as ReturnType<typeof partnerCalculation>:partnerCalculation(periodOrders(state.ledger!,period,state.orders,state.employees),state.orders,ledgerRows(state.ledger!,period,state.orders,state.employees,state.adjustments),settings);
  if(frozen)settings=JSON.parse(frozen.data).settings;
  const startPeriod=accountData?.startPeriod||ledger.activePeriod;
  let opening:number|null=0;
  for(const id of Object.keys(ledger.periods).filter(id=>id>=startPeriod&&id<period)){
   const closed=await d.prepare('SELECT data FROM settings WHERE id=?').bind('partner-cash-closed:'+id).first<{data:string}>();
   const previous=closed?JSON.parse(closed.data) as ReturnType<typeof partnerCalculation>:null;
   if(previous?.remaining==null){opening=null;break;}opening+=previous.remaining;
  }
  return Response.json({period,calendar,opening,startPeriod,accountBalance:opening===null||calculation.balance===null?null:opening+calculation.balance,accountRemaining:opening===null||calculation.remaining===null?null:opening+calculation.remaining,periods:Object.keys(ledger.periods).sort().reverse().map(id=>({id,label:premiumPeriods.find(p=>p.id===id)?.label||id})),settings,editable:actor.role==='admin'&&ledger.periods[period].status!=='paid',...calculation},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте налог и расходы':e instanceof Error?e.message:'Ошибка кассы'},{status:400});}
}
export const GET=authenticated(handle);export const POST=authenticated(handle);

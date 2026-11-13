import {readPaidHistory} from './premium-paid-history.ts';
import type {ActivityDb} from './activity-store.ts';
import type {Employee,Order,State} from './crm.ts';
import {ledgerKey,ledgerRows,periodOrders,payrollVisible,premiumStagesByKey,nextPremiumPreview,orderKey,rowFromCalculation,type PremiumLedger,type PayrollRow,type PayrollOrder} from './premium-ledger.ts';
import {premiumCalculation,premiumStaff,type PremiumSaved} from './premium-calculation.ts';
import {premiumPeriods} from './premium-periods.ts';
import {premiumStatistics} from './premium-statistics.ts';

type Lifecycle={status:'open'|'frozen'|'paid';revision:string;activePeriod:string;source?:{name:string;sha256:string;importedAt:string};signers:{id:string;name:string;department:string}[];signedIds:string[];administrativeIds:string[];allSigned:boolean;frozenAt?:string;paidAt?:string};
export type FinancialPeriod={adjustments:Record<string,PremiumSaved>;payroll:PayrollRow[]|null;calculatedPayroll?:PayrollRow[];calculatedHeadRows?:Record<string,PayrollRow>;lifecycle:Lifecycle|null;missingOrders:PayrollOrder[]};
export type FinancialStages={activePeriod?:string;stages:Record<string,Order['premiumStage']>;nextPeriod?:string;nextOrderIds:string[]};
export type FinancialOverview={activePeriod?:string;periods:string[];staff:Employee[];periodCounts:Record<string,{employeeId?:string;department:string;count:number}[]>};
export type FinancialProjection=FinancialOverview&{byPeriod:Record<string,FinancialPeriod>;stageProjection:FinancialStages;overview:FinancialOverview};
const admin={id:'premium-system',role:'admin'} as Employee;
export async function initFinancialProjection(d:ActivityDb){await d.prepare('CREATE TABLE IF NOT EXISTS crm_financial_stages(id TEXT PRIMARY KEY,data TEXT NOT NULL)').run();}
export async function financialStageStatements(d:ActivityDb,projection:FinancialProjection){
 await initFinancialProjection(d);
 const desired=new Map<string,string>(Object.entries(projection.stageProjection.stages).map(([id,value])=>['stage:'+id,JSON.stringify(value)]));
 for(const id of projection.stageProjection.nextOrderIds)desired.set('next:'+id,JSON.stringify(projection.stageProjection.nextPeriod));
 const existing=new Map<string,string>((await d.prepare('SELECT id,data FROM crm_financial_stages').all()).results.map((r:{id:string;data:string})=>[r.id,r.data]));
 return [...[...desired].filter(([id,data])=>existing.get(id)!==data).map(([id,data])=>d.prepare('INSERT INTO crm_financial_stages(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(id,data)),...[...existing.keys()].filter(id=>!desired.has(id)).map(id=>d.prepare('DELETE FROM crm_financial_stages WHERE id=?').bind(id))];
}

// The worker supplies a consistent read transaction. This builder never signs, pays or writes source data.
export async function buildFinancialProjection(d:ActivityDb,_now=Date.now()):Promise<FinancialProjection>{
 const fields=['id','manager','status','testOnly','priorPremiumPaid','legacyLv','importedPayment','delivery','paymentReceivedAt','paymentReceipt','paymentReceivedAmount','cdekRemittances','cdekHistoryRecovery','premiumStage'];
 const [staff,paid,drafts,stored]=await Promise.all([
  d.prepare('SELECT data,version FROM employees ORDER BY id').all(),
  d.prepare(`SELECT json_object(${fields.map(key=>`'${key}',json_extract(data,'$.${key}')`).join(',')}) AS data FROM orders WHERE json_extract(data,'$.status')='redeemed' ORDER BY id`).all(),
  d.prepare("SELECT id,data FROM settings WHERE id LIKE 'premium-draft:%' ORDER BY id").all(),
  d.prepare('SELECT data FROM settings WHERE id=?').bind(ledgerKey).first(),
 ]);
 const employees:Employee[]=staff.results.map((r:{data:string;version:number})=>({...JSON.parse(r.data),version:r.version}));
 const orders:Order[]=paid.results.map((r:{data:string})=>JSON.parse(r.data));
 const ledger:PremiumLedger|null=stored?JSON.parse(stored.data):null;
 const adjustments:Record<string,Record<string,PremiumSaved>>={};
 for(const r of drafts.results){const [,period,...employee]=r.id.split(':');(adjustments[period]??={})[employee.join(':')]=JSON.parse(r.data);}
 const byPeriod:Record<string,FinancialPeriod>={},periodCounts:FinancialProjection['periodCounts']={};
 for(const id of [...new Set([...premiumPeriods.map(p=>p.id),...Object.keys(ledger?.periods||{})])]){
  const p=ledger?.periods[id],input=adjustments[id]||{};
  const payroll=p?ledgerRows(ledger!,id,orders,employees,input):null;
  const required=p?.status==='open'?[...new Set(payroll!.map(r=>r.department))].flatMap(department=>employees.filter(e=>e.role==='department_head'&&e.department===department&&e.leaderPremium).map(e=>({id:e.id,name:e.name,department}))):p?.signers||[];
  const lifecycle:Lifecycle|null=p?{status:p.status,revision:ledger!.revision,activePeriod:ledger!.activePeriod,source:p.source,signers:required,signedIds:Object.keys(p.signatures),administrativeIds:Object.entries(p.signatures).filter(([id,signature])=>signature.by!==id).map(([id])=>id),allSigned:!!p.signers?.length&&p.signers.every(e=>!!p.signatures[e.id]),frozenAt:p.frozenAt,paidAt:p.paidAt}:null;
  // Before a ledger exists, the legacy head preview uses only orders visible to that head.
  const calculatedHeadRows=!p?Object.fromEntries(employees.filter(e=>e.role==='department_head'&&e.leaderPremium).flatMap(e=>premiumCalculation(orders,e,employees,id,input).rows.filter(r=>r.employee.id===e.id).map(r=>[e.id,rowFromCalculation(r)]))):undefined;
  byPeriod[id]={adjustments:input,payroll,...(!p?{calculatedPayroll:premiumCalculation(orders,admin,employees,id,input).rows.map(rowFromCalculation),calculatedHeadRows}:{}),lifecycle,missingOrders:(p?.orders||[]).filter(r=>!r.id)};
  if(p){
   const counts=new Map<string,{employeeId?:string;department:string;count:number}>();
   for(const row of periodOrders(ledger!,id,orders,employees).filter(r=>!r.historyOnly)){const key=JSON.stringify([row.employeeId,row.department]),value=counts.get(key)||{employeeId:row.employeeId,department:row.department,count:0};value.count++;counts.set(key,value);}
   periodCounts[id]=[...counts.values()];
  }
 }
 const next=nextPremiumPreview(ledger,orders,employees);
 const overview={activePeriod:ledger?.activePeriod,periods:Object.keys(ledger?.periods||{}),staff:employees,periodCounts};
 return {...overview,overview,byPeriod,stageProjection:{activePeriod:ledger?.activePeriod,stages:Object.fromEntries(premiumStagesByKey(ledger,orders,employees,await readPaidHistory(d))),nextPeriod:next?.period,nextOrderIds:[...(next?.orderIds||[])].filter((id):id is string=>!!id)}};
}

export function financialPeriodResponse(projection:FinancialOverview&{byPeriod:Record<string,FinancialPeriod>},actor:Employee,period:string){
 if(!['admin','department_head','operator'].includes(actor.role))throw Error('Расчёт недоступен');
 const p=projection.byPeriod[period];if(!p)throw Error('Выберите расчётный период');
 const allowed=new Set(projection.staff.filter(e=>premiumStaff(actor,e)).map(e=>e.id));
 const calculated=p.calculatedPayroll?.filter(r=>payrollVisible(actor,r)).map(r=>actor.role==='department_head'&&r.employeeId===actor.id?p.calculatedHeadRows?.[actor.id]||r:r);
 return {adjustments:Object.fromEntries(Object.entries(p.adjustments).filter(([id])=>allowed.has(id))),payroll:p.payroll?.filter(r=>payrollVisible(actor,r))??null,...(calculated?{calculatedPayroll:calculated}:{}),lifecycle:p.lifecycle?{...p.lifecycle,signers:p.lifecycle.signers.filter(e=>actor.role==='admin'||e.department===actor.department)}:null,periodCounts:Object.fromEntries(Object.entries(projection.periodCounts).map(([id,rows])=>[id,rows.filter(r=>payrollVisible(actor,r)).reduce((sum,r)=>sum+r.count,0)])),activePeriod:projection.activePeriod,periods:projection.periods,missingOrders:p.missingOrders.filter(r=>payrollVisible(actor,r))};
}
export function financialStatisticsResponse(projection:FinancialOverview&{byPeriod:Record<string,FinancialPeriod>},actor:Employee,month=''){
 if(!['admin','department_head'].includes(actor.role))throw Error('Недостаточно прав');
 if(month&&!/^\d{4}-\d{2}$/.test(month))throw Error('Выберите месяц');
 if(!projection.activePeriod)return {months:[],rows:[],periods:[]};
 const selected=month||projection.activePeriod.slice(0,7),periods=[1,2].flatMap(half=>{const id=selected+'-'+half,p=projection.byPeriod[id];return p?.lifecycle&&p.payroll?[{id,status:p.lifecycle.status,rows:p.payroll}]:[];});
 return {month:selected,months:[...new Set(projection.periods.slice().sort().map(id=>id.slice(0,7)))].reverse(),periods:periods.map(({id,status})=>({id,status})),rows:premiumStatistics(actor,periods)};
}

async function preparedFinancialParts(d:ActivityDb,periods:string[]){
 const {readPreparedModel,readModelSource}=await import('./crm-read-model.ts');
 const source=await readModelSource(d);
 const parts=await Promise.all(['$.overview',...periods.map(id=>'$.byPeriod.'+JSON.stringify(id))].map(path=>readPreparedModel<FinancialOverview|FinancialPeriod>(d,'finance','global',source.financeRevision,Date.now(),path)));
 const {data,...initial}=parts[0];
 const unavailable=parts.find(p=>!p.data);
 if(unavailable){const {data,...readModel}=unavailable;return {readModel};}
 if(parts.some(p=>p.computedAt!==initial.computedAt||p.sourceRevision!==initial.sourceRevision))return {readModel:{...initial,status:'pending' as const,message:'Финансовая сводка обновляется'}};
 const {data:ignored,...readModel}=parts.find(p=>p.status!=='ready')||parts[0];
 return {readModel,projection:{...data as FinancialOverview,byPeriod:Object.fromEntries(periods.map((id,index)=>[id,parts[index+1].data as FinancialPeriod]))}};
}
export async function readPreparedFinancialPeriod(d:ActivityDb,actor:Employee,period:string){
 const result=await preparedFinancialParts(d,[period]);
 if(result.projection&&!sameFinancialActor(result.projection,actor))return {readModel:{...result.readModel,status:'pending' as const,message:'Права сотрудника изменились. Обновляем расчёт.'}};
 return {...result,...(result.projection?{response:financialPeriodResponse(result.projection,actor,period)}:{})};
}
function sameFinancialActor(projection:FinancialOverview,actor:Employee){const current=projection.staff.find(e=>e.id===actor.id);return !!current&&current.role===actor.role&&(current.department||'')===(actor.department||'');}
export async function readPreparedFinancialStatistics(d:ActivityDb,actor:Employee,month=''){
 const overview=await preparedFinancialParts(d,[]);if(!overview.projection)return overview;
 if(!sameFinancialActor(overview.projection,actor))return {readModel:{...overview.readModel,status:'pending' as const,message:'Права сотрудника изменились. Обновляем расчёт.'}};
 const selected=month||overview.projection.activePeriod?.slice(0,7)||'';
 if(!selected)return {...overview,response:financialStatisticsResponse(overview.projection,actor,month)};
 const ids=[1,2].map(half=>selected+'-'+half).filter(id=>overview.projection!.periods.includes(id));
 const result=await preparedFinancialParts(d,ids);
 if(result.readModel.computedAt!==overview.readModel.computedAt||result.readModel.sourceRevision!==overview.readModel.sourceRevision)return {readModel:{...result.readModel,status:'pending' as const,message:'Финансовая сводка обновляется'}};
 if(result.projection&&!sameFinancialActor(result.projection,actor))return {readModel:{...result.readModel,status:'pending' as const,message:'Права сотрудника изменились. Обновляем расчёт.'}};
 return {...result,...(result.projection?{response:financialStatisticsResponse(result.projection,actor,month||selected)}:{})};
}

export function applyFinancialStages(state:State,projection:FinancialStages){
 const next=new Set(projection.nextOrderIds);
 state.premiumActivePeriod=projection.activePeriod;state.premiumNextPeriod=projection.nextPeriod;
 state.orders=state.orders.map(o=>({...o,premiumStage:Object.hasOwn(projection.stages,orderKey(o))?projection.stages[orderKey(o)]:undefined,premiumNextPeriod:next.has(o.id)?projection.nextPeriod:undefined}));
}
export function applyFinancialProjection(projection:FinancialProjection,state:State){applyFinancialStages(state,projection.stageProjection);}
export async function attachPreparedPremiumStages(d:ActivityDb,state:State){
 const {readPreparedModel,readModelSource}=await import('./crm-read-model.ts');
 const source=await readModelSource(d),prepared=await readPreparedModel<Pick<FinancialStages,'activePeriod'|'nextPeriod'>>(d,'finance-meta','global',source.financeRevision);
 const {data,...meta}=prepared;if(!data)return meta;
 try{
  const keys=state.orders.flatMap(o=>['stage:'+orderKey(o),'next:'+o.id]);
  const rows=(await d.prepare('SELECT id,data FROM crm_financial_stages WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all()).results;
  const confirmed=await readPreparedModel(d,'finance-meta','global',source.financeRevision);
  if(!confirmed.data||confirmed.computedAt!==meta.computedAt||confirmed.sourceRevision!==meta.sourceRevision)return {...meta,status:'pending' as const,message:'Этапы выплат обновляются'};
  const stages=new Map<string,any>(rows.map((r:{id:string;data:string})=>[r.id,JSON.parse(r.data)]));
  state.premiumActivePeriod=data.activePeriod;state.premiumNextPeriod=data.nextPeriod;
  state.orders=state.orders.map(o=>({...o,premiumStage:stages.get('stage:'+orderKey(o)),premiumNextPeriod:stages.get('next:'+o.id)}));
  return meta;
 }catch{return {...meta,status:'error' as const,message:'Подготовленные этапы выплат недоступны'};}
}

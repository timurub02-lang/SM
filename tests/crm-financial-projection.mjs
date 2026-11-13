import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {buildFinancialProjection,financialPeriodResponse,financialStatisticsResponse,applyFinancialProjection,financialStageStatements} from '../lib/crm-financial-projection.ts';
import {ledgerRows,periodOrders,payrollVisible,applyPremiumStages,nextPremiumPreview,freezePeriod,signPeriod,payPeriod,reopenPeriod,rowFromCalculation} from '../lib/premium-ledger.ts';
import {premiumCalculation,premiumStaff,defaultPremiumAdjustment} from '../lib/premium-calculation.ts';
import {premiumStatistics} from '../lib/premium-statistics.ts';
import {premiumPeriods} from '../lib/premium-periods.ts';
const d=openDatabase(':memory:'),clean=x=>JSON.parse(JSON.stringify(x));
const staff=[
 {id:'admin',role:'admin',department:'',bonus:0},
 {id:'a',role:'operator',department:'1',bonus:7.35},
 {id:'b:operator',role:'operator',department:'2',bonus:11.5,sz:true},
 {id:'h1',role:'department_head',department:'1',bonus:0,leaderPremium:{model:'salary_bonus',fixedPerPeriod:1500,links:[{operatorId:'a',rate:2.25},{operatorId:'b:operator',rate:1.7}]}},
 {id:'h2',role:'department_head',department:'2',bonus:0,leaderPremium:{model:'udl_guarantee',monthlyGuarantee:10000,firstPeriod:4000,links:[{operatorId:'b:operator',rate:3}]}},
].map(e=>({...e,name:e.id,login:e.id,salary:0,version:1}));
const receipt=(id,manager,date,amount=1234.56)=>({id,clientId:'c',manager,status:'redeemed',delivery:'russian_post',paymentReceivedAt:date+'T12:00:00Z',paymentReceipt:{amount},items:[],createdAt:date+'T12:00:00Z',updatedAt:date+'T12:00:00Z',version:1});
const cdek={...receipt('cdek','a','2026-10-25'),delivery:'cdek_pickup',paymentReceivedAt:undefined,paymentReceipt:undefined,cdekRemittances:[{slot:1,registry:'r',tracking:'x',paymentDate:'2026-10-25',amountCents:100000,collectedCents:134599}]};
const orders=[receipt('post','a','2026-10-25'),{...receipt('courier','b:operator','2026-10-25',729.99),delivery:'moscow_courier'},cdek,{...cdek,id:'equal-duplicate',cdekRemittances:[...cdek.cdekRemittances,{...cdek.cdekRemittances[0],registry:'second',paymentDate:'2026-11-10'}]},{...cdek,id:'conflict',cdekRemittances:[...cdek.cdekRemittances,{...cdek.cdekRemittances[0],collectedCents:300000}]},receipt('next','a','2026-10-28'),{...receipt('stored-stage','a','2026-10-25'),premiumStage:{status:'accrued',periodId:'2026-11-1'}},receipt('later','b:operator','2026-11-12'),{...receipt('legacy','a','2026-10-25'),priorPremiumPaid:{period:'old'}},{...receipt('test','a','2026-10-25'),testOnly:true},{...receipt('not-received','a','2026-10-25'),paymentReceivedAt:undefined},{...receipt('imported','a','2026-10-25'),legacyLv:{orderId:'external-1'},importedPayment:{periodId:'2026-10-2',amount:333.33,source:'Synthetic',recordedAt:'now'}},{...receipt('cross-duplicate','b:operator','2026-10-25'),status:'draft',legacyLv:{orderId:'external-1'}},{...receipt('timezone','a','2026-10-25'),paymentReceivedAt:'2026-10-25T22:30:00Z'}];
const period='2026-10-2',adjustments={a:{...defaultPremiumAdjustment(staff[1]),salary:1200.01,vacation:300.13,official:100.11,debt:8000.25,penalty:60.05,extra:17.17,revision:'a1'},'b:operator':{...defaultPremiumAdjustment(staff[2]),extra:42.42,revision:'b1'},h2:{...defaultPremiumAdjustment(staff[4]),firstHalfBonus:2500.5,revision:'h2'}};
let comparisons=0;
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare("INSERT INTO clients(id,phone,data) VALUES('c','synthetic','{}')").run();
 for(const e of staff)await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 for(const o of orders)await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,'c',JSON.stringify(o)).run();
 for(const [id,value] of Object.entries(adjustments))await d.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('premium-draft:'+period+':'+id,JSON.stringify(value)).run();
 const initial={revision:'open',activePeriod:period,initialPeriod:period,historyReconciled:true,periods:{[period]:{status:'open',signatures:{}}}};
 const frozen=freezePeriod(initial,period,orders.filter(o=>o.id!=='conflict'),staff,adjustments,'admin','2026-10-29T10:00:00Z');
 let signed=signPeriod(frozen,period,staff[3],'now');signed=signPeriod(signed,period,staff[4],'now');
 const paid=payPeriod(signed,period,'admin','2026-10-30T10:00:00Z'),reopened=reopenPeriod(signed,period,'admin','2026-10-29T11:00:00Z');
 const imported={...initial,revision:'imported',periods:{[period]:{...frozen.periods[period],status:'open',source:{name:'Synthetic worksheet',sha256:'fixture',importedAt:'now'},orders:[...frozen.periods[period].orders,{externalId:'missing',employeeId:'a',login:'a',department:'1',amount:900},{externalId:'historical',employeeId:'a',login:'a',department:'1',amount:10,historyOnly:true}]}}};
 for(const ledger of [null,initial,frozen,signed,paid,reopened,imported]){
  if(ledger)await d.prepare("INSERT INTO settings VALUES('premium-ledger',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(ledger)).run();else await d.prepare("DELETE FROM settings WHERE id='premium-ledger'").run();
  const original=JSON.stringify(ledger),projection=await buildFinancialProjection(d,Date.parse('2026-11-12T10:00:00Z'));
  assert.equal(JSON.stringify(ledger),original,'worker calculation cannot mutate the source ledger');
  for(const actor of staff)for(const selected of premiumPeriods.map(p=>p.id)){
   const result=financialPeriodResponse(projection,actor,selected),input=selected===period?adjustments:{},entry=ledger?.periods[selected];
   const expected=entry?ledgerRows(ledger,selected,orders,staff,input).filter(r=>payrollVisible(actor,r)):null;
   assert.deepEqual(clean(result.payroll),clean(expected),`${ledger?.revision} ${actor.id} ${selected} payroll`);
   if(!entry)assert.deepEqual(clean(result.calculatedPayroll),clean(premiumCalculation(orders,actor,staff,selected,input).rows.map(rowFromCalculation)),`${actor.id} provisional`);
   assert.deepEqual(clean(result.adjustments),clean(Object.fromEntries(Object.entries(input).filter(([id])=>staff.some(e=>e.id===id&&premiumStaff(actor,e))))));
   assert.deepEqual(result.periodCounts,Object.fromEntries(Object.keys(ledger?.periods||{}).map(id=>[id,periodOrders(ledger,id,orders,staff).filter(r=>!r.historyOnly&&payrollVisible(actor,r)).length])));
   assert.deepEqual(clean(result.missingOrders),clean((entry?.orders||[]).filter(r=>!r.id&&payrollVisible(actor,r))));comparisons++;
  }
  for(const actor of [staff[0],staff[3],staff[4]])for(const month of ['2026-10','2026-11']){
   const periods=[1,2].flatMap(half=>{const id=month+'-'+half,p=ledger?.periods[id];return p?[{id,status:p.status,rows:ledgerRows(ledger,id,orders,staff,id===period?adjustments:{})}]:[];});
   assert.deepEqual(clean(financialStatisticsResponse(projection,actor,month).rows),clean(premiumStatistics(actor,periods)));comparisons++;
  }
  const state={clients:[],employees:staff,orders:orders.map(o=>({...o})),events:[],settings:{retentionDays:30}};
  applyFinancialProjection(projection,state);
  assert.deepEqual(clean(state.orders.map(o=>o.premiumStage)),clean(applyPremiumStages(ledger,orders,staff).map(o=>o.premiumStage)),'external ID membership, history, and duplicate stages retain parity');
  const preview=nextPremiumPreview(ledger,orders,staff);assert.equal(state.premiumNextPeriod,preview?.period);
  assert.deepEqual(state.orders.filter(o=>o.premiumNextPeriod).map(o=>o.id).sort(),[...(preview?.orderIds||[])].sort());
  const updates=await financialStageStatements(d,projection);if(updates.length)await d.batch(updates);
  assert.equal((await financialStageStatements(d,projection)).length,0,'unchanged financial stage projection generates no writes');
  const saved=(await d.prepare('SELECT COUNT(*) AS n FROM crm_financial_stages').first('n'));assert.equal(saved,Object.keys(projection.stageProjection.stages).length+projection.stageProjection.nextOrderIds.length);
 }
 // Historical confirmations affect existing order stages, never payroll totals or membership.
 const withoutHistory=await buildFinancialProjection(d);
 await d.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('premium-paid-history',JSON.stringify({source:'history.xlsx',orders:[{externalId:'legacy',period:'2026-09-1'},{externalId:'absent-history',period:'2026-09-1'}]})).run();
 const withHistory=await buildFinancialProjection(d);
 assert.deepEqual(withHistory.byPeriod,withoutHistory.byPeriod);
 assert.deepEqual(withHistory.overview,withoutHistory.overview);
 assert.equal(withHistory.stageProjection.stages.legacy.status,'paid');
 assert.equal(withHistory.stageProjection.stages['absent-history'],undefined,'History must not create absent orders');
 await d.prepare("DELETE FROM settings WHERE id='premium-paid-history'").run();
 // Frozen money remains historical when current employment terms and departments change.
 await d.prepare("UPDATE settings SET data=? WHERE id='premium-ledger'").bind(JSON.stringify(paid)).run();
 const before=await buildFinancialProjection(d);
 await d.prepare("UPDATE employees SET data=json_set(data,'$.bonus',99,'$.department','2','$.sz',json('true')),version=version+1 WHERE id='a'").run();
 const after=await buildFinancialProjection(d);assert.deepEqual(after.byPeriod[period].payroll,before.byPeriod[period].payroll);
 assert.equal(after.byPeriod['2026-11-2'].calculatedPayroll.find(r=>r.employeeId==='h2').payout,null,'missing first-period UDL bonus is null, never zero');
 assert.throws(()=>financialPeriodResponse(after,{id:'courier',role:'courier'},period),/недоступен/);
 assert.throws(()=>financialStatisticsResponse(after,staff[1],'2026-10'),/прав/);
 assert.throws(()=>financialStatisticsResponse(after,staff[0],'bad'),/месяц/);
 console.log(`${comparisons} financial parity comparisons: money/rounding/UDL, drafts, rights, open/frozen/signed/paid/reopen/imported, periods, statistics, stages, cross-department external IDs and unchanged stage writes passed`);
}finally{d.close();}

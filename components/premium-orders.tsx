"use client";
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {PremiumStatistics} from '@/components/premium-statistics';
import {PremiumArchive} from '@/components/premium-archive';
import {PremiumPayroll} from '@/components/premium-payroll';
import {useEffect,useState} from 'react';
import {isCdekOrder} from '@/lib/cdek-remittance';
import {premiumOrders} from '@/lib/premium-orders';
import {premiumPeriods,periodForReceipt,currentPremiumPeriod} from '@/lib/premium-periods';
import {money,departments,deliveryLabels,type Order,type Employee,type Client} from '@/lib/crm';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';

const dateLabel=(date:string)=>date.split('-').reverse().join('.');
export function PremiumOrders({orders,employee,employees,clients,onOpen,onReload}:{orders:Order[];employee:Employee;employees:Employee[];clients:Client[];onOpen:(id:string)=>void;onReload:()=>Promise<unknown>}){
 const [actionsTarget,setActionsTarget]=useState<HTMLDivElement|null>(null);
 const [view,setView]=useState<'calculation'|'orders'|'employees'|'archive'|'statistics'>('calculation');
 const [current]=useState(()=>currentPremiumPeriod(new Date(Date.now()+3*3600000).toISOString().slice(0,10)));
 const [periodId,setPeriodId]=useState(current?.id||'unassigned'),[query,setQuery]=useState(''),[operator,setOperator]=useState(''),[group,setGroup]=useState('all');
 const [activePeriod,setActivePeriod]=useState('');
 const [ledgerPeriods,setLedgerPeriods]=useState<string[]>([]),[ledgerCounts,setLedgerCounts]=useState<Record<string,number>>({});
 useEffect(()=>{let active=true;fetch('/api/premium?actorId='+encodeURIComponent(employee.id)+'&period='+encodeURIComponent(current?.id||'')).then(r=>r.ok?r.json():null).then(value=>{const r=value as {periods?:string[];activePeriod?:string;periodCounts?:Record<string,number>}|null;if(active&&r){setLedgerPeriods(r.periods||[]);setLedgerCounts(r.periodCounts||{});if(r.activePeriod){setPeriodId(r.activePeriod);setActivePeriod(r.activePeriod);}}}).catch(()=>{});return ()=>{active=false;};},[employee.id,current?.id,orders]);
 const all=premiumOrders(orders,employee,employees).map(r=>({...r,periodId:r.order.premiumStage?.periodId||r.periodId||periodForReceipt(r.date)?.id||'unassigned'})).filter(r=>!ledgerPeriods.includes(r.periodId)||r.order.premiumStage?.periodId===r.periodId);
 const visiblePeriod=activePeriod;
 const period=premiumPeriods.find(p=>p.id===visiblePeriod);
 const next=current?premiumPeriods[premiumPeriods.findIndex(p=>p.id===current.id)+1]:undefined;
 const counts=new Map<string,number>();for(const r of all)counts.set(r.periodId,(counts.get(r.periodId)||0)+1);
 for(const [id,count] of Object.entries(ledgerCounts))counts.set(id,count);
 const choices=premiumPeriods.filter(p=>ledgerPeriods.includes(p.id)||counts.has(p.id)||p.id===current?.id||p.id===next?.id);
 const selected=all.filter(r=>r.periodId===visiblePeriod);
 const names=new Map(clients.map(c=>[c.id,c.name]));
 const staff=new Map(employees.map(e=>[e.id,e]));
 const rows=selected.filter(r=>(employee.role!=='admin'||group==='all'||staff.get(r.order.manager)?.department===group)&&(!operator||r.order.manager===operator)&&[r.order.id,names.get(r.order.clientId),staff.get(r.order.manager)?.name,staff.get(r.order.manager)?.login,r.registry].join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 return <section className="stack table-panel cash-panel premium-panel" aria-label="Премия">
  <div className="premium-heading"><h2>Премия</h2>
  <Tabs value={view} onValueChange={value=>setView(value as typeof view)} className="order-status-tabs"><TabsList className="tabs-line" aria-label="Разделы премии">{([['calculation','Расчёт выплат'],['orders','Заказы'],['employees','Сотрудники'],['archive','Архив'],['statistics','Статистика']] as const).filter(([id])=>employee.role!=='operator'||!['employees','statistics'].includes(id)).map(([id,label])=><TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList></Tabs><div className="premium-actions-slot" ref={setActionsTarget}/></div>
  {view==='statistics'?<PremiumStatistics employee={employee}/>:view==='archive'?<PremiumArchive employee={employee} employees={employees} orders={orders} onOpen={onOpen} onReload={onReload}/>:<>
  <p className="premium-current-period">Текущий расчётный период: <strong>{period?.label||"Загрузка…"}</strong>{period&&` · ${counts.get(period.id)||0} заказов`}</p>
  {period?<div className="premium-dates"><span>Поступления: {dateLabel(period.from)} — {dateLabel(period.cutoff)}</span><strong>Выплата: {dateLabel(period.payout)}</strong>{period.payout!==period.nominal&&<span>перенесена с {dateLabel(period.nominal)}</span>}</div>:<p role="alert">Для этих дат нужно добавить производственный календарь.</p>}
  <details className="premium-help"><summary>Правила расчёта и выплаты</summary><p>СДЭК — по дате перечисления в реестре; почта и курьер — по дате приёма денег. До плановой даты выплаты оставлены четыре полных рабочих дня с учётом праздников и переносов.</p><p>Полученные деньги — не сумма премии. Руководители подписывают расчёт своих отделов. После всех подписей администратор закрывает период и подтверждает выплату.</p></details>
  {view==='orders'&&<>
  <MissingPayrollOrders employeeId={employee.id} period={visiblePeriod}/>
  <div className="toolbar">{employee.role==='admin'&&<select aria-label="Отдел заказов премии" value={group} onChange={e=>{setGroup(e.target.value);setOperator('');}}><option value="all">Все отделы</option>{Object.entries(departments).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>}{employee.role!=='operator'&&<select aria-label="Оператор премии" value={operator} onChange={e=>setOperator(e.target.value)}><option value="">Все операторы</option>{[...new Set(selected.map(r=>r.order.manager))].map(id=><option key={id} value={id}>{staff.get(id)?.name||id}</option>)}</select>}<input aria-label="Поиск заказов премии" style={{width:280,maxWidth:"100%",height:36}} placeholder={employee.role==='operator'?'Номер заказа или клиент':'Заказ, клиент, оператор, реестр'} value={query} onChange={e=>setQuery(e.target.value)}/><button className="secondary" onClick={()=>{setQuery('');setOperator('');}}>Сбросить поиск</button></div>
  <p>Заказов: <strong>{rows.length}</strong> · Сумма заказов: <strong>{money(rows.reduce((sum,r)=>sum+Math.round((r.order.importedPayment?r.order.importedPayment.amount:isCdekOrder(r.order)?r.order.cdekRemittances![0].collectedCents/100:r.amount)*100),0)/100)}</strong></p>
  <Table><TableHeader><TableRow><TableHead>Заказ / клиент</TableHead>{employee.role!=='operator'&&<TableHead>Оператор</TableHead>}<TableHead>Доставка</TableHead><TableHead>Оплачено клиентом</TableHead><TableHead>Деньги получены</TableHead><TableHead>Основание</TableHead><TableHead>Премия</TableHead></TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={r.order.id}><TableCell><button className="text-button" onClick={()=>onOpen(r.order.id)}>{r.order.id}</button><div>{names.get(r.order.clientId)||'Клиент'}</div></TableCell>{employee.role!=='operator'&&<TableCell>{staff.get(r.order.manager)?.name||r.order.manager}<div className="muted">{staff.get(r.order.manager)?.login}</div></TableCell>}<TableCell>{deliveryLabels[r.order.delivery||'']}</TableCell><TableCell>{money(r.order.importedPayment?r.order.importedPayment.amount:isCdekOrder(r.order)?r.order.cdekRemittances![0].collectedCents/100:r.amount)}</TableCell><TableCell>{money(r.amount)}<div>{r.date?dateLabel(r.date):'По ведомости'}</div></TableCell><TableCell>{r.order.importedPayment?(r.registry?'Реестр №'+r.registry+' · ':'')+r.order.importedPayment.source:r.registry?'Реестр №'+r.registry:'Приём денег в CRM'}</TableCell><TableCell>{r.order.premiumStage?.status==='paid'?'Выплачено':r.order.premiumStage?.status==='accrued'?'Начислено':r.order.legacyLv?'Нужна сверка прошлых выплат':'Ожидает расчёта'}</TableCell></TableRow>)}</TableBody></Table>
  {!rows.length&&<div className="empty"><h3>Нет подтверждённых заказов</h3><p>{selected.length?'Измените поиск или оператора.':'В текущем периоде пока нет подтверждённых поступлений. Прошлые выплаты находятся в архиве.'}</p></div>}
  </>}
  {(view==='calculation'||view==='employees')&&period&&<PremiumPayroll actionsTarget={actionsTarget} key={employee.id+period.id} orders={orders} employee={employee} employees={employees} period={period.id} view={view} group={group} onGroupChange={setGroup} onReload={onReload} onPeriodChange={id=>{setPeriodId(id);setActivePeriod(id);}}/>}
 </>}
 </section>;
}

function MissingPayrollOrders({employeeId,period}:{employeeId:string;period:string}){
 const [rows,setRows]=useState<{externalId:string;login:string;amount:number}[]>([]);
 useEffect(()=>{let active=true;fetch('/api/premium?actorId='+encodeURIComponent(employeeId)+'&period='+encodeURIComponent(period)).then(r=>r.ok?r.json():null).then(value=>{const r=value as {missingOrders?:typeof rows}|null;if(active)setRows(r?.missingOrders||[]);}).catch(()=>{if(active)setRows([]);});return()=>{active=false;};},[employeeId,period]);
 if(!rows.length)return null;
 return <details className="notice"><summary>Заказы ведомости, не найденные в CRM: {rows.length}</summary><Table><TableHeader><TableRow><TableHead>Номер ЛВ</TableHead><TableHead>Оператор</TableHead><TableHead>Сумма</TableHead></TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={r.externalId}><TableCell>{r.externalId}</TableCell><TableCell>{r.login}</TableCell><TableCell>{money(r.amount)}</TableCell></TableRow>)}</TableBody></Table></details>;
}

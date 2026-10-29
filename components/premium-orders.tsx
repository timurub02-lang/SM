"use client";
import {PremiumPayroll} from '@/components/premium-payroll';
import {useState} from 'react';
import {isCdekOrder} from '@/lib/cdek-remittance';
import {premiumOrders} from '@/lib/premium-orders';
import {premiumPeriods,periodForReceipt,currentPremiumPeriod} from '@/lib/premium-periods';
import {money,deliveryLabels,type Order,type Employee,type Client} from '@/lib/crm';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';

const dateLabel=(date:string)=>date.split('-').reverse().join('.');
export function PremiumOrders({orders,employee,employees,clients,onOpen,onReload}:{orders:Order[];employee:Employee;employees:Employee[];clients:Client[];onOpen:(id:string)=>void;onReload:()=>Promise<unknown>}){
 const [view,setView]=useState<'calculation'|'orders'|'employees'>('calculation');
 const [current]=useState(()=>currentPremiumPeriod(new Date(Date.now()+3*3600000).toISOString().slice(0,10)));
 const [periodId,setPeriodId]=useState(current?.id||'unassigned'),[query,setQuery]=useState(''),[operator,setOperator]=useState('');
 const all=premiumOrders(orders,employee,employees).map(r=>({...r,periodId:periodForReceipt(r.date)?.id||'unassigned'}));
 const period=premiumPeriods.find(p=>p.id===periodId);
 const next=current?premiumPeriods[premiumPeriods.findIndex(p=>p.id===current.id)+1]:undefined;
 const counts=new Map<string,number>();for(const r of all)counts.set(r.periodId,(counts.get(r.periodId)||0)+1);
 const choices=premiumPeriods.filter(p=>counts.has(p.id)||p.id===current?.id||p.id===next?.id);
 const selected=all.filter(r=>r.periodId===periodId);
 const names=new Map(clients.map(c=>[c.id,c.name]));
 const staff=new Map(employees.map(e=>[e.id,e]));
 const rows=selected.filter(r=>(!operator||r.order.manager===operator)&&[r.order.id,names.get(r.order.clientId),staff.get(r.order.manager)?.name,staff.get(r.order.manager)?.login,r.registry].join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 return <section className="stack table-panel cash-panel" aria-label="Премия">
  <h2>Премия</h2>
  <div className="toolbar" role="tablist" aria-label="Разделы премии">{([['calculation','Расчёт выплат'],['orders','Заказы'],['employees','Сотрудники']] as const).filter(([id])=>employee.role!=='operator'||id!=='employees').map(([id,label])=><button type="button" role="tab" aria-selected={view===id} className={view===id?'primary':'secondary'} key={id} onClick={()=>setView(id)}>{label}</button>)}</div>
  <label>Расчётный период <select aria-label="Расчётный период" value={periodId} onChange={e=>{setPeriodId(e.target.value);setQuery('');setOperator('');}}>
   {choices.map(p=><option key={p.id} value={p.id}>{p.label} · {counts.get(p.id)||0} заказов</option>)}
   {(counts.has('unassigned')||!current)&&<option value="unassigned">Требуется календарь · {counts.get('unassigned')||0} заказов</option>}
  </select></label>
  {period?<div className="notice"><div><strong>{period.label}</strong><p>Деньги получены: {dateLabel(period.from)} — {dateLabel(period.cutoff)} включительно.</p><p>Выплата: {dateLabel(period.payout)}{period.payout!==period.nominal?' (перенесена с '+dateLabel(period.nominal)+')':''}.</p></div></div>:<p role="alert">Для этих дат нужно добавить производственный календарь. Заказы сохранены и не включены в другие периоды.</p>}
  <p className="muted">СДЭК — по дате перечисления в реестре; почта и курьер — по дате приёма денег. До плановой даты выплаты оставлены четыре полных рабочих дня с учётом праздников и переносов.</p>
  <div className="notice amber">Список для расчёта. Полученные деньги — не сумма премии. По заказам из ЛВ нужна сверка прошлых выплат. Подписи, закрытие периода и факт выплаты ещё не оформлены.</div>
  {view==='orders'&&<>
  <div className="toolbar">{employee.role!=='operator'&&<select aria-label="Оператор премии" value={operator} onChange={e=>setOperator(e.target.value)}><option value="">Все операторы</option>{[...new Set(selected.map(r=>r.order.manager))].map(id=><option key={id} value={id}>{staff.get(id)?.name||id}</option>)}</select>}<input aria-label="Поиск заказов премии" placeholder="Заказ, клиент, оператор, реестр" value={query} onChange={e=>setQuery(e.target.value)}/><button className="secondary" onClick={()=>{setQuery('');setOperator('');}}>Сбросить поиск</button></div>
  <p>Заказов: <strong>{rows.length}</strong> · Получено: <strong>{money(rows.reduce((sum,r)=>sum+Math.round(r.amount*100),0)/100)}</strong></p>
  <Table><TableHeader><TableRow><TableHead>Заказ / клиент</TableHead><TableHead>Оператор</TableHead><TableHead>Доставка</TableHead><TableHead>Оплачено клиентом</TableHead><TableHead>Деньги получены</TableHead><TableHead>Основание</TableHead><TableHead>Премия</TableHead></TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={r.order.id}><TableCell><button className="text-button" onClick={()=>onOpen(r.order.id)}>{r.order.id}</button><div>{names.get(r.order.clientId)||'Клиент'}</div></TableCell><TableCell>{staff.get(r.order.manager)?.name||r.order.manager}<div className="muted">{staff.get(r.order.manager)?.login}</div></TableCell><TableCell>{deliveryLabels[r.order.delivery||'']}</TableCell><TableCell>{money(isCdekOrder(r.order)?r.order.cdekRemittances![0].collectedCents/100:r.amount)}</TableCell><TableCell>{money(r.amount)}<div>{dateLabel(r.date)}</div></TableCell><TableCell>{r.registry?'Реестр №'+r.registry:'Приём денег в CRM'}</TableCell><TableCell>{r.order.legacyLv?'Нужна сверка прошлых выплат':'Ожидает расчёта'}</TableCell></TableRow>)}</TableBody></Table>
  {!rows.length&&<div className="empty"><h3>Нет подтверждённых заказов</h3><p>{selected.length?'Измените поиск или оператора.':'В этом периоде пока нет подтверждённых поступлений. Выберите другой период.'}</p></div>}
  </>}
  {view!=='orders'&&period&&<PremiumPayroll key={employee.id+period.id} orders={orders} employee={employee} employees={employees} period={period.id} view={view} onReload={onReload}/>}
 </section>;
}

"use client";
import {useEffect,useState} from 'react';
import {money,type Employee,type Order} from '@/lib/crm';
import type {PayrollOrder} from '@/lib/premium-ledger';
import {PremiumPayroll} from './premium-payroll';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from './ui/table';
type Period={id:string;label:string;paidAt?:string;source?:string;count:number;payout:number;orders:PayrollOrder[];historyOrders:PayrollOrder[]};
export function PremiumArchive({employee,employees,orders,onOpen,onReload}:{employee:Employee;employees:Employee[];orders:Order[];onOpen:(id:string)=>void;onReload:()=>Promise<unknown>}){
 const [periods,setPeriods]=useState<Period[]>([]),[selected,setSelected]=useState(''),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[page,setPage]=useState(0),[group,setGroup]=useState('all');
 useEffect(()=>{let active=true;fetch('/api/premium/archive?actorId='+encodeURIComponent(employee.id),{cache:'no-store'}).then(async r=>{const data=await r.json() as {periods:Period[];error?:string};if(!r.ok)throw Error(data.error||'Не удалось загрузить архив');if(active){setPeriods(data.periods);setSelected(data.periods[0]?.id||'');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[employee.id]);
 const period=periods.find(p=>p.id===selected),search=query.trim().toLowerCase();
 const found=(search?periods:period?[period]:[]).flatMap(p=>[...p.orders,...(search?p.historyOrders:[])].map(o=>({...o,period:p.label}))).filter(o=>!search||[o.externalId,o.id,o.login].join(' ').toLowerCase().includes(search));
 return <div className="stack"><h3>История оплат</h3><div className="toolbar"><label>Выплаченный период <select aria-label="Период архива премии" value={selected} onChange={e=>{setSelected(e.target.value);setQuery('');setPage(0);}}>{periods.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><input aria-label="Поиск по истории выплат" placeholder="Номер заказа или логин — по всему архиву" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></div>
 {loading?<p>Загрузка архива…</p>:error?<p role="alert">{error}</p>:!period?<p>Выплаченных периодов пока нет.</p>:<>
 <p>{period.label} · Выплачено: <strong>{money(period.payout)}</strong> · Заказов: {period.count}</p>{period.source&&<small className="muted">Источник: {period.source}</small>}
 {!search&&!!period.historyOrders.length&&<p className="notice">Отдельно в старой истории: {period.historyOrders.map(o=>o.externalId).join(', ')}. Эти заказы уже выплачены, но не входят в подтверждённый расчёт периода; суммы в источнике отсутствуют.</p>}
 {!search&&<details><summary>Посмотреть расчёт выплат</summary><PremiumPayroll key={selected} employee={employee} employees={employees} orders={orders} period={selected} view="calculation" group={group} onGroupChange={setGroup} onReload={onReload} onPeriodChange={setSelected}/></details>}
 <p>{search?'Найдено по всему архиву: ':'Заказы периода: '}{found.length}</p>
 <Table><TableHeader><TableRow><TableHead>Заказ</TableHead><TableHead>Период выплаты</TableHead><TableHead>Оператор</TableHead><TableHead>Сумма заказа, ₽</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader><TableBody>{found.slice(page*60,(page+1)*60).map(o=><TableRow key={o.externalId}><TableCell>{o.id&&orders.some(r=>r.id===o.id)?<button className="text-button" onClick={()=>onOpen(o.id!)}>{o.externalId}</button>:o.externalId}</TableCell><TableCell>{o.period}</TableCell><TableCell>{o.login||'Нет данных в источнике'}</TableCell><TableCell>{o.amountUnknown?'Нет данных':money(o.amount)}</TableCell><TableCell>Выплачено</TableCell></TableRow>)}</TableBody></Table>
 {found.length>60&&<div className="toolbar"><button disabled={!page} onClick={()=>setPage(page-1)}>Назад</button><span>{page+1} / {Math.ceil(found.length/60)}</span><button disabled={(page+1)*60>=found.length} onClick={()=>setPage(page+1)}>Далее</button></div>}
 </>}
 </div>;
}

"use client";
import {useEffect,useState} from 'react';
import {money,departments,type Employee} from '@/lib/crm';
import type {premiumStatistics} from '@/lib/premium-statistics';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
type Report={month:string;months:string[];periods:{id:string;status:string}[];rows:ReturnType<typeof premiumStatistics>};
export function PremiumStatistics({employee}:{employee:Employee}){
 const [month,setMonth]=useState(''),[group,setGroup]=useState('all'),[data,setData]=useState<Report|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');fetch('/api/premium/statistics?actorId='+encodeURIComponent(employee.id)+'&month='+month,{cache:'no-store'}).then(async r=>{const value=await r.json() as Report&{error?:string};if(!r.ok)throw Error(value.error||'Не удалось загрузить статистику');return value as Report;}).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[employee.id,month]);
 const rows=(data?.rows||[]).filter(r=>group==='all'||r.department===group);
 return <section className="stack table-panel cash-panel"><h2>Статистика выплат</h2><div className="toolbar"><label>Месяц <select aria-label="Месяц статистики выплат" value={month||data?.month||''} onChange={e=>setMonth(e.target.value)}>{data?.months.map(m=><option key={m} value={m}>{m}</option>)}</select></label>{employee.role==='admin'&&<label>Отдел <select aria-label="Отдел статистики выплат" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">Все отделы</option>{Object.entries(departments).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}</div>
 <p className="muted">Выплаты включают официальную часть. Сумма заказов — без удержаний СДЭК. Операторы с суммой заказов за месяц менее 300 000 ₽ выделены красным.</p>
 {data?.periods.map(p=><small key={p.id}>{p.id.endsWith('-1')?'1-й':'2-й'} период: {p.status==='paid'?'выплачен':p.status==='frozen'?'подписывается':'предварительный расчёт'}</small>)}
 {error?<p role="alert">{error}</p>:!data?<p>Загрузка статистики…</p>:<><Table><TableHeader><TableRow><TableHead>Сотрудник</TableHead><TableHead>Сумма заказов, ₽</TableHead><TableHead>1-й период, ₽</TableHead><TableHead>2-й период, ₽</TableHead><TableHead>За месяц, ₽</TableHead></TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={r.id} style={r.role==='operator'&&r.volume<300000?{background:'rgba(220,38,38,.08)'}:undefined}><TableCell>{r.login}<div className="muted">{r.name}{r.role==='department_head'?' · Руководитель':''}</div></TableCell><TableCell>{r.role==='operator'?money(r.volume):'—'}</TableCell><TableCell>{r.first===null?'—':money(r.first)}</TableCell><TableCell>{r.second===null?'—':money(r.second)}</TableCell><TableCell>{money(r.total)}</TableCell></TableRow>)}</TableBody></Table><strong>Итого за месяц: {money(rows.reduce((sum,r)=>sum+Math.round(r.total*100),0)/100)}</strong>{!rows.length&&<p>Нет расчётов за выбранный месяц.</p>}</>}
 </section>;
}

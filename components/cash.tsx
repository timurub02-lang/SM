"use client";
import {useEffect,useRef,useState} from 'react';
import {money,stamp} from '@/lib/crm';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
type Operation={id:string;kind:string;sender:string|null;recipient:string|null;amount:number;purpose:string;date:string;created_at:string;accepted_at:string|null;sender_name:string;recipient_name:string};
type CashData={balance:number;operations:Operation[];recipients:{id:string;name:string;login:string}[]};
export function Cash({actorId}:{actorId:string}){
 const [data,setData]=useState<CashData|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [kind,setKind]=useState('add');const [amount,setAmount]=useState('');const [purpose,setPurpose]=useState('');const [recipient,setRecipient]=useState('');
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});const [date,setDate]=useState(today);
 const retry=useRef<{key:string;id:string}|null>(null);
 async function request(body?:unknown){const r=await fetch('/api/cash?actorId='+encodeURIComponent(actorId),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const value=await r.json() as CashData&{error?:string};if(!r.ok)throw Error(value.error||'Не удалось загрузить кассу');return value;}
 useEffect(()=>{let active=true;request().then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return ()=>{active=false;};},[actorId]);
 async function submit(id?:string){setBusy(true);setError('');try{
  if(id)setData(await request({action:'accept',id}));
  else {const operation={kind,amount:Number(amount),date,purpose:kind==='spend'?'Зарплата':kind==='transfer'?'Перевод другому сотруднику':purpose,...(kind==='transfer'?{recipient}:{})};const key=JSON.stringify(operation);if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};setData(await request({action:'create',operation:{...operation,id:retry.current.id}}));retry.current=null;setAmount('');setPurpose('');}
 }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');}finally{setBusy(false);}}
 return <section className="stack table-panel" style={{padding:24}}><div className="toolbar"><h2>Моя касса</h2><strong>{data?money(data.balance/100):'Загрузка…'}</strong><button className="secondary" disabled={busy} onClick={()=>{setError('');request().then(setData).catch(e=>setError(e.message));}}>Обновить</button></div>
 <p className="muted">Деньги в пути не входят в баланс получателя до подтверждения. При переводе сумма сразу списывается из кассы отправителя.</p>
 {error&&<p role="alert" className="notice amber">{error}</p>}
 <form className="stack" onSubmit={e=>{e.preventDefault();void submit();}}><div className="form-grid">
 <label>Операция<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="add">Пополнить кассу</option><option value="spend">Списание — зарплата</option><option value="transfer">Перевод другому сотруднику</option></select></label>
 <label>Сумма, ₽<input type="number" step="0.01" min="0.01" max="100000000" required value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
 <label>Дата операции<input type="date" max={today} required value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
 {kind==='add'&&<label>Основание пополнения<input required maxLength={500} value={purpose} disabled={busy} onChange={e=>setPurpose(e.target.value)} placeholder="Например, начальный остаток"/></label>}
 {kind==='transfer'&&<label>Получатель<select required value={recipient} disabled={busy} onChange={e=>setRecipient(e.target.value)}><option value="">Выберите сотрудника</option>{data?.recipients.map(e=><option value={e.id} key={e.id}>{e.name} · {e.login}</option>)}</select></label>}
 </div><button className="primary" disabled={busy||!data}>{busy?'Сохранение…':kind==='add'?'Пополнить':kind==='spend'?'Списать':'Передать деньги'}</button></form>
 <h3>Операции кассы</h3><Table><TableHeader><TableRow><TableHead>Дата операции</TableHead><TableHead>Назначение</TableHead><TableHead>Отправитель / получатель</TableHead><TableHead>Сумма</TableHead><TableHead>Получение</TableHead></TableRow></TableHeader><TableBody>{data?.operations.map(o=>{const incoming=o.recipient===actorId;const pending=o.kind==='transfer'&&!o.accepted_at;return <TableRow key={o.id} style={pending?{background:'#f1f3f5',color:'#64748b'}:undefined}><TableCell>{o.date.split('-').reverse().join('.')}<small className="block muted">Записано: {stamp(o.created_at)}</small></TableCell><TableCell>{o.purpose}</TableCell><TableCell>{incoming?o.sender_name||'Пополнение':o.recipient_name||'Выдача из кассы'}</TableCell><TableCell>{incoming?'+':'−'}{money(o.amount/100)}</TableCell><TableCell>{pending?<><span>В пути · ожидает подтверждения</span>{incoming&&<button className="primary" disabled={busy} onClick={()=>void submit(o.id)}>Подтвердить получение</button>}</>:o.accepted_at?`Подтверждено ${stamp(o.accepted_at)}`:'—'}</TableCell></TableRow>;})}</TableBody></Table>{data&&!data.operations.length&&<p className="muted">Операций пока нет. Начальный баланс — 0 ₽.</p>}
 </section>;
}

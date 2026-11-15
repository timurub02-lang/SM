"use client";
import {useEffect,useState} from 'react';
import type {CdekRemittance} from '@/lib/cdek-remittance';
import {money,type Order} from '@/lib/crm';
import {hasRemittanceConflict} from '@/lib/cdek-remittance';
export function CdekPaymentConflicts({orders,actorId}:{orders:Order[];actorId:string}){
 const rows=orders.filter(o=>(o.cdekRemittances?.length||0)>1);

 return <><MissingCdekOrders actorId={actorId}/>{!!rows.length&&<section className="stack table-panel cash-panel"><h2>СДЭК: повторные перечисления · {rows.length}</h2><p className="notice amber">При одинаковых суммах премия учитывается один раз по первому полученному реестру. Разные суммы требуют проверки администратора.</p>{rows.map(o=><div key={o.id}><h3>{o.id} · {hasRemittanceConflict(o)?'Разные суммы — требуется проверка':'Премия учитывается один раз'}</h3>{o.cdekRemittances!.map((r,i)=><p key={i}>{!hasRemittanceConflict(o)&&(i===0?'Учитывается · ':'Дубль — без начисления · ')}Аккаунт {r.slot} · реестр №{r.registry} · {r.paymentDate.split('-').reverse().join('.')} · {money(r.amountCents/100)} · накладная {r.tracking}</p>)}</div>)}</section>}</>;
}

function MissingCdekOrders({actorId}:{actorId:string}){
 const [data,setData]=useState<{total:number;rows:CdekRemittance[]}>({total:0,rows:[]}),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;setLoading(true);setError('');fetch('/api/cdek/unmatched-remittances?'+new URLSearchParams({actorId,page:String(page)}),{cache:'no-store'}).then(async r=>{const body=await r.json() as {total:number;rows:CdekRemittance[];error?:string};if(!r.ok)throw Error(body.error||'Не удалось загрузить несопоставленные поступления');if(active)setData(body);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[actorId,page,refresh]);
 return <section className="stack table-panel cash-panel"><div className="toolbar"><h2>СДЭК: заказ не найден · {data.total}</h2><button className="secondary" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Обновить</button></div><p className="muted">Поступления без найденного заказа. Они не включены в премию и кассу. После сопоставления при повторной сверке реестра запись исчезнет из этого списка.</p>{error?<p role="alert">{error}</p>:loading?<p>Загрузка…</p>:<>{!data.rows.length&&<p>Несопоставленных поступлений нет.</p>}{data.rows.map(r=><div key={JSON.stringify(r)}><h3>Заказ не найден · накладная {r.tracking}</h3><p>Аккаунт {r.slot} · реестр №{r.registry} · {r.paymentDate.split('-').reverse().join('.')}</p><p>Оплатил клиент: {money(r.collectedCents/100)} · Перечислено СДЭК: {money(r.amountCents/100)}</p></div>)}{data.total>50&&<nav className="action-buttons" aria-label="Страницы несопоставленных поступлений"><button className="secondary" disabled={!page} onClick={()=>setPage(n=>n-1)}>Назад</button><span>Страница {page+1} из {Math.ceil(data.total/50)}</span><button className="secondary" disabled={(page+1)*50>=data.total} onClick={()=>setPage(n=>n+1)}>Далее</button></nav>}</>}</section>;
}

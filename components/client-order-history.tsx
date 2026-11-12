"use client";
import {useEffect,useState} from "react";
import type {ClientOrderHistoryEntry} from "@/lib/client-order-history";
import {money,type Client,type Order} from '@/lib/crm';
import {clientHistoryEntries} from '@/lib/client-order-history';
const date=(value:string)=>new Date(value).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'});
export function ClientOrderHistory({client,orders,remote=false}:{client:Client;orders:Order[];remote?:boolean}){
 const [page,setPage]=useState(0),[data,setData]=useState<{rows:ClientOrderHistoryEntry[];total:number}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>setPage(0),[client.id,client.version]);
 useEffect(()=>{if(!remote)return;const abort=new AbortController();setLoading(true);setError('');fetch('/api/crm/history?'+new URLSearchParams({clientId:client.id,legacy:'1',page:String(page)}),{signal:abort.signal}).then(async r=>{const d=await r.json() as {rows:ClientOrderHistoryEntry[];total:number;error?:string};if(!r.ok)throw Error(d.error||'Не удалось загрузить историю');setData(d);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[remote,client.id,client.version,page]);
 const rows=remote?(data?.rows||[]):clientHistoryEntries(client.legacyOrderHistory||[],orders);
 if(loading)return <p role="status">Загрузка предыдущих заказов…</p>;
 if(error)return <p role="alert">{error}</p>;
 if(!rows.length)return null;
 return <section className="stack" aria-label="История предыдущих заказов"><h3>История предыдущих заказов</h3>{rows.map(row=><article key={row.externalId} className="base-sheet-settings stack"><div className="section-title"><strong>ЛВ №{row.externalId}</strong><strong>{money(row.amount)}</strong></div><div><span className={row.status==='paid'?'badge mint':'badge amber'}>{row.status==='paid'?'Оплачен':'Возврат'}</span> <small>Создан {date(row.createdAt)}{row.completedAt&&` · ${row.status==='paid'?'Оплачен':'Возвращён'} ${date(row.completedAt)}`}</small></div>{row.items.map((item,i)=><div key={i}>{item.name}{item.quantity!==undefined&&` · ${item.quantity} шт.`}</div>)}</article>)}{remote&&data&&data.total>50&&<nav className="action-buttons" aria-label="Страницы предыдущих заказов"><button disabled={page===0} onClick={()=>setPage(page-1)}>Назад</button><span>{page+1} / {Math.ceil(data.total/50)}</span><button disabled={(page+1)*50>=data.total} onClick={()=>setPage(page+1)}>Далее</button></nav>}</section>;
}

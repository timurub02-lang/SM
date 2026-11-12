'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {Search} from 'lucide-react';
import {clientSheet,type Client} from '@/lib/crm';
import {baseLabel} from '@/lib/base-policy';
export function BaseClientSearch({actorId,onOpen,initialQuery="",details}:{actorId:string;onOpen:(client:Client)=>void;initialQuery?:string;details?:(client:Client)=>ReactNode}){
 const [query,setQuery]=useState(initialQuery),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [result,setResult]=useState<{matches:{client:Client;ownerName:string}[];more:boolean}|null>(null);
 async function search(e?:React.FormEvent){e?.preventDefault();setBusy(true);setError('');setResult(null);try{
  const r=await fetch('/api/base-search?'+new URLSearchParams({q:query.trim(),actorId}),{cache:'no-store'}),data=await r.json() as {matches:{client:Client;ownerName:string}[];more:boolean;error?:string};
  if(!r.ok)throw Error(data.error||'Не удалось найти клиента');setResult(data);
 }catch(e){setError(e instanceof Error?e.message:'Ошибка поиска');}finally{setBusy(false);}}
 useEffect(()=>{if(initialQuery.trim().length>=3)void search();},[]);
 return <section className="stack" aria-label="Поиск клиентов по всем базам"><form className="toolbar" onSubmit={search}><div className="search"><Search size={18}/><input aria-label="Поиск по ФИО, телефону или номеру заказа" placeholder="ФИО, телефон или номер заказа" minLength={3} maxLength={100} required value={query} disabled={busy} onChange={e=>{setQuery(e.target.value);setResult(null);setError('');}}/></div><button className="primary" disabled={busy||query.trim().length<3}>{busy?'Поиск…':'Найти клиента'}</button>{query&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setQuery('');setResult(null);setError('');}}>Сбросить</button>}</form><small className="muted">Поиск по обеим базам М и Ж и всем листам, включая дополнительные телефоны.</small>{error&&<p role="alert">{error}</p>}{result&&<div className="stack" aria-live="polite"><p>{result.more?'Найдено больше 30 клиентов. Уточните поиск.':`Найдено клиентов: ${result.matches.length}`}</p>{result.matches.map(({client,ownerName})=><article className="stack" key={client.id}><button type="button" className="order-mini" onClick={()=>onOpen(client)}><div><b>{client.name}</b><small>{client.phone} · {baseLabel(client.baseType||'M')} · {clientSheet(client)}</small><small>{ownerName}</small></div><span>Открыть →</span></button>{details?.(client)}</article>)}</div>}</section>;
}

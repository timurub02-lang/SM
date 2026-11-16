'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {shipmentStats} from '../lib/shipment-stats';
import type {State,Employee,Order} from '../lib/crm';
type Row=ReturnType<typeof shipmentStats>[number];
type Key='label'|'sentCdek'|'sentPost'|'sentMoscow'|'sent'|'redeemed'|'returned';
export function ShipmentStats({state,actor,from,to,department,byDay,summaryMode,metric}:{state:State;actor:Employee;from:string;to:string;department:string;byDay:boolean;summaryMode:boolean;metric:(value:string|number,orders:Order[],label:string)=>ReactNode}){
 const [remote,setRemote]=useState<Row[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [sort,setSort]=useState<{key:Key;ascending:boolean}>({key:byDay?'label':'sent',ascending:false});
 useEffect(()=>setSort({key:byDay?'label':'sent',ascending:false}),[byDay]);
 useEffect(()=>{
  if(!summaryMode)return;
  const controller=new AbortController();setLoading(true);setError('');setRemote([]);
  fetch(`/api/operator-statistics?section=shipped&actorId=${encodeURIComponent(actor.id)}&from=${from}&to=${to}&department=${encodeURIComponent(department)}&groupBy=${byDay?'day':'operator'}`,{signal:controller.signal}).then(async response=>{const data=await response.json() as {rows:Omit<Row,'orders'>[];error?:string};if(!response.ok)throw Error(data.error||'Не удалось загрузить отправленные');return data.rows.map(row=>({...row,orders:[]}));}).then(rows=>{if(!controller.signal.aborted)setRemote(rows);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[summaryMode,actor.id,from,to,department,byDay]);
 const rows=(summaryMode?remote:shipmentStats(state,actor,from,to,department,byDay)).sort((a,b)=>{const comparison=sort.key==='label'?a.label.localeCompare(b.label,'ru',{numeric:true}):a[sort.key]-b[sort.key];return (sort.ascending?comparison:-comparison)||a.label.localeCompare(b.label,'ru');});
 const columns:[Key,string][]=[['label',byDay?'Дата':'Оператор'],['sentCdek','СДЭК'],['sentPost','Почта России'],['sentMoscow','Курьер Москва'],['sent','Всего отправлено'],['redeemed','Из них выкуплено'],['returned','Из них возврат']];
 function cells(row:Row){return columns.slice(1).map(([key,label])=>{const orders=row.orders.filter(o=>key==='returned'?o.status==='returned':key==='redeemed'?o.status==='redeemed':key==='sentCdek'?o.delivery?.startsWith('cdek_'):key==='sentPost'?o.delivery==='russian_post':key==='sentMoscow'?o.delivery==='moscow_courier':true);return <td key={key}>{metric(row[key],orders,label)}</td>;});}
 const total:Row={id:'total',label:'Итого',sentCdek:0,sentPost:0,sentMoscow:0,sent:0,redeemed:0,returned:0,orders:rows.flatMap(r=>r.orders)};
 for(const row of rows)for(const key of ['sentCdek','sentPost','sentMoscow','sent','redeemed','returned'] as const)total[key]+=row[key];
 if(loading&&summaryMode)return <p role="status">Загрузка отправленных заказов…</p>;
 if(error&&summaryMode)return <p role="alert">{error}</p>;
 return <><div className="stats-results"><div className="stats-table-wrap"><table className="stats-table"><colgroup><col style={{width:'28%'}}/>{columns.slice(1).map(([key])=><col key={key}/>)}</colgroup><thead><tr>{columns.map(([key,label])=><th key={key} aria-sort={sort.key===key?(sort.ascending?'ascending':'descending'):'none'}><button className="stats-sort" onClick={()=>setSort({key,ascending:sort.key===key?!sort.ascending:key==='label'})}>{label} <span aria-hidden="true">{sort.key===key?(sort.ascending?'↑':'↓'):'↕'}</span></button></th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{byDay?row.label.split('-').reverse().join('.'):row.label}</td>{cells(row)}</tr>)}</tbody><tfoot><tr><th>Итого</th>{cells(total)}</tr></tfoot></table></div>{!rows.length&&<p>За выбранный период нет заказов с известной датой отправки.</p>}</div><p className="muted">Период — по дате отправки, по Москве. Для СДЭК — дата выгрузки; приём перевозчиком не переносит заказ на другой день. Выкуп и возврат — текущее состояние именно этих заказов, независимо от даты выкупа. Заказы без даты отправки не включены.</p></>;
}

'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {confirmationOutcome,confirmationStats} from '../lib/confirmation-stats';
import type {State,Employee,Order} from '../lib/crm';
type Row=ReturnType<typeof confirmationStats>[number];
type Key='label'|'confirmed'|'cancelled'|'sent'|'paid'|'returned'|'waiting';
export function ConfirmationStats({state,actor,from,to,department,summaryMode,metric}:{state:State;actor:Employee;from:string;to:string;department:string;summaryMode:boolean;metric:(value:string|number,orders:Order[],label:string)=>ReactNode}){
 const [remote,setRemote]=useState<(Row & {orderIds?:string[]})[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const useRemote=actor.role==='admin'||actor.role==='department_head';
 const [sort,setSort]=useState<{key:Key;ascending:boolean}>({key:'confirmed',ascending:false});
 useEffect(()=>{
  if(!useRemote)return;
  const controller=new AbortController();setLoading(true);setError('');setRemote([]);
  fetch(`/api/operator-statistics?section=confirmation&scope=${summaryMode?'all':'own'}&actorId=${encodeURIComponent(actor.id)}&from=${from}&to=${to}&department=${encodeURIComponent(department)}`,{signal:controller.signal}).then(async response=>{const data=await response.json() as {rows:(Omit<Row,'orders'> & {orderIds?:string[]})[];error?:string};if(!response.ok)throw Error(data.error||'Не удалось загрузить подтверждения');return data.rows.map(row=>({...row,orders:[]}));}).then(rows=>{if(!controller.signal.aborted)setRemote(rows);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[useRemote,summaryMode,actor.id,from,to,department]);
 const rows=(useRemote?remote.map(row=>({...row,orders:summaryMode?[]:state.orders.filter(o=>row.orderIds?.includes(o.id))})):confirmationStats(state,actor,from,to,department)).sort((a,b)=>{const comparison=sort.key==='label'?a.label.localeCompare(b.label,'ru',{numeric:true}):a[sort.key]-b[sort.key];return (sort.ascending?comparison:-comparison)||a.label.localeCompare(b.label,'ru');});
 const columns:[Key,string][]=[['label','Подтвердил'],['confirmed','Подтверждено'],['cancelled','Отменено'],['waiting','Ожидают отправки'],['sent','Отправлено'],['paid','Оплачено'],['returned','Возврат']];
 function cells(row:Row){return columns.slice(1).map(([key,label])=><td key={key}>{metric(row[key],row.orders.filter(o=>key==='confirmed'||confirmationOutcome(o)===key),label)}</td>);}
 const total:Row={id:'total',label:'Итого',confirmed:0,cancelled:0,waiting:0,sent:0,paid:0,returned:0,orders:rows.flatMap(r=>r.orders)};
 for(const row of rows)for(const key of ['confirmed','cancelled','waiting','sent','paid','returned'] as const)total[key]+=row[key];
 if(loading&&useRemote)return <p role="status">Загрузка подтверждений…</p>;
 if(error&&useRemote)return <p role="alert">{error}</p>;
 return <><div className="stats-results"><div className="stats-table-wrap"><table className="stats-table"><colgroup><col style={{width:'28%'}}/>{columns.slice(1).map(([key])=><col key={key}/>)}</colgroup><thead><tr>{columns.map(([key,label])=><th key={key} aria-sort={sort.key===key?(sort.ascending?'ascending':'descending'):'none'}><button className="stats-sort" onClick={()=>setSort({key,ascending:sort.key===key?!sort.ascending:key==='label'})}>{label} <span aria-hidden="true">{sort.key===key?(sort.ascending?'↑':'↓'):'↕'}</span></button></th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.label}</td>{cells(row)}</tr>)}</tbody><tfoot><tr><th>Итого</th>{cells(total)}</tr></tfoot></table></div>{!rows.length&&<p>За выбранный период нет подтверждений с известным автором.</p>}</div><p className="muted">Период — по последнему подтверждению клиента, по Москве. Каждый заказ учитывается один раз у последнего подтвердившего сотрудника. Заказ учитывается только после перехода на упаковку СДЭК, Почты или курьера Москвы. Передача администратору и ожидание доп. подтверждения до этого перехода не учитываются. Проверка администратором автора не меняет. Столбцы показывают текущее состояние этих заказов. Старые подтверждения учитываются только при наличии записи передачи в истории с автором.</p></>;
}

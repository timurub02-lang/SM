"use client";
import {useEffect,useState} from 'react';
import {stamp,type Event} from '@/lib/crm';
export function CrmHistory({clientId,orderId,revision}:{clientId:string;orderId?:string;revision:string}){
 const [page,setPage]=useState(0),[data,setData]=useState<{rows:Event[];total:number}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>setPage(0),[clientId,orderId,revision]);
 useEffect(()=>{
  const abort=new AbortController();setLoading(true);setError('');
  const query=new URLSearchParams({clientId,page:String(page),...(orderId?{orderId}:{})});
  fetch('/api/crm/history?'+query,{signal:abort.signal}).then(async r=>{const d=await r.json() as {rows:Event[];total:number;error?:string};if(!r.ok)throw Error(d.error||'Не удалось загрузить историю');setData(d);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[clientId,orderId,page,revision]);
 return <section className="history"><h3>История взаимодействий {data&&<span>{data.total}</span>}</h3>{loading&&<p role="status">Загрузка истории…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&data?.rows.map(e=><div className="history-event" key={e.id}><span className="history-dot"/><div><p>{e.text}</p><small>{stamp(e.at)} · {e.actor}</small></div></div>)}{!loading&&!error&&data?.total===0&&<p className="muted">История пока пуста</p>}{data&&data.total>50&&<nav className="action-buttons" aria-label="Страницы истории"><button disabled={loading||page===0} onClick={()=>setPage(page-1)}>Назад</button><span>{page+1} / {Math.ceil(data.total/50)}</span><button disabled={loading||(page+1)*50>=data.total} onClick={()=>setPage(page+1)}>Далее</button></nav>}</section>;
}

'use client';
import {useEffect,useState} from 'react';
import {stamp,type Order,type State} from '@/lib/crm';
import {handoffEntries,previousHandoffComments} from '@/lib/handoff-comments';

export function PreviousHandoffComments({state,order,incomingId}:{state:State;order:Order;incomingId?:string}){
 const [open,setOpen]=useState(false),[events,setEvents]=useState<ReturnType<typeof handoffEntries>|null>(null),[error,setError]=useState(false);
 const {id,clientId,version}=order;
 useEffect(()=>{
  if(!open||!state.historyRemote)return;
  const abort=new AbortController();
  setEvents(null);setError(false);
  const query=new URLSearchParams({clientId,orderId:id,handoff:'1',...(incomingId?{incomingId}:{})});
  fetch('/api/crm/history?'+query,{signal:abort.signal,cache:'no-store'}).then(async response=>{
   if(!response.ok)throw Error();
   const data=await response.json() as {rows:ReturnType<typeof handoffEntries>};
   if(!abort.signal.aborted)setEvents(data.rows);
  }).catch(()=>{if(!abort.signal.aborted)setError(true);});
  return ()=>abort.abort();
 },[open,state.historyRemote,id,clientId,version,incomingId]);
 const rows=!open?null:state.historyRemote?events:handoffEntries(state.events.filter(e=>e.orderId===id).sort((a,b)=>b.at.localeCompare(a.at)));
 const comments=open&&rows?previousHandoffComments(rows,order.reason||''):[];
 return <details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Предыдущие комментарии</summary>{open&&(error?<p role="alert">Не удалось загрузить комментарии. Закройте и откройте список ещё раз.</p>:!rows?<p role="status">Загрузка…</p>:comments.length?comments.map(e=><div key={e.id}><small className="muted">{e.actor} · {stamp(e.at,'Europe/Moscow')} МСК</small><p className="order-overview-comment">{e.text}</p></div>):<p className="muted">Предыдущих комментариев нет.</p>)}</details>;
}

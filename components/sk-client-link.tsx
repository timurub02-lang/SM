'use client';
import {useEffect,useState} from 'react';
export function SkClientLink({orderId,actorId}:{orderId:string;actorId:string}){
 const [url,setUrl]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const cancel=new AbortController();setUrl(null);setLoading(true);setError(false);
  fetch('/api/sk-client-link?'+new URLSearchParams({orderId,actorId}),{cache:'no-store',signal:AbortSignal.any([cancel.signal,AbortSignal.timeout(12000)])})
   .then(async r=>{if(!r.ok)throw Error();const data=await r.json() as {url:string|null};if(!cancel.signal.aborted)setUrl(data.url);})
   .catch(()=>{if(!cancel.signal.aborted)setError(true);}).finally(()=>{if(!cancel.signal.aborted)setLoading(false);});
  return()=>cancel.abort();
 },[orderId,actorId,retry]);
 const icon=<img src="/skorozvon-icon.png" width={32} height={32} alt=""/>;
 if(url)return <a className="sk-client-icon" href={url} target="_blank" rel="noopener noreferrer" aria-label="Открыть клиента в Скорозвоне" title="Открыть клиента в Скорозвоне">{icon}</a>;
 if(loading||error)return <button type="button" className="sk-client-icon" disabled={loading} onClick={()=>setRetry(n=>n+1)} aria-label={loading?'Проверяется ссылка на клиента СК':'Повторить проверку ссылки на клиента СК'} title={loading?'Проверяется ссылка на клиента СК':'Не удалось получить ссылку. Нажмите, чтобы повторить'}>{icon}{error&&<span aria-hidden="true">!</span>}</button>;
 return <button type="button" className="sk-client-icon" disabled aria-label="Связь с клиентом Скорозвона не найдена" title="Связь с клиентом Скорозвона не найдена">{icon}</button>;
}

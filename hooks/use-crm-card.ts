import {useEffect,useRef,useState} from 'react';
import {readJsonResponse} from '@/lib/read-json-response';
import type {State} from '@/lib/crm';

export function useCrmCard(enabled:boolean,actor:string,target:{type:'client'|'order';id:string}|null){
 const key=enabled&&target?new URLSearchParams({part:'card',type:target.type,id:target.id}).toString():'';
 const [result,setResult]=useState<{key:string;data?:State;error?:string;stale?:boolean}>({key:''}),[attempt,retry]=useState(0);
 const revision=useRef(0);
 const checkController=useRef<AbortController|null>(null);
 useEffect(()=>{
  if(!key){setResult({key:''});return;}
  const controller=new AbortController(),readRevision=++revision.current;
  void fetch('/api/crm?'+key,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}).then(readJsonResponse<State>).then(data=>{if(!controller.signal.aborted&&readRevision===revision.current)setResult({key:actor+key,data});}).catch(error=>{if(!controller.signal.aborted&&readRevision===revision.current)setResult({key:actor+key,error:error instanceof Error?error.message:'Карточка недоступна'});});
  return()=>{controller.abort();checkController.current?.abort();};
 },[key,actor,attempt]);
 const current=result.key===actor+key?result:undefined;
 const check=async()=>{
  if(!key||!current?.data)return;
  checkController.current?.abort();const controller=new AbortController();checkController.current=controller;
  const before=revision.current;
  const fingerprint=(s:State)=>JSON.stringify([s.clients,s.orders,s.settings,s.clientReminders,s.clientWork,s.redemptionResults,s.events,s.employees]);
  try{
   const response=await fetch('/api/crm?'+key,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
   if(controller.signal.aborted||before!==revision.current)return;
   if(response.status===401){window.location.replace('/login');return;}
   if(response.status===403||response.status===404){setResult({key:actor+key,error:'Карточка больше недоступна'});return;}
   const data=await readJsonResponse<State>(response);
   if(!controller.signal.aborted&&before===revision.current)setResult(previous=>previous.key===actor+key&&previous.data?{...previous,stale:fingerprint(data)!==fingerprint(previous.data)}:previous);
  }catch{/* The next scoped notification or fallback retries without replacing unsaved fields. */}
 };
 // Keep the mounted lease owner during a refresh; unmounting it would release and reacquire forever.
 return {data:current?.data,error:current?.error,stale:current?.stale,check,loading:!!key&&!current,retry:()=>retry(n=>n+1),update:(change:(state:State)=>State)=>{revision.current++;setResult(previous=>previous.key===actor+key&&previous.data?{...previous,data:change(previous.data),stale:false}:previous);}};
}

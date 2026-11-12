import {useEffect,useRef,useState} from 'react';
import {readJsonResponse} from '@/lib/read-json-response';
import type {State} from '@/lib/crm';

export function useCrmCard(enabled:boolean,actor:string,target:{type:'client'|'order';id:string}|null){
 const key=enabled&&target?new URLSearchParams({part:'card',type:target.type,id:target.id}).toString():'';
 const [result,setResult]=useState<{key:string;data?:State;error?:string}>({key:''}),[attempt,retry]=useState(0);
 const revision=useRef(0);
 useEffect(()=>{
  if(!key){setResult({key:''});return;}
  const controller=new AbortController(),readRevision=++revision.current;
  void fetch('/api/crm?'+key,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}).then(readJsonResponse<State>).then(data=>{if(!controller.signal.aborted&&readRevision===revision.current)setResult({key:actor+key,data});}).catch(error=>{if(!controller.signal.aborted&&readRevision===revision.current)setResult({key:actor+key,error:error instanceof Error?error.message:'Карточка недоступна'});});
  return()=>controller.abort();
 },[key,actor,attempt]);
 const current=result.key===actor+key?result:undefined;
 // Keep the mounted lease owner during a refresh; unmounting it would release and reacquire forever.
 return {data:current?.data,error:current?.error,loading:!!key&&!current,retry:()=>retry(n=>n+1),update:(change:(state:State)=>State)=>{revision.current++;setResult(previous=>previous.key===actor+key&&previous.data?{...previous,data:change(previous.data)}:previous);}};
}

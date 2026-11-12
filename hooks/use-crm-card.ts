import {useEffect,useRef,useState,type SyntheticEvent} from 'react';
import {readJsonResponse} from '@/lib/read-json-response';
import type {State} from '@/lib/crm';

export function useCrmCard(enabled:boolean,actor:string,target:{type:'client'|'order';id:string}|null){
 const key=enabled&&target?new URLSearchParams({part:'card',type:target.type,id:target.id}).toString():'';
 const [result,setResult]=useState<{key:string;data?:State;latest?:State;error?:string;stale?:boolean}>({key:''}),[attempt,retry]=useState(0);
 const targetKey=actor+':'+(target?target.type+':'+target.id:'');
 const draft=useRef({key:targetKey,touched:false});
 if(draft.current.key!==targetKey)draft.current={key:targetKey,touched:false};
 // shortcut: action controls also protect nested/portalled drafts until the card closes; use explicit draft state if finer refresh is needed.
 const protect=(event:SyntheticEvent)=>{
  const element=event.target instanceof Element?event.target.closest('input,textarea,select,button,[role="combobox"],[role="option"],[role="radio"],[role="checkbox"],[contenteditable="true"]'):null;
  if(element&&!element.matches('[role="tab"],[data-slot="dialog-close"]')&&
   (!['click','keydown'].includes(event.type)||element.matches('button,[role="combobox"],[role="option"],[role="radio"],[role="checkbox"]')))draft.current.touched=true;
 };
 const preserve=()=>draft.current.key===targetKey&&draft.current.touched;
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
   if(!controller.signal.aborted&&before===revision.current)setResult(previous=>{
    if(previous.key!==actor+key||!previous.data)return previous;
    const stale=fingerprint(data)!==fingerprint(previous.data);
    return preserve()?{...previous,latest:data,stale}:stale?{key:actor+key,data}:previous;
   });
  }catch{/* The next scoped notification or fallback retries without replacing unsaved fields. */}
 };
 // Keep the mounted lease owner during a refresh; unmounting it would release and reacquire forever.
 return {data:current?.data,latest:current?.latest,error:current?.error,stale:current?.stale,check,preserve,protect,loading:!!key&&!current,retry:()=>retry(n=>n+1),update:(change:(state:State)=>State)=>{revision.current++;setResult(previous=>previous.key===actor+key&&previous.data?{...previous,data:change(previous.data),latest:undefined,stale:false}:previous);}};
}

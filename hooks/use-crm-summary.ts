import {useEffect,useState} from 'react';
import type {PreparedModel} from '@/lib/crm-read-model';
import type {WorkspaceSummary} from '@/lib/crm-workspace-summary';
import {readJsonResponse} from '@/lib/read-json-response';

export function useCrmSummary(enabled:boolean,actor:string){
 const [result,setResult]=useState<{actor:string;model:PreparedModel<WorkspaceSummary>;confirmedMissing?:boolean}>(),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();let pending=false,queued=false;
  const read=async()=>{
   queued=true;
   if(pending||controller.signal.aborted||document.hidden||!navigator.onLine)return;
   pending=true;queued=false;
   try{
    const response=await fetch('/api/crm?part=summary',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
    if(response.status===401){window.location.replace('/login');return;}
    const model=await readJsonResponse<PreparedModel<WorkspaceSummary>>(response);
    if(!controller.signal.aborted)setResult({actor,model,confirmedMissing:!model.data});
   }catch(error){
    if(!controller.signal.aborted)setResult(previous=>({actor,model:{...(previous?.actor===actor&&((error as {status?:number}).status!==403)?previous.model:{}),schemaVersion:1,status:'error',message:error instanceof Error?error.message:'Не удалось загрузить сводку'}}));
   }finally{pending=false;if(queued&&!controller.signal.aborted&&!document.hidden&&navigator.onLine)void read();}
  };
  void read();const timer=setInterval(()=>void read(),30000);
  const refresh=()=>void read();window.addEventListener('crm-summary-changed',refresh);window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('crm-summary-changed',refresh);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[enabled,actor,attempt]);
 return {model:enabled&&result?.actor===actor?result.model:undefined,confirmedMissing:enabled&&result?.actor===actor&&result.confirmedMissing===true,retry:()=>setAttempt(n=>n+1)};
}

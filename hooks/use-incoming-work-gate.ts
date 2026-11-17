import {useEffect,useState} from 'react';
import {readJsonResponse} from '@/lib/read-json-response';
import {incomingWorkApplies,type IncomingWorkGate} from '@/lib/incoming-work-policy';
import type {Employee} from '@/lib/crm';
export function useIncomingWorkGate(employee:Employee,enabled:boolean,now:number,incomingRevision:string){
 const applies=enabled&&incomingWorkApplies(employee);
 const [state,setState]=useState<{actor:string;gate?:IncomingWorkGate;error?:string}>({actor:''});
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!applies)return;
  const controller=new AbortController();
  const refresh=()=>setRevision(n=>n+1);
  window.addEventListener('focus',refresh);window.addEventListener('crm-incoming-work-updated',refresh);
  void fetch('/api/incoming-work-gate',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(readJsonResponse<IncomingWorkGate>).then(gate=>{if(!controller.signal.aborted)setState({actor:employee.id,gate});}).catch(()=>{if(!controller.signal.aborted)setState(old=>({actor:employee.id,gate:old.actor===employee.id?old.gate:undefined,error:'Не удалось проверить входящие. Повторяем проверку…'}));});
  return()=>{controller.abort();window.removeEventListener('focus',refresh);window.removeEventListener('crm-incoming-work-updated',refresh);};
 },[employee.id,applies,now,revision,incomingRevision]);
 const current=state.actor===employee.id?state:undefined;
 return {gate:current?.gate,error:current?.error,blocked:applies&&(!current?.gate||current.gate.incomingIds.length>0),refresh:()=>setRevision(n=>n+1)};
}

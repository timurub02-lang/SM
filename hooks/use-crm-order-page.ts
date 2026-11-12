import {useEffect,useRef,useState} from 'react';
import {ChangeRefresh} from '@/lib/change-refresh';
import {readJsonResponse} from '@/lib/read-json-response';
import type {State,Order,Client} from '@/lib/crm';
import type {OrderListQuery} from '@/lib/crm-order-list';
type Page={rows:Order[];clients:Client[];total:number;page:number};
export function useCrmOrderPage(query:(OrderListQuery&{page:number;clientWorkFilter:string})|null,state:State,actor:string){
 const key=query?new URLSearchParams({list:query.view==='mine'?'mine':'orders',clientWorkFilter:query.clientWorkFilter,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,view:query.view,filter:query.filter,query:query.query,next:query.showNextPremium?'1':'0',page:String(query.page)}).toString():'';
 const [result,setResult]=useState<{key:string;data?:Page;error?:string}>({key:''});
 const [attempt,retry]=useState(0),[loading,setLoading]=useState(false);
 const refresh=useRef(()=>{});
 useEffect(()=>{
  if(!key){setLoading(false);return;}
  const controller=new AbortController(),queue=new ChangeRefresh();let timer:ReturnType<typeof setTimeout>|undefined;
  const read=async()=>{
   setLoading(true);
   try{const response=await fetch('/api/crm?'+key,{cache:'no-store',signal:controller.signal});const data=await readJsonResponse<Page>(response);if(!controller.signal.aborted)setResult({key:actor+key,data});}
   catch(error){if(!controller.signal.aborted)setResult(previous=>({key:actor+key,data:previous.key===actor+key?previous.data:undefined,error:error instanceof Error?error.message:'Страница недоступна'}));return false;}
   finally{if(!controller.signal.aborted)setLoading(false);}
   return !controller.signal.aborted;
  };
  const request=()=>{queue.request();if(timer)return;timer=setTimeout(()=>{timer=undefined;void queue.flush(()=>controller.signal.aborted,read);},150);};
  refresh.current=request;request();
  return()=>{refresh.current=()=>{};clearTimeout(timer);controller.abort();};
 },[key,actor,attempt]);
 // Background snapshots queue one more read; only changing the page context cancels it.
 useEffect(()=>refresh.current(),[state]);
 const current=result.key===actor+key?result:undefined;
 return {enabled:!!key,data:current?.data,error:current?.error,loading:!!key&&(loading||!current),retry:()=>retry(n=>n+1)};
}

import {useEffect,useState} from 'react';
import type {State,Order,Client} from '@/lib/crm';
import type {OrderListQuery} from '@/lib/crm-order-list';
type Page={rows:Order[];clients:Client[];total:number;page:number};
export function useCrmOrderPage(query:(OrderListQuery&{page:number;clientWorkFilter:string})|null,state:State,actor:string){
 const key=query?new URLSearchParams({list:query.view==='mine'?'mine':'orders',clientWorkFilter:query.clientWorkFilter,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,view:query.view,filter:query.filter,query:query.query,next:query.showNextPremium?'1':'0',page:String(query.page)}).toString():'';
 const [result,setResult]=useState<{key:string;data?:Page;error?:string}>({key:''});
 const [attempt,retry]=useState(0),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!key)return;const controller=new AbortController();setLoading(true);
  const timer=setTimeout(()=>{void (async()=>{
   try{const response=await fetch('/api/crm?'+key,{cache:'no-store',signal:controller.signal});const data=await response.json() as Page&{error?:string};if(!response.ok)throw Error(data.error||'Не удалось загрузить страницу');if(!controller.signal.aborted)setResult({key:actor+key,data});}
   catch(error){if(!controller.signal.aborted)setResult({key:actor+key,error:error instanceof Error?error.message:'Страница недоступна'});}
   finally{if(!controller.signal.aborted)setLoading(false);}
  })();},150);
  return()=>{clearTimeout(timer);controller.abort();};
 },[key,state,actor,attempt]);
 const current=result.key===actor+key?result:undefined;
 return {enabled:!!key,data:current?.data,error:current?.error,loading:!!key&&(loading||!current),retry:()=>retry(n=>n+1)};
}

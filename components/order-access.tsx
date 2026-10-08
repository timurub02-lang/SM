'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {Employee,Order} from '@/lib/crm';
import {usesOrderLease} from '@/lib/department-orders';

export function OrderAccess({order,employee,onAvailable,children}:{order:Order;employee:Employee;onAvailable:()=>void;children:(readOnly:boolean)=>ReactNode}){
 const orderId=order.id,enabled=usesOrderLease(employee,order);
 const [access,setAccess]=useState<{editable:boolean;holder?:string;until:number;error?:string}>({editable:false,until:0});
 const [now,setNow]=useState(Date.now);
 const onAvailableRef=useRef(onAvailable);onAvailableRef.current=onAvailable;
 const retry=useRef(()=>{});
 useEffect(()=>{
  if(!enabled)return;
  const token=crypto.randomUUID();let stopped=false,pending=false,hadAccess=false,validUntil=0;
  const request=(action:string)=>fetch('/api/order-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,token,action}),keepalive:action==='release',...(action==='acquire'?{signal:AbortSignal.timeout(10000)}:{})});
  const release=()=>{void request('release').catch(()=>{});};
  const acquire=async()=>{
   if(pending||stopped)return;pending=true;
   try{
    const started=Date.now(),response=await request('acquire'),data=await response.json() as {editable:boolean;holder?:string;leaseMs:number;error?:string};
    if(stopped){release();return;}
    if(!response.ok)throw Error(data.error||'Не удалось проверить доступ к заказу');
    setAccess({editable:data.editable,holder:data.holder,until:started+data.leaseMs});
    if(data.editable&&(!hadAccess||Date.now()>=validUntil))onAvailableRef.current();
    validUntil=started+data.leaseMs;
    hadAccess=data.editable;
   }catch{if(!stopped){hadAccess=false;setAccess({editable:false,until:0,error:'Связь прервана. До проверки доступа заказ доступен только для просмотра.'});}}
   finally{pending=false;}
  };
  retry.current=()=>void acquire();void acquire();
  const heartbeat=setInterval(acquire,30000),clock=setInterval(()=>setNow(Date.now()),1000);
  const focus=()=>{setNow(Date.now());void acquire();};
  window.addEventListener('focus',focus);window.addEventListener('pagehide',release);
  return()=>{stopped=true;clearInterval(heartbeat);clearInterval(clock);window.removeEventListener('focus',focus);window.removeEventListener('pagehide',release);release();};
 },[orderId,employee.id,enabled]);
 const readOnly=enabled&&(!access.editable||access.until<=now);
 return <>{readOnly&&<aside className="notice amber" role="status"><div><strong>{access.holder&&!access.editable?`Заказ обрабатывает: ${access.holder}`:'Проверяем доступ к заказу'}</strong><p>{access.error||'Только просмотр. Изменения и действия станут доступны, когда коллега закроет карточку.'}</p><button type="button" className="secondary" onClick={()=>retry.current()}>Проверить доступ</button></div></aside>}{children(readOnly)}</>;
}

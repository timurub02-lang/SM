'use client';
import {useEffect,useState} from 'react';
import {redemptionEditHours} from '@/lib/redemption';

export function useRedemptionReadonly(serverTime?:number){
 const [closed,setClosed]=useState(()=>redemptionEditHours().closed);
 useEffect(()=>{
  const offset=serverTime===undefined?0:serverTime-Date.now();
  let timer:ReturnType<typeof setTimeout>;
  function refresh(){
   clearTimeout(timer);
   const now=new Date(Date.now()+offset),hours=redemptionEditHours(now);
   setClosed(hours.closed);
   timer=setTimeout(refresh,hours.next-now.getTime());
  }
  refresh();
  document.addEventListener('visibilitychange',refresh);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);};
 },[serverTime]);
 return closed;
}

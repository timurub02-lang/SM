'use client';
import {useEffect,useState} from 'react';
import {returnCountdown} from '@/lib/return-countdown';
export function ReturnCountdown({deadline,startsAt}:{deadline:string;startsAt?:string}){
 const [now,setNow]=useState<number|null>(null);
 useEffect(()=>{const update=()=>setNow(Date.now());update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[]);
 return <span className="badge amber">{now===null?'…':returnCountdown(deadline,startsAt,now)}</span>;
}

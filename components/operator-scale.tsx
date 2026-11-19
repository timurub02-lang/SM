"use client";

import {useEffect,useState} from 'react';
import {Minus,Plus} from 'lucide-react';
import {toast} from 'sonner';

export function OperatorScale({actor}:{actor:string}){
 const [percent,setPercent]=useState(100);
 const storageKey=`crm-interface-scale:${actor}`;
 useEffect(()=>{
  try{const saved=Number(localStorage.getItem(storageKey));if(Number.isInteger(saved)&&saved>=50&&saved<=150&&saved%10===0)setPercent(saved);}catch{}
 },[storageKey]);
 useEffect(()=>{
  const style=document.documentElement.style;
  style.setProperty('--crm-user-scale',String(percent/100));
  return()=>{style.removeProperty('--crm-user-scale');};
 },[percent]);
 function change(next:number){
  setPercent(next);
  try{localStorage.setItem(storageKey,String(next));}catch{toast.error('Масштаб изменён, но не удалось сохранить его в этом браузере');}
 }
 return <div className="sidebar-settings-toggle operator-scale"><span>Масштаб</span><div className="operator-scale-buttons"><button type="button" aria-label="Уменьшить масштаб" disabled={percent<=50} onClick={()=>change(percent-10)}><Minus size={16}/></button><button type="button" aria-label={`Масштаб ${percent}%. Вернуть 100%`} title="Вернуть 100%" onClick={()=>change(100)}>{percent}%</button><button type="button" aria-label="Увеличить масштаб" disabled={percent>=150} onClick={()=>change(percent+10)}><Plus size={16}/></button></div></div>;
}

'use client';
import {useEffect,useState} from 'react';
import {Clock} from 'lucide-react';

type Props={delivery:'cdek_courier'|'cdek_pickup';actorId:string;orderId?:string;point?:string;selection?:string;context:string;draftBody?:string;needsAddress?:boolean};
export function OperatorDeliveryEstimate({delivery,actorId,orderId,point,selection,context,draftBody,needsAddress}:Props){
 const query=new URLSearchParams({actorId,delivery});
 if(orderId)query.set('orderId',orderId);
 if(point)query.set('point',point);
 if(selection)query.set('selection',selection);
 const url='/api/cdek/operator-estimate'+(orderId?'?'+query:'');
 const key=JSON.stringify([url,context,draftBody]);
 const [result,setResult]=useState<{key:string;days:string|null}|null>(null);
 useEffect(()=>{
  if(needsAddress||(!orderId&&!draftBody))return;
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   let days:string|null=null;
   try{
    const response=await fetch(url,{method:draftBody?'POST':'GET',...(draftBody?{body:draftBody,headers:{'Content-Type':'application/json'}}:{}),signal:controller.signal,cache:'no-store'});
    if(response.ok){
     const {min,max}=await response.json() as {min:number;max:number};
     if(Number.isInteger(min)&&Number.isInteger(max)&&min>=0&&max>=min){
      const plural=new Intl.PluralRules('ru').select(max);
      const unit=plural==='one'?'рабочий день':plural==='few'?'рабочих дня':'рабочих дней';
      days=(min===max?min:min+'–'+max)+' '+unit;
     }
    }
   }catch{/* A carrier estimate is optional for handoff. */}
   if(!controller.signal.aborted)setResult({key,days});
  },350);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[url,key,draftBody,needsAddress,orderId]);
 const ready=result?.key===key?result:null;
 return <div className="notice operator-delivery-estimate" role="status">
  <Clock size={18} aria-hidden="true"/>
  <div>{delivery==='cdek_pickup'?'Срок доставки до ПВЗ':'Срок доставки до двери'}
   {needsAddress?<strong>Сохраните адрес заказа с индексом для расчёта срока.</strong>
    :ready?.days?<><strong>Ориентировочно {ready.days}</strong><span>С момента приёма посылки СДЭК.</span></>
    :<strong>{ready?'Срок уточнит логист':'Уточняем срок в СДЭК…'}</strong>}
  </div>
 </div>;
}

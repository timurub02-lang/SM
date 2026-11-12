'use client';
import {useEffect,useState} from 'react';
import {money,type Order} from '@/lib/crm';
import {nextOperatorPayout} from '@/lib/premium-calculation';
export function OperatorPremiumPayout({actor,period,preview,orders,rate,readModel}:{actor:string;period?:string;preview:boolean;orders:Order[];rate:number;readModel?:{status:string}}){
 const [amount,setAmount]=useState<number|null>(null),[error,setError]=useState(false),[stale,setStale]=useState(false);
 useEffect(()=>{
  if(preview||!period)return;
  let active=true,pending=false,prepared=false;const controller=new AbortController();setAmount(null);setError(false);setStale(false);
  const refresh=async()=>{if(pending||document.hidden||!navigator.onLine)return;pending=true;
   try{const r=await fetch('/api/premium?actorId='+encodeURIComponent(actor)+'&period='+encodeURIComponent(period),{cache:'no-store',signal:controller.signal}),data=await r.json() as {payroll?:{employeeId:string;payout:number|null}[];readModel?:{status:string}};prepared=!!data.readModel;if(!r.ok)throw Error();if(active){setAmount(data.payroll?.find(r=>r.employeeId===actor)?.payout??null);setStale(!!data.readModel&&data.readModel.status!=='ready');setError(false);}}
   catch{if(active){setAmount(null);setError(true);}}finally{pending=false;}
  };
  void refresh();const timer=setInterval(()=>{if(prepared)void refresh();},5000);
  return()=>{active=false;controller.abort();clearInterval(timer);};
 },[actor,period,preview,orders]);
 if(readModel&&['pending','error'].includes(readModel.status))return <strong>Расчёт выплаты ожидает готовую сводку…</strong>;
 if(preview)return <span><strong>Предполагаемая выплата: {money(nextOperatorPayout(orders,rate))}{readModel?.status==='stale'?' · обновляется':''}</strong><small className="block">Только {rate}% от заказов, без оклада и корректировок</small></span>;
 return <strong>{!period?'Период выплаты ещё не открыт':error?'Не удалось загрузить премию':amount===null?'Расчёт выплаты загружается…':'К выплате за период: '+money(amount)+(stale?' · сводка обновляется':'')}</strong>;
}

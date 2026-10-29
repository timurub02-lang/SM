'use client';
import {useEffect,useState} from 'react';
import {money,type Order} from '@/lib/crm';
import {nextOperatorPayout} from '@/lib/premium-calculation';
export function OperatorPremiumPayout({actor,period,preview,orders,rate}:{actor:string;period?:string;preview:boolean;orders:Order[];rate:number}){
 const [amount,setAmount]=useState<number|null>(null),[error,setError]=useState(false);
 useEffect(()=>{
  if(preview||!period)return;
  let active=true;setAmount(null);setError(false);
  fetch('/api/premium?actorId='+encodeURIComponent(actor)+'&period='+encodeURIComponent(period),{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then((data:{payroll?:{employeeId:string;payout:number|null}[]})=>{if(active)setAmount(data.payroll?.find(r=>r.employeeId===actor)?.payout??null);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[actor,period,preview,orders]);
 if(preview)return <span><strong>Предполагаемая выплата: {money(nextOperatorPayout(orders,rate))}</strong><small className="block">Только {rate}% от заказов, без оклада и корректировок</small></span>;
 return <strong>{!period?'Период выплаты ещё не открыт':error?'Не удалось загрузить премию':amount===null?'Расчёт выплаты загружается…':'К выплате за период: '+money(amount)}</strong>;
}

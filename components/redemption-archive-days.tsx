'use client';
import {useEffect,useState} from 'react';

type Day={day:string;orderId:string;action:string;result:string;author:string;comments:{text:string;author:string;at:string}[]};

export function RedemptionArchiveDays({number}:{number:string}){
 const [days,setDays]=useState<Day[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const request=new AbortController();
  const timer=setTimeout(async()=>{
   try{
    const response=await fetch('/api/redemption?archiveOrder='+encodeURIComponent(number),{signal:request.signal});
    const data=await response.json() as {days:Day[];error?:string};
    if(!response.ok)throw Error(data.error||'Не удалось загрузить архив');
    if(!request.signal.aborted)setDays(data.days);
   }catch(err){if(!request.signal.aborted)setError(err instanceof Error?err.message:'Не удалось загрузить архив');}
  },250);
  return ()=>{clearTimeout(timer);request.abort();};
 },[number]);
 if(error)return <p role="alert">{error}</p>;
 if(!days?.length)return <p role="status">{days?'В доступном архиве этот номер не найден.':'Поиск по всем датам архива…'}</p>;
 return <div className="table-panel redemption-scroll"><table aria-label="Заказ по дням архива"><thead><tr>
  {['Дата архива','Номер заказа','Действие','Результат','Автор','Комментарии за день'].map(label=><th key={label}>{label}</th>)}
 </tr></thead><tbody>{days.map(r=><tr key={r.day+'/'+r.orderId}>
  <td>{r.day.split('-').reverse().join('.')}</td><td>{r.orderId}</td><td>{r.action}</td><td>{r.result}</td><td>{r.author}</td>
  <td>{r.comments.length?r.comments.map((c,i)=><div style={{whiteSpace:'pre-wrap'}} key={i}><small>{new Date(c.at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})} {c.author}</small> · {c.text}</div>):'—'}</td>
 </tr>)}</tbody></table></div>;
}

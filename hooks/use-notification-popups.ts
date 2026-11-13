'use client';
import {useEffect,useRef} from 'react';
import {notificationPopupTab,type NotificationTab} from '@/lib/notification-sections';
import {toast} from 'sonner';
import type {Reminder} from '@/lib/reminders';
import {NotificationPopups,popupNotifications} from '@/lib/notification-popups';

export function useNotificationPopups(actor:string,ready:boolean,tasks:Reminder[],events:Reminder[],openBell:(tab:NotificationTab)=>void){
 const tracker=useRef(new NotificationPopups());
 const popupId=useRef<string|number|undefined>(undefined);
 useEffect(()=>()=>{if(popupId.current!==undefined)toast.dismiss(popupId.current);toast.dismiss(`crm-paid:${actor}`);},[actor]);
 useEffect(()=>{
  if(!ready||!actor)return;
  const freshAll=tracker.current.update(actor,popupNotifications(tasks,events));
  const paid=freshAll.filter(r=>r.kind==='order-paid');
  if(paid.length)toast.success(paid.length===1?paid[0].title:`🎉 Выкуплено заказов: ${paid.length}`,{id:`crm-paid:${actor}`,description:paid.map(r=>r.text).join(' · '),duration:15000,closeButton:true,action:{label:'Открыть колокольчик',onClick:()=>openBell('paid')}});
  const fresh=freshAll.filter(r=>r.kind!=='order-paid'&&!(r.kind==='courier'&&paid.some(p=>p.orderId===r.orderId)));
  if(!fresh.length)return;
  popupId.current=toast.info(fresh.length===1?fresh[0].title:`Новые уведомления · ${fresh.length}`,{
   description:fresh.length===1?fresh[0].text:'Откройте колокольчик, чтобы посмотреть и обработать их.',
   id:`crm-notifications:${actor}`,duration:5000,closeButton:true,
   action:{label:'Открыть колокольчик',onClick:()=>openBell(notificationPopupTab(fresh,tasks))},
  });
 },[actor,ready,tasks,events,openBell]);
}

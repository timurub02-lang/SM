'use client';
import {useEffect,useRef} from 'react';
import {toast} from 'sonner';
import type {Reminder} from '@/lib/reminders';
import {NotificationPopups,popupNotifications} from '@/lib/notification-popups';

export function useNotificationPopups(actor:string,ready:boolean,tasks:Reminder[],events:Reminder[],openBell:(tab:"tasks"|"events")=>void){
 const tracker=useRef(new NotificationPopups());
 const popupId=useRef<string|number|undefined>(undefined);
 useEffect(()=>()=>{if(popupId.current!==undefined)toast.dismiss(popupId.current);},[actor]);
 useEffect(()=>{
  if(!ready||!actor)return;
  const fresh=tracker.current.update(actor,popupNotifications(tasks,events));
  if(!fresh.length)return;
  popupId.current=toast.info(fresh.length===1?fresh[0].title:`Новые уведомления · ${fresh.length}`,{
   description:fresh.length===1?fresh[0].text:'Откройте колокольчик, чтобы посмотреть и обработать их.',
   id:`crm-notifications:${actor}`,duration:5000,closeButton:true,
   action:{label:'Открыть колокольчик',onClick:()=>openBell(fresh.some(r=>tasks.some(t=>t.id===r.id))?"tasks":"events")},
  });
 },[actor,ready,tasks,events,openBell]);
}

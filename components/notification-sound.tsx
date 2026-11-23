'use client';
import {useEffect,useRef,useState} from 'react';
import {Volume2,VolumeX} from 'lucide-react';
import {toast} from 'sonner';
import type {Reminder} from '@/lib/reminders';
import {NotificationPopups} from '@/lib/notification-popups';
import {isIncomingNotification,audibleNotifications} from '@/lib/notification-sections';

function ring(audio:AudioContext,incoming:boolean){
 for(const delay of incoming?[0,0.23]:[0]){
  const tone=audio.createOscillator(),volume=audio.createGain();
  const start=audio.currentTime+delay;
  tone.frequency.value=incoming?780:570;
  volume.gain.setValueAtTime(0.002,start);
  volume.gain.exponentialRampToValueAtTime(incoming?0.28:0.18,start+0.015);
  volume.gain.exponentialRampToValueAtTime(0.002,start+0.16);
  tone.connect(volume).connect(audio.destination);
  tone.start(start);tone.stop(start+0.17);
 }
}

export function NotificationSound({actor,ready,tasks,incoming,refresh}:{actor:string;ready:boolean;tasks:Reminder[];incoming:Reminder[];refresh:()=>Promise<boolean>}){
 const audio=useRef<AudioContext|null>(null),tracker=useRef(new NotificationPopups());
 const preference='crm-notification-sound-enabled:'+actor;
 const [enabled,setEnabled]=useState(false),[running,setRunning]=useState(false);
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 const leader=useRef(false);
 useEffect(()=>{
  const restore=()=>{try{setEnabled(localStorage.getItem(preference)==='1');}catch{}};
  const sync=(event:StorageEvent)=>{if(!event.key||event.key===preference)restore();};
  restore();window.addEventListener('storage',sync);
  return ()=>window.removeEventListener('storage',sync);
 },[preference]);
 function context(){
  if(!audio.current)audio.current=new AudioContext();
  return audio.current;
 }
 useEffect(()=>()=>{void audio.current?.close();audio.current=null;},[]);
 useEffect(()=>{
  if(!enabled){setRunning(false);return;}
  let ctx:AudioContext;
  try{ctx=context();}catch{return;}
  const update=()=>setRunning(ctx.state==='running');
  // A restored preference cannot override the browser's autoplay policy.
  const resume=()=>{if(ctx.state!=='running')void ctx.resume().catch(()=>{});};
  update();ctx.addEventListener('statechange',update);resume();
  document.addEventListener('click',resume,true);document.addEventListener('keydown',resume,true);
  return ()=>{ctx.removeEventListener('statechange',update);document.removeEventListener('click',resume,true);document.removeEventListener('keydown',resume,true);};
 },[enabled]);
 useEffect(()=>{
  if(!enabled||!running||!navigator.locks)return;
  const controller=new AbortController();
  let release:(()=>void)|undefined;
  // Only the tab holding the lock polls in the background and plays alerts.
  void navigator.locks.request('crm-notification-sound:'+actor,{signal:controller.signal},async()=>{
   leader.current=true;
   const timer=setInterval(()=>{if(document.hidden&&navigator.onLine)void refreshRef.current();},30000);
   await new Promise<void>(resolve=>{release=resolve;});
   clearInterval(timer);leader.current=false;
  }).catch(()=>{if(!controller.signal.aborted){setEnabled(false);toast.error('Не удалось включить звук');}});
  return ()=>{controller.abort();release?.();};
 },[enabled,running,actor]);
 useEffect(()=>{
  if(!ready)return;
  const fresh=tracker.current.update(actor,audibleNotifications(tasks,incoming));
  if(!fresh.length||!enabled||!leader.current||audio.current?.state!=='running')return;
  // A newly elected tab can briefly have an older snapshot than the previous leader.
  const key='crm-sounded:'+actor;
  let played=new Set<string>();
  try{played=new Set<string>(JSON.parse(localStorage.getItem(key)||'[]'));}catch{}
  const unheard=fresh.filter(r=>!played.has(r.id));
  if(!unheard.length)return;
  ring(audio.current,unheard.some(r=>isIncomingNotification(r)||!!r.incomingId));
  for(const r of unheard)played.add(r.id);
  try{localStorage.setItem(key,JSON.stringify([...played].slice(-512)));}catch{}
 },[ready,actor,tasks,incoming,enabled]);
 async function toggle(){
  if(enabled){
   try{localStorage.setItem(preference,'0');}catch{}
   setEnabled(false);return;
  }
  try{
   if(!navigator.locks)throw Error();
   const ctx=context();
   await ctx.resume();
   if(ctx.state!=='running')throw Error();
   try{localStorage.setItem(preference,'1');}catch{}
   ring(ctx,false);setEnabled(true);
  }catch{toast.error('Браузер не разрешил включить звук');}
 }
 const label=enabled?'Выключить звук уведомлений':'Включить звук уведомлений';
 const hint=enabled&&!running?'Звук включён. Нажмите в окне CRM, чтобы браузер разрешил воспроизведение.':label;
 return <button type="button" className="secondary" aria-pressed={enabled} aria-label={label} title={hint} onClick={()=>void toggle()}>{enabled?<Volume2 size={18}/>:<VolumeX size={18}/>}</button>;
}

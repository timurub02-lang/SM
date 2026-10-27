'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Phone,PhoneOff,Headphones,Mic,MicOff} from 'lucide-react';
import type {SimpleUser} from 'sip.js/lib/platform/web';
import {setCallMicrophoneMuted} from '@/lib/call-microphone';
export const OKTELL_ACTOR='E-43a21d76-351';
type Config={username:string;authorizationUsername:string;password:string;domain:string;token:string;registered:boolean;error?:string};
type Route='mts'|'beeline';
type PhoneState={routeBusy:boolean;acquire:(route:Route)=>boolean;release:(route:Route)=>void;ready:boolean;busy:boolean;working:boolean;message:string;connect:()=>Promise<void>;disconnect:()=>Promise<void>;call:(id:string,phoneKey?:string)=>Promise<void>;tone:()=>void};
const Context=createContext<PhoneState|null>(null);
export const useOktellPhone=()=>useContext(Context);
export function OktellPhone({children}:{children:ReactNode}){
 const route=useRef<Route|null>(null),[routeBusy,setRouteBusy]=useState(false);
 function acquire(value:Route){if(route.current)return false;route.current=value;setRouteBusy(true);return true;}
 function release(value:Route){if(route.current===value){route.current=null;setRouteBusy(false);}}
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[working,setWorking]=useState(false),[message,setMessage]=useState('Гарнитура не подключена'),[muted,setMuted]=useState(false),[host,setHost]=useState<HTMLElement|null>(null);
 const tab=useRef(''),phone=useRef<SimpleUser|null>(null),audio=useRef<HTMLAudioElement>(null),domain=useRef(''),locked=useRef(false),active=useRef(false),generation=useRef(0);
 async function api(action:string,clientId?:string,phoneKey?:string){
  if(!tab.current)tab.current=crypto.randomUUID();
  const r=await fetch('/api/oktell-phone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,tab:tab.current,...(clientId?{clientId}:{}),...(phoneKey?{phoneKey}:{})}),signal:AbortSignal.timeout(25000),keepalive:action==='disconnect'}),c=await r.json() as Config;
  if(!r.ok)throw Error(c.error||'Нет связи с Oktell');return c;
 }
 async function sync(){try{const c=await api('heartbeat');if(!c.registered&&phone.current){setReady(false);setMessage('Регистрация телефона потеряна. Отключите и подключите гарнитуру заново.');}window.dispatchEvent(new Event('crm-call-updated'));}catch{setReady(false);setMessage('Связь с Oktell потеряна. Подключите гарнитуру заново.');}}
 async function disconnect(){
  generation.current++;setReady(false);setWorking(true);locked.current=true;
  const p=phone.current;phone.current=null;
  try{if(active.current)await p?.hangup();await sync();await p?.unregister();}catch{}finally{try{await p?.disconnect();}catch{}}
  active.current=false;release('mts');setBusy(false);setMuted(false);
  try{await api('disconnect');setMessage('Гарнитура отключена');}catch(e){setMessage(e instanceof Error?e.message:'Не удалось завершить сеанс');}finally{locked.current=false;setWorking(false);}
 }
 async function connect(){
  if(locked.current||phone.current)return;locked.current=true;setWorking(true);const run=++generation.current;
  try{
   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Откройте CRM по HTTPS в Chrome или Edge');
   setMessage('Разрешите доступ к микрофону');const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});stream.getTracks().forEach(t=>t.stop());if(run!==generation.current)return;
   const c=await api('connect');if(run!==generation.current){await api('disconnect');return;}domain.current=c.domain;
   const {SimpleUser}=await import('sip.js/lib/platform/web');
   const p=new SimpleUser(`wss://${location.host}/oktell-phone/ws?token=${encodeURIComponent(c.token)}`,{
    aor:`sip:${c.username}@${c.domain}`,reconnectionAttempts:0,
    userAgentOptions:{authorizationUsername:c.authorizationUsername,authorizationPassword:c.password,logLevel:'error',logConfiguration:false,sessionDescriptionHandlerFactoryOptions:{peerConnectionConfiguration:{iceServers:[]}}},
    media:{constraints:{audio:true,video:false},remote:{audio:audio.current!}},
    delegate:{onRegistered(){if(run===generation.current){setReady(true);setMessage('Гарнитура подключена к Oktell. Звонок ещё не начат.');}},onUnregistered(){setReady(false);},onCallAnswered(){setMessage('Соединение установлено — можно говорить');void audio.current?.play().catch(()=>setMessage('Нажмите «Включить звук»'));void sync();},onCallHangup(){active.current=false;release('mts');setBusy(false);setMuted(false);setMessage('Звонок завершён');void sync();},onServerDisconnect(){if(run===generation.current){setReady(false);active.current=false;release('mts');setBusy(false);setMessage('Соединение прервано. Отключите и подключите гарнитуру заново.');void sync();}}}
   });
   phone.current=p;setMessage('Подключаем телефон к Oktell…');await p.connect();if(run!==generation.current){await p.disconnect();return;}await p.register({requestDelegate:{onReject(r){setReady(false);setMessage(`Oktell отклонил регистрацию (${r.message.statusCode}). Отключите гарнитуру и повторите подключение.`);}}});
  }catch(e){const p=phone.current;phone.current=null;try{await p?.disconnect();await api('disconnect');}catch{}setReady(false);setMessage(e instanceof Error&&e.name==='NotAllowedError'?'Разрешите доступ к микрофону для CRM в настройках браузера.':e instanceof Error&&e.name==='NotFoundError'?'Подключите гарнитуру: микрофон не найден.':e instanceof Error?e.message:'Не удалось подключить гарнитуру');}
  finally{locked.current=false;setWorking(false);}
 }
 async function call(id:string,phoneKey?:string){
  if(locked.current||active.current||!phone.current||!ready||!acquire('mts'))return;locked.current=true;active.current=true;setBusy(true);setMuted(false);setMessage('Подготовка вызова…');
  try{
   const c=await api('call',id,phoneKey) as Config&{callId:string;destination:string};
   await phone.current.call(`sip:${c.destination}@${domain.current}`,{earlyMedia:true,extraHeaders:[`X-CRM-Call-ID: ${c.callId}`]},{requestDelegate:{onProgress(){setMessage('Идёт вызов…');},onReject(r){active.current=false;release('mts');setBusy(false);setMessage(`Звонок не состоялся (ответ ${r.message.statusCode})`);void sync();}}});
   window.dispatchEvent(new Event('crm-call-updated'));
  }catch(e){active.current=false;release('mts');setBusy(false);setMessage(e instanceof Error?e.message:'Не удалось начать вызов');void sync();}finally{locked.current=false;}
 }
 function tone(){const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=.08;osc.frequency.value=440;osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.4);osc.onended=()=>void ctx.close();}
 useEffect(()=>{const timer=setInterval(()=>{if(phone.current)void sync();},15000);return()=>{generation.current++;clearInterval(timer);void phone.current?.disconnect().catch(()=>{});if(tab.current)void api('disconnect').catch(()=>{});};},[]);
 useEffect(()=>{if(!busy){setHost(null);return;}const place=()=>{const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).filter(e=>e.getAttribute('data-state')!=='closed'&&e.getClientRects().length);const d=dialogs.at(-1);setHost(d?.querySelector<HTMLElement>('[data-slot="dialog-header"]')||d||document.body);};place();const observer=new MutationObserver(place);observer.observe(document.body,{childList:true,subtree:true});const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>{observer.disconnect();window.removeEventListener('beforeunload',warn);};},[busy]);
 return <Context.Provider value={{routeBusy,acquire,release,ready,busy,working,message,connect,disconnect,call,tone}}>{children}<audio ref={audio} autoPlay/>{busy&&host&&createPortal(<section className="browser-call-dock" aria-label="Звонок через Oktell"><div className="browser-call-summary"><strong><Phone size={16}/>Звонок через МТС</strong><span role="status">{message}</span></div><div className="browser-call-controls"><button className="secondary" onClick={()=>void audio.current?.play()}>Включить звук</button><button className="secondary" aria-pressed={muted} onClick={()=>{if(phone.current)setMuted(setCallMicrophoneMuted(phone.current,!muted));}}>{muted?<MicOff size={18}/>:<Mic size={18}/>}Микрофон</button><button className="primary phone-hangup" onClick={()=>void phone.current?.hangup().catch(()=>setMessage('Не удалось завершить звонок. Отключите гарнитуру.'))}><PhoneOff size={18}/>Завершить звонок</button></div></section>,host)}</Context.Provider>;
}
export function OktellPhonePanel(){const p=useOktellPhone();if(!p)return null;return <div className="stack" style={{padding:'16px 0'}}><strong style={{display:'flex',alignItems:'center',gap:8}}><Headphones size={18}/> Гарнитура · Oktell</strong><p role="status">{p.message}</p><div className="action-buttons"><button className="primary" disabled={p.working||p.ready||p.routeBusy} onClick={()=>void p.connect()}>Подключить гарнитуру</button><button className="secondary" disabled={p.working||p.routeBusy} onClick={()=>void p.disconnect()}>Отключить</button><button className="secondary" onClick={p.tone}>Проверить наушники</button></div><p className="muted">В Chrome выберите «Разрешить при нахождении на сайте» для микрофона. На этом же адресе CRM разрешение обычно сохраняется. «Проверить наушники» проигрывает короткий сигнал без звонка.</p><p className="muted">Откройте доступную вам карточку клиента. Выберите «МТС» или «Билайн». Вызов начнётся после нажатия кнопки. Для МТС сначала подключите гарнитуру здесь; Билайн подключает её при звонке. Запись звонков через Oktell пока не подключена.</p></div>;}

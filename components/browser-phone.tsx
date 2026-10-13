'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Phone,PhoneOff,Mic,MicOff} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import type {SimpleUser} from 'sip.js/lib/platform/web';

type Target={mode:'test'|'echo'}|{mode:'client';clientId:string}|{mode:'order';orderId:string};
type CallConfig={username:string;password:string;destination:string;label:string;error?:string};
type StatusConfig={configured:boolean;phone:string;callerId:string;error?:string};
const PhoneContext=createContext<{start:(target:Target)=>void;busy:boolean;admin:boolean}|null>(null);
export function BrowserPhone({admin,actorId,children}:{admin:boolean;actorId:string;children:ReactNode}){
 const audio=useRef<HTMLAudioElement>(null),phone=useRef<SimpleUser|null>(null),running=useRef(false),generation=useRef(0);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[title,setTitle]=useState('Звонок из браузера'),[muted,setMuted]=useState(false),[soundBlocked,setSoundBlocked]=useState(false);
 async function finish(text:string){generation.current++;running.current=false;setBusy(false);setMuted(false);setMessage(text);const current=phone.current;phone.current=null;try{await current?.disconnect();}catch{}}
 async function stop(){const current=phone.current;try{await current?.hangup();}catch{}await finish('Звонок завершён');}
 useEffect(()=>()=>{generation.current++;running.current=false;void phone.current?.disconnect().catch(()=>{});phone.current=null;},[actorId]);
 useEffect(()=>{if(!busy)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[busy]);
 async function start(target:Target){
  if(running.current)return;let connecting=false;running.current=true;const run=++generation.current;setBusy(true);setMuted(false);setSoundBlocked(false);setOpen(true);setTitle('Звонок из браузера');setMessage('Подключаем телефонию…');
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Браузер не поддерживает звонки. Откройте CRM по HTTPS в Chrome или Edge.');
   const r=await fetch('/api/telephony',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(target),signal:AbortSignal.timeout(15000)}),c=await r.json() as CallConfig;
   if(!r.ok)throw Error(c.error||'Телефония недоступна');if(run!==generation.current)return;
   setTitle(c.label);setMessage('Разрешите доступ к микрофону…');
   // Ask before opening WSS: Asterisk closes connections without a SIP request after 32 seconds.
   const probe=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
   probe.getTracks().forEach(track=>track.stop());if(run!==generation.current)return;
   connecting=true;const {SimpleUser}=await import('sip.js/lib/platform/web');if(run!==generation.current)return;
   const host=window.location.host;
   const current=new SimpleUser(`wss://${host}/phone/ws`,{
    aor:`sip:${c.username}@${host}`,reconnectionAttempts:0,
    userAgentOptions:{authorizationUsername:c.username,authorizationPassword:c.password,logLevel:'error',logConfiguration:false,sessionDescriptionHandlerFactoryOptions:{peerConnectionConfiguration:{iceServers:[]}}},
    media:{constraints:{audio:true,video:false},remote:{audio:audio.current!}},
    delegate:{onCallAnswered(){if(run===generation.current){setMessage(target.mode==='echo'?'Говорите: вы должны услышать свой голос в ответ.':'Соединение установлено — можно говорить');void audio.current?.play().catch(()=>setSoundBlocked(true));}},onCallHangup(){if(run===generation.current)void finish('Звонок завершён');},onServerDisconnect(error){if(error&&run===generation.current)void finish('Связь с телефонией прервалась. Повторите звонок.');}}
   });
   phone.current=current;await current.connect();if(run!==generation.current){await current.disconnect();return;}
   setMessage('Разрешите доступ к микрофону. Выполняется вызов…');
   await current.call(`sip:${c.destination}@${host}`,undefined,{requestDelegate:{onProgress(){if(run===generation.current)setMessage('Идёт вызов…');},onReject(response){if(run===generation.current)void finish(response.message.statusCode===486?'Линия занята. Повторите позже.':`Звонок не состоялся (ответ ${response.message.statusCode}).`);}}});
  }catch(e){if(run===generation.current)await finish(e instanceof Error&&e.name==='NotAllowedError'?'Разрешите CRM доступ к микрофону в настройках браузера.':e instanceof Error&&e.name==='NotFoundError'?'Микрофон не найден. Подключите гарнитуру и повторите звонок.':e instanceof Error&&e.name==='NotReadableError'?'Не удалось включить микрофон. Проверьте, не занят ли он другой программой.':connecting?'Не удалось подключиться к телефонии. Повторите попытку или сообщите администратору.':e instanceof Error?e.message:'Не удалось начать звонок');}
 }
 return <PhoneContext.Provider value={{start:target=>void start(target),busy,admin}}>{children}<audio ref={audio} autoPlay/><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent showCloseButton={!busy} className="form-dialog browser-phone-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Разговор через микрофон и динамики компьютера. Лучше использовать гарнитуру.</DialogDescription></DialogHeader><p role="status">{message}</p>{busy&&soundBlocked&&<button type="button" className="primary" onClick={()=>{void audio.current?.play().then(()=>setSoundBlocked(false)).catch(()=>setMessage("Браузер блокирует звук. Разрешите воспроизведение для CRM."));}}>Включить звук разговора</button>}<div className="action-buttons">{busy?<><button type="button" className="secondary" onClick={()=>{const p=phone.current;if(!p)return;if(muted)p.unmute();else p.mute();setMuted(!muted);}}>{muted?<MicOff size={18}/>:<Mic size={18}/>} {muted?'Включить микрофон':'Выключить микрофон'}</button><button type="button" className="primary phone-hangup" onClick={()=>void stop()}><PhoneOff size={18}/>Завершить звонок</button></>:<button type="button" className="secondary" onClick={()=>setOpen(false)}>Закрыть</button>}</div></DialogContent></Dialog></PhoneContext.Provider>;
}
export function CallButton({target,disabled=false,children='Позвонить'}:{target:Target;disabled?:boolean;children?:ReactNode}){
 const phone=useContext(PhoneContext);if(!phone)return null;
 return <button type="button" className="secondary browser-call-button" disabled={disabled||phone.busy||!phone.admin} title={phone.admin?'Позвонить через браузер':'Телефония проходит проверку у администратора'} onClick={()=>phone.start(target)}><Phone size={17}/>{children}</button>;
}
export function TelephonySettings(){
 const [config,setConfig]=useState<StatusConfig|null>(null),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;fetch('/api/telephony',{cache:'no-store'}).then(async r=>{const c=await r.json() as StatusConfig;if(!r.ok)throw Error(c.error);if(!cancelled)setConfig(c);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
 return <div className="stack"><p>Звонки прямо из CRM через новую АТС и Билайн.</p><p>Транк: 25 одновременных вызовов, до 5 новых вызовов в секунду.</p><p className="notice">Тестовый запуск: один разговор, только на согласованный номер. Звонки другим клиентам пока отключены.</p>{error&&<p role="alert">{error}</p>}{!config&&!error&&<p>Проверка подключения…</p>}{config&&<>{!config.configured?<p>Подключение ещё готовится.</p>:<><p>Тестовый номер: +{config.phone}<br/>Исходящий номер: +{config.callerId}</p><div className="action-buttons"><CallButton target={{mode:'echo'}}>Проверить микрофон</CallButton><CallButton target={{mode:'test'}}>Тестовый звонок</CallButton></div><p className="muted">Сначала проверьте эхо в гарнитуре, затем позвоните на тестовый телефон и проверьте слышимость в обе стороны. Максимальная длительность теста — 3 минуты.</p></>}</>}</div>;
}

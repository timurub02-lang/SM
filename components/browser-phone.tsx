'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Phone,PhoneOff,Mic,MicOff} from 'lucide-react';
import {createPortal} from 'react-dom';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {toast} from 'sonner';
import {PhoneNumbers} from './phone-numbers';
import {OktellPhone,useOktellPhone,OKTELL_ACTOR} from './oktell-phone';
import {setCallMicrophoneMuted} from '@/lib/call-microphone';
import type {SimpleUser} from 'sip.js/lib/platform/web';

type Target={mode:'incoming';incomingId:string}|{mode:'test'|'echo'}|{mode:'client';clientId:string;phoneKey?:string}|{mode:'order';orderId:string;phoneKey?:string};
type CallConfig={callId:string;username:string;password:string;destination:string;label:string;error?:string};
type StatusConfig={configured:boolean;phone:string;callerId:string;error?:string};
const PhoneContext=createContext<{start:(target:Target,onCompleted?:()=>void)=>void;busy:boolean;enabled:boolean}|null>(null);
function LegacyBrowserPhone({admin,actorId,children}:{admin:boolean;actorId:string;children:ReactNode}){
 const native=useOktellPhone();
 const [enabled,setEnabled]=useState(false);
 useEffect(()=>{let active=true;setEnabled(false);fetch('/api/telephony',{cache:'no-store'}).then(async r=>{const c=await r.json() as StatusConfig;if(active)setEnabled(r.ok&&!!c.configured);}).catch(()=>{});return()=>{active=false;};},[actorId]);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[title,setTitle]=useState('Звонок из браузера'),[muted,setMuted]=useState(false),[soundBlocked,setSoundBlocked]=useState(false);
 const [dockHost,setDockHost]=useState<HTMLElement|null>(null),[connectedAt,setConnectedAt]=useState<number|null>(null),[elapsed,setElapsed]=useState(0);
 useEffect(()=>{
  if(!open){setDockHost(null);return;}
  // Keep controls inside Radix's active focus scope, outside the card's scrolling body.
  const place=()=>{const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).filter(el=>el.getAttribute('data-state')!=="closed"&&el.getClientRects().length);const dialog=dialogs.at(-1);setDockHost(dialog?.matches('.client-detail-dialog.has-header-call')?dialog.querySelector<HTMLElement>('[data-slot="dialog-header"]')||dialog:dialog||document.body);};
  place();const observer=new MutationObserver(place);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();
 },[open]);
 useEffect(()=>{if(!dockHost)return;dockHost.classList.add('has-call-dock');return()=>dockHost.classList.remove('has-call-dock');},[dockHost]);
 useEffect(()=>{if(!busy||connectedAt===null)return;const tick=()=>setElapsed(Math.floor((Date.now()-connectedAt)/1000));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[busy,connectedAt]);
 const attempt=useRef<{id:string;answered:boolean;onCompleted?:()=>void}|null>(null);
 async function report(id:string,status:string,detail=''){try{await fetch('/api/telephony',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status,detail}),keepalive:true});}finally{window.dispatchEvent(new Event('crm-call-updated'));}}
 const audio=useRef<HTMLAudioElement>(null),phone=useRef<SimpleUser|null>(null),running=useRef(false),generation=useRef(0);

 async function finish(text:string,result='unknown'){const call=attempt.current;attempt.current=null;if(call)void report(call.id,result,text).catch(()=>{});generation.current++;running.current=false;setBusy(false);setMuted(false);setMessage(text);if(text==='Звонок завершён')setOpen(false);const current=phone.current;phone.current=null;try{await current?.disconnect();}catch{}native?.release('beeline');if(call?.answered)call.onCompleted?.();}
 async function stop(){const call=attempt.current;if(call)void report(call.id,call.answered?'unknown':'cancelled',call.answered?'Ожидаем итог и запись от АТС.':'Звонок завершён сотрудником до соединения.').catch(()=>{});const current=phone.current;try{await current?.hangup();}catch{}await finish('Звонок завершён');}
 useEffect(()=>()=>{generation.current++;running.current=false;void phone.current?.disconnect().catch(()=>{});phone.current=null;native?.release('beeline');},[actorId]);
 useEffect(()=>{if(!busy)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[busy]);
 async function start(target:Target,onCompleted?:()=>void){
  if(running.current||(native&&!native.acquire('beeline')))return;let connecting=false;running.current=true;const run=++generation.current;setBusy(true);setConnectedAt(null);setElapsed(0);setMuted(false);setSoundBlocked(false);setOpen(true);setTitle('Звонок из браузера');setMessage('Подключаем телефонию…');
  try{
   const r=await fetch('/api/telephony',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(target),signal:AbortSignal.timeout(15000)}),c=await r.json() as CallConfig;
   if(!r.ok)throw Error(c.error||'Телефония недоступна');if(run!==generation.current){void report(c.callId,'cancelled','Отменён во время подготовки').catch(()=>{});return;}attempt.current={id:c.callId,answered:false,onCompleted};window.dispatchEvent(new Event('crm-call-updated'));
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Браузер не поддерживает звонки. Откройте CRM по HTTPS в Chrome или Edge.');
   setTitle(target.mode==='order'?`Звонок по заказу ${target.orderId}`:c.label);setMessage('Разрешите доступ к микрофону…');
   // Ask before opening WSS: Asterisk closes connections without a SIP request after 32 seconds.
   const probe=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
   probe.getTracks().forEach(track=>track.stop());if(run!==generation.current)return;
   connecting=true;const {SimpleUser}=await import('sip.js/lib/platform/web');if(run!==generation.current)return;
   const host=window.location.host;
   const current=new SimpleUser(`wss://${host}/phone/ws`,{
    aor:`sip:${c.username}@${host}`,reconnectionAttempts:0,
    userAgentOptions:{authorizationUsername:c.username,authorizationPassword:c.password,logLevel:'error',logConfiguration:false,sessionDescriptionHandlerFactoryOptions:{peerConnectionConfiguration:{iceServers:[]}}},
    media:{constraints:{audio:true,video:false},remote:{audio:audio.current!}},
    delegate:{onCallAnswered(){if(run===generation.current){setConnectedAt(Date.now());if(attempt.current)attempt.current.answered=true;void report(c.callId,'connected').catch(()=>{});setMessage(target.mode==='echo'?'Говорите: вы должны услышать свой голос в ответ.':'Соединение установлено — можно говорить');void audio.current?.play().catch(()=>setSoundBlocked(true));}},onCallHangup(){if(run===generation.current)void finish('Звонок завершён');},onServerDisconnect(error){if(error&&run===generation.current)void finish('Связь с телефонией прервалась. Повторите звонок.');}}
   });
   phone.current=current;await current.connect();if(run!==generation.current){await current.disconnect();return;}
   setMessage('Выполняется вызов…');void report(c.callId,'dialing').catch(()=>{});
   await current.call(`sip:${c.destination}@${host}`,{earlyMedia:true,extraHeaders:[`X-CRM-Call-ID: ${c.callId}`]},{requestDelegate:{onProgress(){if(run===generation.current)setMessage('Идёт вызов…');},onReject(response){void report(c.callId,response.message.statusCode===486?'busy':response.message.statusCode===480?'no_answer':'failed',`Ответ телефонии ${response.message.statusCode}`).catch(()=>{});if(run===generation.current)void finish(response.message.statusCode===486?'Линия занята. Повторите позже.':`Звонок не состоялся (ответ ${response.message.statusCode}).`);}}});
  }catch(e){if(run===generation.current)await finish(e instanceof Error&&e.name==='NotAllowedError'?'Разрешите CRM доступ к микрофону в настройках браузера.':e instanceof Error&&e.name==='NotFoundError'?'Микрофон не найден. Подключите гарнитуру и повторите звонок.':e instanceof Error&&e.name==='NotReadableError'?'Не удалось включить микрофон. Проверьте, не занят ли он другой программой.':connecting?'Не удалось подключиться к телефонии. Повторите попытку или сообщите администратору.':e instanceof Error?e.message:'Не удалось начать звонок','failed');}
 }
 return <PhoneContext.Provider value={{start:(target,onCompleted)=>void start(target,onCompleted),busy:busy||!!native?.routeBusy,enabled}}>{children}<audio ref={audio} autoPlay/>{open&&dockHost&&createPortal(<section className="browser-call-dock" aria-label="Управление звонком"><div className="browser-call-summary"><strong><Phone size={16}/>{title}{connectedAt!==null&&<time aria-label="Длительность разговора">{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</time>}</strong><span role="status">{message}</span></div><div className="browser-call-controls">{busy&&soundBlocked&&<button type="button" className="secondary" onClick={()=>{void audio.current?.play().then(()=>setSoundBlocked(false)).catch(()=>setMessage("Браузер блокирует звук. Разрешите воспроизведение для CRM."));}}>Включить звук</button>}{busy?<><button type="button" className="secondary" aria-label={muted?'Включить микрофон':'Выключить микрофон'} aria-pressed={muted} disabled={connectedAt===null} onClick={()=>{const p=phone.current;if(!p)return;try{setMuted(setCallMicrophoneMuted(p,!muted));}catch{toast.error('Не удалось переключить микрофон. Попробуйте ещё раз.');}}}>{muted?<MicOff size={18}/>:<Mic size={18}/>}<span>{muted?'Включить микрофон':'Выключить микрофон'}</span></button><button type="button" className="primary phone-hangup" onClick={()=>void stop()}><PhoneOff size={18}/><span>Завершить звонок</span></button></>:<button type="button" className="secondary" onClick={()=>setOpen(false)}>Скрыть звонок</button>}</div></section>,dockHost)}</PhoneContext.Provider>;
}
function LegacyCallButton({target,disabled=false,children='Позвонить',className='',icon=<Phone size={17}/>,route='beeline',onCompleted}:{target:Target;onCompleted?:()=>void;disabled?:boolean;children?:ReactNode;className?:string;icon?:ReactNode;route?:'beeline'|'mts'}){
 const legacy=useContext(PhoneContext),native=useOktellPhone();
 const phone=route==='mts'?{enabled:!!native?.ready&&!native?.working,busy:!!native?.routeBusy,start:(target:Target,_onCompleted?:()=>void)=>{if(target.mode==='client')void native?.call(target.clientId,target.phoneKey);}}:legacy;
 const [choices,setChoices]=useState<{key:string;label:string}[]>([]),[loading,setLoading]=useState(false);
 if(!phone)return null;
 async function choose(){
  if(!phone||loading)return;
  if(target.mode!=='client'&&target.mode!=='order'){phone.start(target,onCompleted);return;}
  setLoading(true);
  try{const query=new URLSearchParams(target),r=await fetch('/api/telephony?'+query,{cache:'no-store'}),data=await r.json() as {phones:{key:string;label:string}[];error?:string};if(!r.ok)throw Error(data.error||'Не удалось получить номера');if(!data.phones.length)throw Error('У клиента нет корректного номера телефона');if(data.phones.length===1)phone.start({...target,phoneKey:data.phones[0].key},onCompleted);else setChoices(data.phones);}catch(e){toast.error(e instanceof Error?e.message:'Не удалось получить номера');}finally{setLoading(false);}
 }
 return <><button type="button" className={`secondary browser-call-button ${className}`} disabled={disabled||loading||phone.busy||!phone.enabled} title={route==='mts'?(!native?'МТС ещё не подключён для вашей учётной записи':!native.ready?'Подключите гарнитуру в разделе «Звонки»':'Позвонить через МТС'):phone.enabled?'Позвонить через Билайн':'Телефония недоступна'} onClick={()=>void choose()}>{icon}{loading?'Загрузка…':children}</button><Dialog open={choices.length>0} onOpenChange={open=>{if(!open)setChoices([]);}}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>На какой номер позвонить?</DialogTitle><DialogDescription>Выберите номер клиента — после нажатия начнётся звонок.</DialogDescription></DialogHeader><div className="stack">{choices.map(choice=><button type="button" className="secondary" key={choice.key} disabled={disabled||phone.busy} onClick={()=>{setChoices([]);if(target.mode==='client'||target.mode==='order')phone.start({...target,phoneKey:choice.key},onCompleted);}}><Phone size={17}/>{choice.label}</button>)}</div></DialogContent></Dialog></>;

}
export function TelephonySettings(){
 const [config,setConfig]=useState<StatusConfig|null>(null),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;fetch('/api/telephony',{cache:'no-store'}).then(async r=>{const c=await r.json() as StatusConfig;if(!r.ok)throw Error(c.error);if(!cancelled)setConfig(c);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
 return <div className="stack"><p>Звонки прямо из CRM через новую АТС и Билайн.</p><p>Транк: 25 одновременных вызовов, до 5 новых вызовов в секунду.</p><p className="notice">Рабочий режим: сотрудники звонят клиентам из доступных им карточек. До 25 одновременных звонков. Максимальная длительность разговора — 30 минут.</p>{error&&<p role="alert">{error}</p>}{!config&&!error&&<p>Проверка подключения…</p>}{config&&<>{!config.configured?<p>Подключение ещё готовится.</p>:<><p>Тестовый номер: +{config.phone}</p><div className="action-buttons"><CallButton target={{mode:'echo'}}>Проверить микрофон</CallButton><CallButton target={{mode:'test'}}>Тестовый звонок</CallButton></div><p className="muted">Сначала проверьте эхо в гарнитуре, затем позвоните на тестовый телефон и проверьте слышимость в обе стороны. Проверка эха длится не более 3 минут. Разговоры записываются.</p></>}</>}<PhoneNumbers/></div>;
}

export function BrowserPhone(props:{admin:boolean;actorId:string;children:ReactNode}){return props.actorId===OKTELL_ACTOR?<OktellPhone><LegacyBrowserPhone {...props}/></OktellPhone>:<LegacyBrowserPhone {...props}/>;}
export function CallButton(props:Parameters<typeof LegacyCallButton>[0]){if(props.target.mode==='client')return <div className={`call-route-buttons ${props.className||''}`} role="group" aria-label="Выбор линии для звонка"><LegacyCallButton {...props} route="mts" className="call-route-mts" icon={<img src="/telephony/mts.svg" width={28} height={28} alt="" aria-hidden="true"/>}>МТС</LegacyCallButton><LegacyCallButton {...props} route="beeline" className="call-route-beeline" icon={<Phone size={17}/>}>Позвонить</LegacyCallButton></div>;return <LegacyCallButton {...props}/>;}

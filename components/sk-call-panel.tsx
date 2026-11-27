'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronUp,Minus,Phone,X} from 'lucide-react';
import type {WidgetTarget,SkCallUpdate} from '@/lib/sk-widget-calls';

export type SkConfig={origin:string;skUserId:string};
export type SkRequest={target:WidgetTarget;onPrepared?:(id:string)=>void;onCompleted?:()=>void};
const channel='sm-sk-phone-v1';
// Only the restore button follows the frontmost card's focus scope. Moving the iframe would reload the phone.
function MinimizedPhone({status,restore}:{status:string;restore:()=>void}){
  const [host,setHost]=useState<HTMLElement|null>(null);
  const button=useRef<HTMLButtonElement>(null);
  const focusOnMinimize=useRef(true);
  useLayoutEffect(()=>{
    const place=()=>{
      const dialogs=document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"][data-state="open"],[data-slot="alert-dialog-content"][data-state="open"]');
      setHost(Array.from(dialogs).at(-1)||document.body);
    };
    place();
    const observer=new MutationObserver(place);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state']});
    return ()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    // The top layer keeps the button at the viewport edge even inside a transformed, scrollable card.
    if(!button.current)return;
    button.current.showPopover?.();
    if(focusOnMinimize.current){
      button.current.focus({preventScroll:true});
      focusOnMinimize.current=false;
    }
  },[host]);
  return host&&createPortal(<button ref={button} popover="manual" type="button" className="sk-phone-tab"
    aria-expanded={false} aria-label={`Развернуть телефон. ${status}`} onClick={restore}>
    <Phone size={18} aria-hidden="true"/><span><strong>Телефон</strong><small role="status">{status}</small></span><ChevronUp size={17} aria-hidden="true"/>
  </button>,host);
}
async function record(id:string,event:SkCallUpdate){
  const r=await fetch('/api/telephony',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'skWidgetStatus',id,event}),keepalive:true});
  if(!r.ok)throw Error('Не удалось обновить историю звонка.');
  window.dispatchEvent(new Event('crm-call-updated'));
}
export function SkCallPanel({config,request,close}:{config:SkConfig;request:SkRequest;close:()=>void}){
  const frame=useRef<HTMLIFrameElement>(null),alive=useRef(false),attempt=useRef(''),final=useRef(false),completed=useRef(false);
  const [choices,setChoices]=useState<{key:string;label:string}[]>([]),[key,setKey]=useState('');
  const [ready,setReady]=useState(false),[used,setUsed]=useState(false),[status,setStatus]=useState('Загрузка панели Скорозвона…'),[error,setError]=useState('');
  const [progress,setProgress]=useState('');
  const [minimized,setMinimized]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{
    const panel=dialog.current;
    if(!panel||minimized)return;
    panel.showModal();
    // Escape belongs to the phone while expanded, including when a CRM card has its own Escape listener.
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setMinimized(true);}
    };
    window.addEventListener('keydown',onKey,true);
    return ()=>{window.removeEventListener('keydown',onKey,true);panel.close();};
  },[minimized]);
  useEffect(()=>{
    alive.current=true;
    const abort=new AbortController();
    const timeout=window.setTimeout(()=>setStatus('Панель не ответила. Проверьте подключение или закройте окно.'),25000);
    void (async()=>{
      try{
        const r=await fetch('/api/telephony?'+new URLSearchParams({...request.target}),{cache:'no-store',signal:abort.signal});
        const data=await r.json() as {phones?:{key:string;label:string}[];error?:string};
        if(!r.ok||!data.phones?.length)throw Error(data.error||'У клиента нет доступного номера.');
        if(alive.current){setChoices(data.phones);setKey(data.phones[0].key);}
      }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Не удалось получить номера.');}
    })();
    const receive=(e:MessageEvent)=>{
      const data=e.data;
      if(e.origin!==config.origin||e.source!==frame.current?.contentWindow||data?.channel!==channel)return;
      if(data.type==='state'){
        window.clearTimeout(timeout);
        setReady(data.ready===true);setStatus(String(data.message||'').slice(0,180));return;
      }
      if(data.type!=='event'||!attempt.current||data.attempt!==attempt.current||final.current)return;
      const event=data.event as SkCallUpdate;
      if(!['connected','ended','answered-end','failed','unknown'].includes(event))return;
      if(event!=='connected')final.current=true;
      if(event==='answered-end')completed.current=true;
      setProgress(event==='connected'?'Идёт разговор':event==='answered-end'?'Разговор завершён':event==='ended'?'Вызов завершён':event==='failed'?'Скорозвон отклонил набор':'Проверьте состояние вызова');
      void record(attempt.current.replaceAll('-',''),event).catch(()=>{if(alive.current)setError('Не удалось обновить историю звонка.');});
    };
    const warn=(e:BeforeUnloadEvent)=>{if(attempt.current&&!final.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener('message',receive);window.addEventListener('beforeunload',warn);
    return ()=>{
      alive.current=false;abort.abort();window.clearTimeout(timeout);window.removeEventListener('message',receive);window.removeEventListener('beforeunload',warn);
      if(attempt.current&&!final.current)void record(attempt.current.replaceAll('-',''),'unknown').catch(()=>{});
    };
  },[config.origin,request]);
  async function dial(){
    if(attempt.current||!ready||!key||!frame.current?.contentWindow)return;
    const id=crypto.randomUUID();attempt.current=id;setUsed(true);setProgress('Готовим вызов…');
    try{
      const r=await fetch('/api/telephony',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request.target,phoneKey:key,action:'skWidgetDial',skUserId:config.skUserId,attemptId:id}),signal:AbortSignal.timeout(15000)});
      const data=await r.json() as {id:string;number:string;error?:string};
      if(!r.ok||data.id!==id.replaceAll('-','')||!/^\+7\d{10}$/.test(data.number))throw Error(data.error||'Не удалось подготовить звонок.');
      if(!alive.current||!frame.current?.contentWindow){await record(data.id,'unknown');return;}
      request.onPrepared?.(data.id);
      frame.current.contentWindow.postMessage({channel,type:'dial',attempt:id,number:data.number},config.origin);
      setProgress('Команда набора передана');
    }catch(e){
      final.current=true;
      void record(id.replaceAll('-',''),'unknown').catch(()=>{});
      if(alive.current){setError(e instanceof Error?e.message:'Не удалось передать команду. Проверьте историю перед повтором.');setProgress('');}
    }
  }
  function dismiss(){
    if(attempt.current&&!final.current&&!window.confirm('Закрыть телефонную панель? Текущий вызов может прерваться.'))return;
    close();if(completed.current)request.onCompleted?.();
  }
  const summary=progress||(error?'Проверьте панель':ready?'Готов к звонку':status);
  return <>{createPortal(<dialog ref={dialog} className="sk-call-panel" aria-label="Телефон"
    onCancel={e=>{e.preventDefault();setMinimized(true);}}
    onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
    <header className="sk-phone-heading"><Phone size={20} aria-hidden="true"/><h2>Телефон</h2>
      <button type="button" aria-label="Свернуть телефон" title="Свернуть телефон" onClick={()=>setMinimized(true)}><Minus size={18}/></button>
      <button type="button" aria-label="Закрыть телефон" title="Закрыть телефон" onClick={dismiss}><X size={18}/></button>
    </header>
    <div className="sk-phone-body">
    {choices.length>1&&<label className="field">Телефон клиента<select value={key} disabled={used} onChange={e=>setKey(e.target.value)}>{choices.map(choice=><option value={choice.key} key={choice.key}>{choice.label.replace(/ · \+\d+$/,'')}</option>)}</select></label>}
    <p role="status">{progress||status}{completed.current&&'. Сохраните результат в панели Скорозвона.'}</p>{error&&<p role="alert">{error}</p>}
    <iframe ref={frame} src={config.origin+'/sk-phone/index.html'} title="Телефонная панель Скорозвона" allow="microphone; autoplay" sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="origin" onLoad={()=>{
      setReady(false);frame.current?.contentWindow?.postMessage({channel,type:'init',operatorId:config.skUserId},config.origin);
    }}/>
    <div className="action-buttons"><button type="button" className="primary" disabled={!ready||!key||used||!!error} onClick={()=>void dial()}>Позвонить</button></div>
    </div>
  </dialog>,document.body)}
  {minimized&&<MinimizedPhone status={summary} restore={()=>setMinimized(false)}/>}</>;
}

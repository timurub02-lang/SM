'use client';
import {useEffect,useRef,useState} from 'react';
import {mainSmsRequest} from '@/lib/mainsms-client';
type Template={id:string;name:string;text:string};
export function MainSmsSettings({actorId}:{actorId:string}){
 const [config,setConfig]=useState({project:'',sender:'',apiKey:'',templates:[] as Template[]}),[revision,setRevision]=useState(''),[configured,setConfigured]=useState(false),[busy,setBusy]=useState(true),[message,setMessage]=useState('');
 useEffect(()=>{mainSmsRequest(undefined,{actorId}).then(d=>{setConfig({project:d.project||'',sender:d.sender||'',apiKey:'',templates:d.templates});setRevision(d.revision);setConfigured(d.configured);}).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));},[actorId]);
 async function action(kind:string){setBusy(true);setMessage('');try{const d=await mainSmsRequest({action:kind,actorId,config,revision});if(d.revision){setRevision(d.revision);setConfigured(true);setConfig(c=>({...c,apiKey:''}));}setMessage(d.message);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <div className="stack"><p>SMS клиенту из карточки заказа. Укажите проект и API-ключ из кабинета MainSMS. Используйте согласованное имя отправителя или оставьте его пустым.</p><fieldset disabled={busy} className="stack order-fields"><div className="form-grid">{(['project','sender','apiKey'] as const).map((key,i)=><label className="field" key={key}><span>{['Проект','Имя отправителя','API-ключ'][i]}</span><input type={key==='apiKey'?'password':'text'} autoComplete="off" value={config[key]} placeholder={key==='apiKey'&&configured?'Сохранён — оставьте пустым, чтобы не менять':''} onChange={e=>setConfig({...config,[key]:e.target.value})}/></label>)}</div><h3>Шаблоны SMS</h3><p className="muted">{'{client} — имя клиента, {order} — номер заказа. Эти шаблоны хранятся в CRM.'}</p>{config.templates.map((t,i)=><section className="settings-card" style={{padding:16}} key={t.id}><label className="field"><span>Название шаблона</span><input value={t.name} onChange={e=>setConfig({...config,templates:config.templates.map((x,n)=>n===i?{...x,name:e.target.value}:x)})}/></label><label className="field"><span>Текст SMS</span><textarea rows={3} maxLength={1000} value={t.text} onChange={e=>setConfig({...config,templates:config.templates.map((x,n)=>n===i?{...x,text:e.target.value}:x)})}/></label><button type="button" className="text-button" onClick={()=>setConfig({...config,templates:config.templates.filter(x=>x.id!==t.id)})}>Убрать шаблон</button></section>)}<button className="secondary" onClick={()=>setConfig({...config,templates:[...config.templates,{id:crypto.randomUUID(),name:'',text:''}]})}>Добавить шаблон</button><div className="action-buttons"><button className="primary" onClick={()=>action('save')}>Сохранить настройки и шаблоны</button><button className="secondary" disabled={!configured} onClick={()=>action('check')}>Проверить подключение</button></div></fieldset><p role="status">{busy?'Загрузка…':message}</p></div>;
}
type SmsOrderData={error?:string;templates:Template[];configured:boolean;history:SmsHistoryEntry[];deliveryWarning?:string};
type SmsHistoryEntry={id:string;text:string;sender:string;at:number;state:'sending'|'accepted'|'unknown'|'rejected';actor:string;delivery?:{status:string;label:string;failed:boolean};deliveryCheckedAt?:number;reason?:string;messageIds?:number[]};
const smsStates={rejected:'Не отправлено · MainSMS отклонил запрос',sending:'Отправка начата · результат пока неизвестен',accepted:'Принято MainSMS к отправке',unknown:'Результат неизвестен · проверьте кабинет MainSMS перед повторной отправкой'};
export function OrderSms({actorId,orderId,testOnly}:{actorId:string;orderId:string;testOnly?:boolean}){
 const [templates,setTemplates]=useState<Template[]>([]),[selected,setSelected]=useState(''),[text,setText]=useState('');
 const [preview,setPreview]=useState<any>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [message,setMessage]=useState(''),[historyError,setHistoryError]=useState(''),[configured,setConfigured]=useState(false);
 const [history,setHistory]=useState<SmsHistoryEntry[]>([]);
 const historyRequest=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();historyRequest.current=controller;
  setLoading(true);setSelected('');setText('');setPreview(null);setMessage('');setHistory([]);setHistoryError('');
  mainSmsRequest<SmsOrderData>(undefined,{actorId,orderId},controller.signal).then(d=>{
   setTemplates(d.templates);setConfigured(d.configured);setHistory(d.history);setHistoryError(d.deliveryWarning||'');
  }).catch(e=>{if(!controller.signal.aborted)setHistoryError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>{controller.abort();historyRequest.current?.abort();};
 },[actorId,orderId]);
 async function reloadHistory(){
  historyRequest.current?.abort();
  const controller=new AbortController();historyRequest.current=controller;
  try{
   const d=await mainSmsRequest<SmsOrderData>(undefined,{actorId,orderId},controller.signal);
   if(controller.signal.aborted)return;
   setTemplates(d.templates);setConfigured(d.configured);setHistory(d.history);setHistoryError(d.deliveryWarning||'');
  }catch(e){if(!controller.signal.aborted)setHistoryError((e as Error).message);}
 }
 async function action(kind:'preview'|'send'){
  setBusy(true);setMessage('');
  try{
   const d=await mainSmsRequest({action:kind,actorId,orderId,templateId:selected,text,token:preview?.token});
   if(kind==='preview')setPreview(d);
   else{setPreview(null);setMessage(d.message);window.dispatchEvent(new Event('crm-refresh'));}
  }catch(e){setMessage((e as Error).message);if(kind==='send')setPreview(null);}
  finally{
   setBusy(false);
   if(kind==='send')void reloadHistory();
  }
 }
 return <section className="stack">
  <h3>SMS клиенту</h3>
  {loading?<p role="status">Загрузка SMS…</p>:testOnly?<p>Отправка SMS тестовым клиентам отключена.</p>:!configured?<p>Администратору нужно подключить MainSMS в настройках интеграций.</p>:<>
   {templates.length>0&&<label className="field"><span>Сообщение</span><select disabled={busy} value={selected} onChange={e=>{setSelected(e.target.value);setPreview(null);}}>
    <option value="">Своё сообщение</option>{templates.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}
   </select></label>}
   {!selected&&<label className="field"><span>Текст SMS</span><textarea rows={4} maxLength={1000} disabled={busy} value={text} placeholder="Введите сообщение клиенту" onChange={e=>{setText(e.target.value);setPreview(null);}}/><small className="muted">{text.length} / 1000 символов</small></label>}
   <button className="secondary" disabled={busy||(!selected&&!text.trim())} onClick={()=>action('preview')}>Предпросмотр SMS</button>
   {preview&&<div className="stack notice" style={{display:'grid'}}>
    <b>{preview.recipient}</b><span>Отправитель · {preview.sender}</span><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{preview.text}</p>
    <small>Отправка платная, по тарифу MainSMS. Нажатие отправит это сообщение клиенту.</small>
    <button className="primary" disabled={busy} onClick={()=>action('send')}>Отправить SMS</button>
   </div>}
  </>}
  <p role="status">{busy?'Обработка…':message}</p>
  <div className="action-buttons"><h3>История SMS</h3><button type="button" className="secondary" disabled={busy||loading} onClick={()=>void reloadHistory()}>Обновить историю SMS</button></div>
  {historyError&&<p role="alert">{historyError}</p>}
  {!loading&&!historyError&&!history.length&&<p className="muted">SMS по этому заказу ещё не отправлялись.</p>}
  {history.map(item=><article key={item.id} className="settings-card stack" style={{padding:16}}>
   <div><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</time> · {item.actor}</div>
   <strong>{item.delivery?.label||smsStates[item.state]}</strong>{(item.delivery?.failed||item.state==='rejected')&&<p>{item.reason||'MainSMS не передал причину отказа через API. Подробности доступны в кабинете MainSMS.'}</p>}{item.deliveryCheckedAt&&<small className="muted">Статус проверен: {new Date(item.deliveryCheckedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</small>}{item.messageIds?.map(id=><a key={id} href={'https://mainsms.ru/office/messages/'+id} target="_blank" rel="noopener noreferrer">Подробности MainSMS · {id}</a>)}<small>Отправитель · {item.sender}</small>
   <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.text}</p>
  </article>)}
 </section>;
}

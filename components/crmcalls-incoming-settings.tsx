"use client";
import {useCallback,useEffect,useState} from 'react';

type Config={enabled:boolean;scenarioId:string;resultId:string;additionalScenarios?:{scenarioId:string;resultId:string}[];operators:{userId:string;employeeId:string}[];revision:string};
type Dashboard={config:Config|null;staff:{id:string;name:string;login:string}[];transfers:{call_id:string;state:string;reason:string;received_at:string;order_id:string;user_id:string;user_name:string;name:string}[]};
const empty:Config={enabled:false,scenarioId:'',resultId:'',additionalScenarios:[],operators:[],revision:''};
export function CRMCallsIncomingSettings({actorId}:{actorId:string}){
 const [data,setData]=useState<Dashboard|null>(null),[form,setForm]=useState<Config>(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[secret,setSecret]=useState('');
 const [directory,setDirectory]=useState<{users:{id:string;name:string;status:string}[];scenarios:{id:string;name:string}[]}>({users:[],scenarios:[]}),[results,setResults]=useState<Record<string,{id:string;name:string}[]>>({});
 const endpoint='/api/crmcalls?actorId='+encodeURIComponent(actorId);
 const request=useCallback(async(body?:unknown)=>{
  const response=await fetch(endpoint+(body?'':'&incoming=1'),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const result:any=await response.json();if(!response.ok)throw Error(result.error||'Не удалось загрузить приём карточек');return result;
 },[endpoint]);
 const load=useCallback(async()=>{try{const result=await request();setData(result);setForm(result.config||empty);setError('');}catch(e){setError((e as Error).message);}},[request]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{let cancelled=false;void fetch(endpoint+'&directory=1',{cache:'no-store'}).then(async r=>{const v:any=await r.json();if(!r.ok)throw Error(v.error);if(!cancelled)setDirectory(v);}).catch(e=>{if(!cancelled)setError('Справочник CRMCalls: '+e.message);});return ()=>{cancelled=true;};},[endpoint]);
 const scenarioIds=JSON.stringify([form.scenarioId,...(form.additionalScenarios||[]).map(s=>s.scenarioId)].filter(Boolean));
 useEffect(()=>{let cancelled=false;void (async()=>{const loaded:Record<string,{id:string;name:string}[]>={};for(const id of JSON.parse(scenarioIds) as string[]){const r=await fetch(endpoint+'&directory=1&scenarioId='+encodeURIComponent(id),{cache:'no-store'});const v:any=await r.json();if(!r.ok)throw Error(v.error);loaded[id]=v.results;}if(!cancelled)setResults(loaded);})().catch(e=>{if(!cancelled)setError('Результаты сценария: '+e.message);});return ()=>{cancelled=true;};},[endpoint,scenarioIds]);

 async function save(){setBusy(true);setError('');setMessage('');try{const result=await request({action:'saveIncoming',config:form,revision:form.revision});if(result.secret)setSecret(result.secret);await load();setMessage('Настройки сохранены. Отправка из сценария CRMCalls настраивается отдельно.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="cc-incoming" aria-labelledby="cc-incoming-title">
  <div className="cc-toolbar"><h2 id="cc-incoming-title">CRMCalls → Новые заказы</h2><span>{data?.config?.enabled?'Приём включён':'Приём выключен'}</span></div>
  <p>Результат «СМ СРМ» создаёт карточку с пустой корзиной у оператора, который сохранил результат.</p>
  {error&&<p className="cc-alert" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!data?<button className="secondary" onClick={()=>void load()}>Загрузить настройки</button>:<>
   <details><summary>Настроить приём заказов</summary>
    <div className="cc-incoming-form">
     <p className="muted">В CRMCalls откройте сценарий и добавьте действие Webhook для результата «СМ СРМ». Выберите поля по инструкции интеграции. CRMCalls отправляет событие только при первом сохранении результата звонка.</p>
     <label className="cc-field">Адрес приёма<input readOnly value={typeof window==='undefined'?'':window.location.origin+'/api/crmcalls-incoming'}/></label>
     <div className="cc-form-grid"><label className="cc-field">Сценарий CRMCalls<select value={form.scenarioId} onChange={e=>setForm({...form,scenarioId:e.target.value,resultId:''})}><option value="">Выберите сценарий</option>{directory.scenarios.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label className="cc-field">Результат передачи<select value={form.resultId} onChange={e=>setForm({...form,resultId:e.target.value})}><option value="">Выберите «СМ СРМ»</option>{(results[form.scenarioId]||[]).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label></div>
     {(form.additionalScenarios||[]).map((scenario,i)=><div className="cc-form-grid" key={i}>
      <label className="cc-field">Дополнительный сценарий {i+1}<select value={scenario.scenarioId} onChange={e=>setForm({...form,additionalScenarios:form.additionalScenarios!.map((s,n)=>n===i?{scenarioId:e.target.value,resultId:''}:s)})}><option value="">Выберите сценарий</option>{directory.scenarios.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label className="cc-field">Результат дополнительного сценария {i+1}<select value={scenario.resultId} onChange={e=>setForm({...form,additionalScenarios:form.additionalScenarios!.map((s,n)=>n===i?{...s,resultId:e.target.value}:s)})}><option value="">Выберите «СМ СРМ»</option>{(results[scenario.scenarioId]||[]).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <button className="secondary" onClick={()=>setForm({...form,additionalScenarios:form.additionalScenarios!.filter((_,n)=>n!==i)})}>Убрать сценарий {i+1}</button>
     </div>)}
     <button className="secondary" onClick={()=>setForm({...form,additionalScenarios:[...(form.additionalScenarios||[]),{scenarioId:'',resultId:''}]})}>Добавить сценарий</button>
     <p className="muted">Связь с CRMCalls настраивается в карточке сотрудника, в поле «ФИО в CRMCalls».</p>
     <label className="cc-check"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Принимать карточки из CRMCalls</label>
     <button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить приём карточек'}</button>
    </div>
   </details>
   {secret&&<div className="cc-incoming-secret"><p>Секрет показан один раз. Внесите в заголовок Authorization действия Webhook в CRMCalls. Не отправляйте его в переписку.</p><label className="cc-field">Значение Authorization<input readOnly type="password" value={'Bearer '+secret} onFocus={e=>e.currentTarget.select()}/></label><button className="secondary" onClick={()=>setSecret('')}>Секрет сохранён — скрыть</button></div>}
   <div className="cc-toolbar"><h3>Последние поступления</h3><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setData(await request({action:'retryIncoming'}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Повторить обработку</button></div>
   {!data.transfers.length?<p className="muted">Карточек пока нет. После передачи здесь появится результат обработки.</p>:data.transfers.map(t=><div className="cc-history-row" key={t.call_id}><div><strong>{t.name||'Клиент из CRMCalls'}</strong><small>{new Date(t.received_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК · {t.user_name||'Оператор CRMCalls'}</small><small>{t.state==='imported'?'Создана карточка '+t.order_id:t.state==='permission'?'Требует разрешения · '+t.reason:t.reason||'Ожидает обработки'}</small>{t.state!=='imported'&&<small>ID оператора CRMCalls: {t.user_id}</small>}</div></div>)}
  </>}
 </section>;
}

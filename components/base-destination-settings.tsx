'use client';
import {useEffect,useState} from 'react';
import {Headphones} from 'lucide-react';
type Target='skorozvon'|'oktell';
type SettingsResponse={config:{dispatchTarget:Target};revision:string;error?:string};
export function BaseDestinationSettings({actorId}:{actorId:string}){
 const [saved,setSaved]=useState<{target:Target;revision:string}|null>(null),[target,setTarget]=useState<Target>('skorozvon'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){setError('');try{
  const r=await fetch('/api/base?actorId='+encodeURIComponent(actorId),{cache:'no-store'}),d=await r.json() as SettingsResponse;
  if(!r.ok)throw Error(d.error||'Не удалось загрузить настройки');
  setSaved({target:d.config.dispatchTarget,revision:d.revision});setTarget(d.config.dispatchTarget);
 }catch(e){setError(e instanceof Error?e.message:'Ошибка загрузки');}}
 useEffect(()=>{void load();},[actorId]);
 async function save(){if(!saved)return;setBusy(true);setError('');setMessage('');try{
  const r=await fetch('/api/base?actorId='+encodeURIComponent(actorId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'destination',target,revision:saved.revision})}),d=await r.json() as SettingsResponse;
  if(!r.ok)throw Error(d.error||'Не удалось сохранить');
  setSaved({target:d.config.dispatchTarget,revision:d.revision});setMessage('Направление отправки сохранено');
 }catch(e){setError(e instanceof Error?e.message:'Ошибка сохранения');}finally{setBusy(false);}}
 return <section className="settings-card stack"><Headphones/><h2>Куда отправлять клиентов из базы</h2>
  <p>Одно направление для баз М и Ж: ручной и автоматической отправки на обзвон.</p>
  {saved&&<form className="stack" onSubmit={e=>{e.preventDefault();void save();}}>
   <fieldset className="stack" disabled={busy}><legend>Сервис обзвона</legend>
    <label><input type="radio" name="base-destination" value="skorozvon" checked={target==='skorozvon'} onChange={()=>{setTarget('skorozvon');setMessage('');}}/> Скорозвон</label>
    <label><input type="radio" name="base-destination" value="oktell" checked={target==='oktell'} onChange={()=>{setTarget('oktell');setMessage('');}}/> Oktell — работа оператора в CRM</label>
   </fieldset>
   {target==='oktell'&&<p className="notice">Передача клиентов в Oktell настраивается. После сохранения этого выбора отправка из базы будет приостановлена; клиенты не уйдут в Скорозвон. Уже начатая отправка может завершиться.</p>}
   {target==='skorozvon'&&<p className="muted">Отправка выполняется в проекты Скорозвона по настройкам листов базы.</p>}
   <button className="primary" disabled={busy||target===saved.target}>{busy?'Сохранение…':'Сохранить направление'}</button>
  </form>}
  {message&&<p role="status">{message}</p>}
  {error&&<p role="alert">{error} <button className="secondary" disabled={busy} onClick={()=>void load()}>Обновить настройки</button></p>}
 </section>;
}

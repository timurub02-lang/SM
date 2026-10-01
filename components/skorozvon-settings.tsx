'use client';
import {useEffect,useState} from 'react';
type Status={configured:boolean;login:string;checkedAt:string;revision:string};
export function SkorozvonSettings({actorId}:{actorId:string}){
 const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('/api/skorozvon?actorId='+encodeURIComponent(actorId)).then(async r=>{const d=await r.json() as Status&{error?:string};if(!r.ok)throw Error(d.error);setStatus(d);}).catch(()=>setMessage('Не удалось загрузить подключение'));},[actorId]);
 return <section className="stack"><h3>Скорозвон</h3>{status&&<><p>{status.configured?'Подключение настроено':'Не подключён'}{status.checkedAt?' · Проверено '+new Date(status.checkedAt).toLocaleString('ru-RU'):''}</p><form className="stack" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,fields=new FormData(form);setBusy(true);setMessage('');try{const r=await fetch('/api/skorozvon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actorId,revision:status.revision,...Object.fromEntries(fields)})});const d=await r.json() as Status&{error?:string;message?:string};if(!r.ok)throw Error(d.error);setStatus(d);form.reset();setMessage(d.message||'Подключение проверено');}catch(e){setMessage(e instanceof Error?e.message:'Ошибка подключения');}finally{setBusy(false);}}}>
 <label className="field"><span>Логин Скорозвона (email)</span><input name="login" type="email" defaultValue={status.login} required disabled={busy}/></label>
 {([['apiKey','API-ключ'],['clientId','ID приложения'],['clientSecret','Ключ приложения']] as const).map(([name,label])=><label className="field" key={name}><span>{label}</span><input type="password" name={name} autoComplete="new-password" maxLength={500} required={!status.configured} disabled={busy} placeholder={status.configured?'Сохранён. Оставьте пустым, чтобы не менять':''}/></label>)}
 <button className="secondary" disabled={busy}>{busy?'Проверка…':status.configured?'Проверить подключение':'Проверить и сохранить'}</button></form></>}
 <p role="status">{message}</p><p className="notice">Звонки и текущие статусы сотрудников доступны в разделе «Активность». Передача клиентов и результатов звонков в обе стороны настраивается отдельно.</p></section>;
}

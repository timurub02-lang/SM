'use client';
import {useEffect,useState} from 'react';
import {CdekStatusMapping} from './cdek-status-mapping';
import {type AccountType,type RoutingAccount} from '@/lib/cdek-accounts';

const labels={schedule:'По графику · все отделы, кроме А_',departmentA:'Только отдел А_'};
type Draft={slot?:number;name:string;type:AccountType;clientId:string;clientSecret:string};
export function CdekSettings({actorId,isAdmin}:{actorId:string;isAdmin:boolean}){
 const [accounts,setAccounts]=useState<RoutingAccount[]>([]),[draft,setDraft]=useState<Draft|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;fetch('/api/cdek').then(async r=>{
  if(!r.ok)throw Error();
  const data=await r.json() as {accounts:RoutingAccount[]};if(active)setAccounts(data.accounts);
 }).catch(()=>{if(active)setMessage('Не удалось загрузить аккаунты СДЭК');});return()=>{active=false;};},[]);
 function edit(account?:RoutingAccount){
  setDraft({slot:account?.slot,name:account?.name||'',type:account?.type||'schedule',clientId:'',clientSecret:''});setMessage('');
 }
 async function save(){
  if(!draft||busy)return;
  setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/cdek',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actorId,...draft})});
   const data=await r.json() as RoutingAccount & {error?:string};if(!r.ok)throw Error(data.error);
   setAccounts(rows=>[...rows.filter(a=>a.slot!==data.slot),data].sort((a,b)=>a.slot-b.slot));
   setDraft(null);setMessage('Подключение проверено. Аккаунт сохранён.');
  }catch(e){setMessage(e instanceof Error?e.message:'Не удалось подключить аккаунт');}finally{setBusy(false);}
 }
 return <section className="integration stack" style={{display:'grid'}}>
  <div className="heading-actions"><h3>Аккаунты СДЭК</h3>{isAdmin&&<button type="button" className="secondary" disabled={busy} onClick={()=>edit()}>Добавить аккаунт</button>}</div>
  {accounts.length>0&&<div className="routing-summary-scroll"><table><thead><tr><th>Аккаунт</th><th>Тип выгрузки</th><th>Подключение</th>{isAdmin&&<th/>}</tr></thead>
   <tbody>{accounts.map(a=><tr key={a.slot}><td>{a.name}</td><td>{labels[a.type||'schedule']}</td><td>{a.configured?'Подключён':'Нет ключей'}</td>
    {isAdmin&&<td><button className="text-button" type="button" disabled={busy} onClick={()=>edit(a)}>Изменить</button></td>}</tr>)}</tbody></table></div>}
  {isAdmin&&draft&&<fieldset disabled={busy} className="form-grid">
   <label className="field">Название<input maxLength={80} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   <label className="field">Тип выгрузки<select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value as AccountType})}>
    <option value="schedule">{labels.schedule}</option><option value="departmentA">{labels.departmentA}</option></select></label>
   <label className="field">API-ключ<input type="password" autoComplete="new-password" value={draft.clientId} placeholder={draft.slot?'Сохранён':'Введите ключ'} onChange={e=>setDraft({...draft,clientId:e.target.value})}/></label>
   <label className="field">Пароль API<input type="password" autoComplete="new-password" value={draft.clientSecret} placeholder={draft.slot?'Сохранён':'Введите пароль'} onChange={e=>setDraft({...draft,clientSecret:e.target.value})}/></label>
   <div className="heading-actions"><button type="button" className="primary" disabled={!draft.name.trim()||(!draft.slot&&(!draft.clientId.trim()||!draft.clientSecret.trim()))} onClick={save}>{busy?'Проверка…':draft.slot?'Проверить и сохранить':'Проверить и подключить'}</button>
   <button type="button" className="secondary" onClick={()=>setDraft(null)}>Отмена</button></div>
  </fieldset>}
  {message&&<p role="status">{message}</p>}<CdekStatusMapping actorId={actorId} isAdmin={isAdmin}/>
 </section>;
}

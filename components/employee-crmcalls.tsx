"use client";
import {useEffect,useState} from 'react';

type Config={enabled:boolean;scenarioId:string;resultId:string;additionalScenarios?:{scenarioId:string;resultId:string}[];operators:{userId:string;employeeId:string}[];revision:string};
export function EmployeeCRMCalls({employeeId,actorId}:{employeeId?:string;actorId:string}){
 const [config,setConfig]=useState<Config|null>(null),[users,setUsers]=useState<{id:string;name:string;status:string}[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const endpoint='/api/crmcalls?actorId='+encodeURIComponent(actorId);
 useEffect(()=>{if(!employeeId)return;let cancelled=false;void Promise.all([fetch(endpoint+'&incoming=1'),fetch(endpoint+'&directory=1')]).then(async responses=>{
  const [incoming,directory]=await Promise.all(responses.map(async r=>{const v:any=await r.json();if(!r.ok)throw Error(v.error||'Не удалось загрузить CRMCalls');return v;}));
  if(cancelled)return;setConfig(incoming.config);setUsers(directory.users);const links=incoming.config?.operators.filter((v:{employeeId:string})=>v.employeeId===employeeId)||[];
  if(links.length>1){setMessage('У сотрудника несколько связей. Измените их в разделе CRMCalls.');return;}setSelected(links[0]?.userId||'');
 }).catch(e=>{if(!cancelled)setMessage(e.message);});return ()=>{cancelled=true;};},[endpoint,employeeId]);
 const multiple=(config?.operators.filter(v=>v.employeeId===employeeId).length||0)>1;
 async function save(){if(!config||!employeeId)return;setBusy(true);setMessage('');try{
  const next={...config,operators:[...config.operators.filter(v=>v.employeeId!==employeeId),...(selected?[{userId:selected,employeeId}]:[])]};
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveIncoming',config:next,revision:config.revision})});const v:any=await r.json();if(!r.ok)throw Error(v.error||'Не удалось сохранить связь');setConfig({...next,revision:v.revision});setMessage('Связь CRMCalls сохранена');
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <fieldset className="stack"><legend>CRMCalls</legend><label>ФИО в CRMCalls<select aria-label="ФИО в CRMCalls" value={selected} disabled={!config||busy||multiple} onChange={e=>setSelected(e.target.value)}><option value="">Не связан</option>{users.map(u=><option key={u.id} value={u.id} disabled={u.status!=='active'||!!config?.operators.some(v=>v.userId===u.id&&v.employeeId!==employeeId)}>{u.name}{u.status!=='active'?' · неактивен':''}</option>)}</select></label>
  <p className="muted">Связь сохраняется по ID сотрудника CRMCalls и используется для новых заказов из всех подключённых сценариев.</p>
  {!employeeId?<p className="muted">Сначала сохраните сотрудника.</p>:!config&&!message?<p className="muted">Настройте приём заказов в разделе CRMCalls.</p>:null}
  <button type="button" className="secondary" disabled={!config||busy||multiple} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить связь CRMCalls'}</button>{message&&<p role="status">{message}</p>}
 </fieldset>;
}

"use client";
import {useEffect,useState,useId} from 'react';

type Config={enabled:boolean;scenarioId:string;resultId:string;additionalScenarios?:{scenarioId:string;resultId:string}[];operators:{userId:string;employeeId:string}[];revision:string};
export function EmployeeCRMCalls({employeeId,actorId}:{employeeId?:string;actorId:string}){
 const [config,setConfig]=useState<Config|null>(null),[users,setUsers]=useState<{id:string;name:string;status:string}[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const listId=useId(),[name,setName]=useState('');
 const endpoint='/api/crmcalls?actorId='+encodeURIComponent(actorId);
 useEffect(()=>{if(!employeeId)return;let cancelled=false;void Promise.all([fetch(endpoint+'&incoming=1'),fetch(endpoint+'&directory=1')]).then(async responses=>{
  const [incoming,directory]=await Promise.all(responses.map(async r=>{const v:any=await r.json();if(!r.ok)throw Error(v.error||'Не удалось загрузить CRMCalls');return v;}));
  if(cancelled)return;setConfig(incoming.config);setUsers(directory.users);const links=incoming.config?.operators.filter((v:{employeeId:string})=>v.employeeId===employeeId)||[];
  if(links.length>1){setMessage('У сотрудника несколько связей CRMCalls. Требуется проверка сопоставления.');return;}setSelected(links[0]?.userId||'');setName(directory.users.find((u:{id:string;name:string})=>u.id===links[0]?.userId)?.name||'');
 }).catch(e=>{if(!cancelled)setMessage(e.message);});return ()=>{cancelled=true;};},[endpoint,employeeId]);
 const multiple=(config?.operators.filter(v=>v.employeeId===employeeId).length||0)>1;
 async function save(){if(!config||!employeeId)return;setBusy(true);setMessage('');try{
  const matches=users.filter(u=>u.name.trim()===name.trim()&&u.status==='active'&&!config.operators.some(v=>v.userId===u.id&&v.employeeId!==employeeId));
  const userId=name.trim()?(matches.find(u=>u.id===selected)?.id||(matches.length===1?matches[0].id:'')):'';
  if(name.trim()&&!userId)throw Error('Укажите точное ФИО единственного свободного активного сотрудника CRMCalls из подсказок.');
  const next={...config,operators:[...config.operators.filter(v=>v.employeeId!==employeeId),...(userId?[{userId,employeeId}]:[])]};
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveIncoming',config:next,revision:config.revision})});const v:any=await r.json();if(!r.ok)throw Error(v.error||'Не удалось сохранить связь');setConfig({...next,revision:v.revision});setSelected(userId);setMessage('Связь CRMCalls сохранена');
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <div className="stack" style={{gridColumn:"1 / -1"}}><label className="field"><span>ФИО в CRMCalls</span><input aria-label="ФИО в CRMCalls" list={listId} value={name} placeholder="Точно как в CRMCalls, включая приставку" disabled={!config||busy||multiple} onChange={e=>setName(e.target.value)}/><datalist id={listId}>{users.filter(u=>u.status==='active'&&!config?.operators.some(v=>v.userId===u.id&&v.employeeId!==employeeId)).map(u=><option key={u.id} value={u.name}/>)}</datalist></label>
  {!employeeId?<p className="muted">Сначала сохраните сотрудника.</p>:!config&&!message?<p className="muted">Настройте приём заказов в разделе CRMCalls.</p>:null}
  <button type="button" className="secondary" disabled={!config||busy||multiple} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить связь CRMCalls'}</button>{message&&<p role="status">{message}</p>}
 </div>;
}

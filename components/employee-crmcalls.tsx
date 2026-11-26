"use client";
import {useEffect,useState,useId} from 'react';

export function EmployeeCRMCalls({employeeId,actorId}:{employeeId?:string;actorId:string}){
 const [revision,setRevision]=useState<string|null>(null),[users,setUsers]=useState<{id:string;name:string}[]>([]),[name,setName]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const listId=useId(),endpoint='/api/crmcalls-employee?actorId='+encodeURIComponent(actorId);
 useEffect(()=>{if(!employeeId)return;let cancelled=false;void fetch(endpoint+'&employeeId='+encodeURIComponent(employeeId)).then(async r=>{
  const v:any=await r.json();if(!r.ok)throw Error(v.error||'Не удалось загрузить CRMCalls');
  if(cancelled)return;setRevision(v.revision);setUsers(v.users);setName(v.name);
 }).catch(e=>{if(!cancelled)setMessage(e.message);});return ()=>{cancelled=true;};},[endpoint,employeeId]);
 async function save(){if(!revision||!employeeId)return;setBusy(true);setMessage('');try{
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId,name,revision})});const v:any=await r.json();if(!r.ok)throw Error(v.error||'Не удалось сохранить связь');
  setRevision(v.revision);setName(v.name);setMessage('Связь CRMCalls сохранена');
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <div className="stack" style={{gridColumn:"1 / -1"}}><label className="field"><span>ФИО в CRMCalls</span><input aria-label="ФИО в CRMCalls" list={listId} value={name} placeholder="Точно как в CRMCalls, включая приставку" disabled={!revision||busy} onChange={e=>setName(e.target.value)}/><datalist id={listId}>{users.map(u=><option key={u.id} value={u.name}/>)}</datalist></label>
  {!employeeId?<p className="muted">Сначала сохраните сотрудника.</p>:null}
  <button type="button" className="secondary" disabled={!revision||busy} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить связь CRMCalls'}</button>{message&&<p role="status">{message}</p>}
 </div>;
}

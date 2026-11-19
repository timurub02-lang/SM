'use client';
import {notifyAccountChange} from '@/lib/browser-account';
import {createContext,useContext,useState,type ReactNode} from 'react';
import {toast} from 'sonner';
type Mode={id:string;name:string;adminName:string;ownerRole?:string}|null;
const Context=createContext<Mode>(null);
export const useImpersonationSession=()=>useContext(Context);
async function switchSession(body:{action:'start';employeeId:string}|{action:'stop'}){
 const response=await fetch('/api/auth/impersonation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||'Не удалось переключить кабинет');
 notifyAccountChange();window.location.replace('/');
}
export function EnterEmployeeButton({employeeId,disabled=false}:{employeeId:string;disabled?:boolean}){
 const [busy,setBusy]=useState(false);const mode=useImpersonationSession();
 if(mode)return null;
 return <button type="button" className="secondary employee-enter-button" disabled={disabled||busy} onClick={async()=>{setBusy(true);try{await switchSession({action:'start',employeeId});}catch(error){toast.error(error instanceof Error?error.message:'Не удалось войти');setBusy(false);}}}>{busy?'Входим…':'Войти как сотрудник'}</button>;
}
export function ImpersonationSession({mode,children}:{mode:Mode;children:ReactNode}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const ownerRole=mode?.ownerRole||'admin',ownerLabel=ownerRole==='admin'?'Администратор':ownerRole==='department_head'?'Руководитель':'Пользователь';
 const returnLabel=ownerRole==='admin'?'Вернуться в администратора':ownerRole==='department_head'?'Вернуться в кабинет руководителя':'Вернуться в свой кабинет';
 return <Context.Provider value={mode}>{mode&&<aside className="impersonation-banner" aria-label="Вход под сотрудником"><div><strong>Вы работаете как {mode.name}</strong><span>Звонки отключены · {ownerLabel}: {mode.adminName}</span>{error&&<p role="alert">{error}</p>}</div><button type="button" className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await switchSession({action:'stop'});}catch(error){setError(error instanceof Error?error.message:'Не удалось вернуться');setBusy(false);}}}>{busy?'Возвращаемся…':returnLabel}</button></aside>}{children}</Context.Provider>;
}

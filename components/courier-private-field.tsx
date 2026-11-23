'use client';
import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {readJsonResponse} from '@/lib/read-json-response';

type Field='intercom'|'note';
type Entry={orderId:string;field:Field;value:string};
const endpoint='/api/courier-notes';
export function useCourierNotes(courierId:string,enabled:boolean){
 const [entries,setEntries]=useState<Record<string,Partial<Record<Field,string>>>>({}),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  setStatus('loading');
  fetch(endpoint,{signal:controller.signal,cache:'no-store'}).then(readJsonResponse<Entry[]>).then(rows=>{
   if(controller.signal.aborted)return;
   const values:typeof entries={};
   for(const row of rows)(values[row.orderId]??={})[row.field]=row.value;
   setEntries(values);setStatus('ready');
  }).catch(()=>{if(!controller.signal.aborted)setStatus('error');});
  return ()=>controller.abort();
 },[courierId,enabled,attempt]);
 async function save(orderId:string,field:Field,value:string,previous:string){
  await readJsonResponse(await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,field,value,previous})}));
  setEntries(current=>({...current,[orderId]:{...current[orderId],[field]:value}}));
 }
 return {entries,status,save,retry:()=>setAttempt(n=>n+1)};
}

export function CourierPrivateField({orderId,field,notes}:{orderId:string;field:Field;notes:ReturnType<typeof useCourierNotes>}){
 const saved=notes.entries[orderId]?.[field]??'';
 const [draft,setDraft]=useState<string|null>(null),[saving,setSaving]=useState(false);
 const intercom=field==='intercom',label=intercom?'Домофон':'Моя заметка';
 const props={value:draft??saved,disabled:saving||notes.status!=='ready',onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setDraft(event.target.value)};
 async function submit(event:React.FormEvent){
  event.preventDefault();
  if(draft===null||saving)return;
  setSaving(true);
  try{await notes.save(orderId,field,draft.trim(),saved);setDraft(null);toast.success('Сохранено');}
  catch(error){toast.error(error instanceof Error?error.message:'Не удалось сохранить');}
  finally{setSaving(false);}
 }
 return <form className={'courier-private-field '+(intercom?'courier-intercom':'courier-self-note')} onSubmit={submit}>
  <label><b>{label}</b>{!intercom&&<small>Видна только вам</small>}
   {intercom?<input {...props} type="text" autoComplete="off" maxLength={80} placeholder="Код домофона"/>:<textarea {...props} rows={2} maxLength={1000} placeholder="Что важно помнить при доставке"/>}
  </label>
  {notes.status==='error'?<button className="secondary" type="button" onClick={notes.retry}>Повторить загрузку</button>:draft!==null&&draft!==saved&&<button className="secondary" type="submit" disabled={saving}>{saving?'Сохранение…':'Сохранить'}</button>}
 </form>;
}

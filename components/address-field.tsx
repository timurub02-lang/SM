"use client";
import {useState,useEffect,useId,useRef} from 'react';
import {addressLabels,formatAddress,orderAddressWarnings,type AddressParts,type AddressSuggestion,type AddressWarning} from "@/lib/address";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';

export function useOrderAddressReview(scope:string,address:string,parts:AddressParts,busy:boolean,actionLabel:string){
 const [reviewed,setReviewed]=useState<string|null>(null);
 const [confirmation,setConfirmation]=useState<{key:string;save:()=>void}|null>(null);
 const ref=useRef<HTMLDivElement>(null);
 const key=JSON.stringify([scope,address,parts]);
 const warnings=orderAddressWarnings(address,parts);
 useEffect(()=>{if(reviewed===key)ref.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();},[reviewed,key]);
 function reset(){setReviewed(null);setConfirmation(null);}
 function review(save:(confirmed:boolean)=>void){
  if(busy)return;
  if(!warnings.length){save(false);return;}
  if(reviewed!==key){setReviewed(key);return;}
  setConfirmation({key,save:()=>save(true)});
 }
 const dialog=<Dialog open={!!confirmation&&confirmation.key===key} onOpenChange={open=>{if(!open)setConfirmation(null);}}><DialogContent className="form-dialog address-confirmation"><DialogHeader><DialogTitle>Вы проверили и исправили адрес?</DialogTitle><DialogDescription>В адресе остались возможные ошибки. Если вы уточнили его у клиента и уверены в нём, подтвердите адрес вручную — сведения ДаДаты могут быть неполными.</DialogDescription></DialogHeader><p>{address||"Адрес не указан"}</p><ul>{warnings.map(w=><li key={w.field}>{w.message}</li>)}</ul><div className="action-buttons"><button type="button" className="secondary" onClick={()=>setConfirmation(null)}>Вернуться к адресу</button><button type="button" className="primary" disabled={busy||confirmation?.key!==key} onClick={()=>{if(busy||confirmation?.key!==key)return;const save=confirmation.save;setConfirmation(null);save();}}>Адрес проверен — {actionLabel.toLocaleLowerCase('ru')}</button></div></DialogContent></Dialog>;
 return {ref,warnings:reviewed===key?warnings:[],review,reset,dialog};
}

export function AddressField({value,onChange,parts,disabled=false,warnings=[],reviewAction="Создать заказ"}:{value:string;onChange:(v:string,parts?:AddressParts)=>void;parts?:AddressParts;disabled?:boolean;warnings?:AddressWarning[];reviewAction?:string}){
 const [options,setOptions]=useState<AddressSuggestion[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [search,setSearch]=useState(false),[open,setOpen]=useState(false),[active,setActive]=useState(-1);const listId=useId();
 useEffect(()=>{
  if(!search||disabled||value.trim().length<3){setBusy(false);return;}
  const controller=new AbortController();let current=true;
  const timer=setTimeout(async()=>{setBusy(true);setError('');try{
   const r=await fetch('/api/dadata',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'suggest',query:value}),signal:controller.signal});
   const d=await r.json() as {error?:string;suggestions:AddressSuggestion[]};if(!r.ok)throw Error(d.error);
   if(current){setOptions(d.suggestions);setOpen(true);setActive(-1);if(!d.suggestions.length)setError('Адрес не найден. Уточните город, улицу и дом.');}
  }catch(e){if(current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось найти адрес');}finally{if(current)setBusy(false);}},350);
  return()=>{current=false;clearTimeout(timer);controller.abort();};
 },[value,search,disabled]);
 function choose(option:AddressSuggestion){setSearch(false);setOpen(false);setOptions([]);setError('');onChange(option.value,option.parts);}
 const warningFor=(field:AddressWarning['field'])=>warnings.find(w=>w.field===field)?.message;
 return <div className="stack">{warnings.length>0&&<div className="address-review" role="alert"><strong>В адресе возможна ошибка</strong><p>Проверьте отмеченные поля. Если адрес верный, снова нажмите «{reviewAction}» и подтвердите его вручную.</p></div>}<div className="address-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}><label className="field"><span>Адрес доставки · поиск одной строкой</span><input aria-invalid={!!warningFor('address')} aria-describedby={warningFor('address')?`${listId}-address-warning`:undefined} role="combobox" aria-autocomplete="list" aria-expanded={open&&options.length>0} aria-controls={listId} aria-activedescendant={open&&active>=0?`${listId}-${active}`:undefined} autoComplete="off" maxLength={500} value={value} disabled={disabled} onFocus={()=>{if(options.length)setOpen(true);}} onChange={e=>{onChange(e.target.value,undefined);setSearch(true);setOpen(true);setOptions([]);setActive(-1);setError('');}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setSearch(false);}else if(options.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setOpen(true);setActive(n=>e.key==='ArrowDown'?Math.min(n+1,options.length-1):Math.max(n-1,0));}else if(e.key==='Enter'&&open&&options.length){e.preventDefault();choose(options[Math.max(0,active)]);}}} placeholder="Например: москва тверская 1 кв 12"/>{warningFor('address')&&<small className="address-warning" id={`${listId}-address-warning`}>{warningFor('address')}</small>}</label>{open&&options.length>0&&<div className="address-options" role="listbox" id={listId} aria-label="Варианты адреса">{options.map((option,i)=><button type="button" role="option" aria-selected={i===active} id={`${listId}-${i}`} key={i} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(option)}>{option.value}</button>)}</div>}</div>{busy&&<small role="status">Ищем адрес…</small>}{parts&&<div className="form-grid">{(Object.keys(addressLabels) as (keyof AddressParts)[]).map(key=><label className="field" key={key}><span>{addressLabels[key]}</span><input aria-invalid={!!warningFor(key)} aria-describedby={warningFor(key)?`${listId}-${key}-warning`:undefined} disabled={disabled} value={parts[key]} maxLength={key==='postalCode'?20:250} onChange={e=>{const next={...parts,[key]:e.target.value};setSearch(false);setOpen(false);setOptions([]);onChange(formatAddress(next),next);}}/>{warningFor(key)&&<small className="address-warning" id={`${listId}-${key}-warning`}>{warningFor(key)}</small>}</label>)}</div>}{!disabled&&<small className="muted">Выберите адрес из списка. Дом и квартиру можно уточнить в полях ниже.</small>}{error&&<p role="alert" className="orange">{error}</p>}</div>;
}
export function DadataSettings({actorId,isAdmin}:{actorId:string;isAdmin:boolean}){
 const [configured,setConfigured]=useState(false);
 useEffect(()=>{fetch('/api/dadata').then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>setConfigured(!!(d as {configured:boolean}).configured)).catch(()=>{});},[]);
 const [token,setToken]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function save(){setBusy(true);setMessage('');try{const r=await fetch('/api/dadata',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',actorId,token,secret})});const d=await r.json() as {error?:string;suggestions:string[]};if(!r.ok)throw Error(d.error);setConfigured(true);setToken('');setSecret('');setMessage('API-ключ сохранён. Подсказки адресов работают.');}catch(e){setMessage(e instanceof Error?e.message:'Не удалось сохранить');}finally{setBusy(false);}}
 return <section className="stack"><h3>ДаДата · адресные подсказки</h3><p>{configured?"API-ключ сохранён":"API-ключ ещё не добавлен"}</p>{isAdmin?<><label className="field"><span>API-ключ</span><input type="password" autoComplete="new-password" value={token} onChange={e=>setToken(e.target.value)} placeholder="Новый ключ или пусто — сохранить текущий"/></label><label className="field"><span>Секретный ключ (необязательно)</span><input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Для стандартизации, в подсказках не используется"/></label><button type="button" className="secondary" disabled={busy} onClick={save}>{busy?'Проверка…':'Проверить и сохранить ключи'}</button><small>Сохранённые ключи не возвращаются в браузер. Для подсказок достаточно API-ключа.</small><a href="https://dadata.ru/profile/#info" target="_blank" rel="noreferrer">Открыть ключи в личном кабинете ДаДата ↗</a></>:<p>Ключи подключения настраивает администратор.</p>}{message&&<p role="status">{message}</p>}</section>;
}

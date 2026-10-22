'use client';
import {useState} from 'react';
import {ArrowDownToLine} from 'lucide-react';
import type {Order} from '@/lib/crm';
export function CdekWaybills({actorId,orders,disabled,onBusy,onDownloaded}:{actorId:string;orders:Order[];disabled:boolean;onBusy:(busy:boolean)=>void;onDownloaded:(ids:string[])=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[errors,setErrors]=useState<string[]>([]);
 async function download(){
  if(busy||disabled||!orders.length)return;
  setBusy(true);onBusy(true);setErrors([]);setMessage(`Получаем накладные: 0 из ${orders.length}`);
  try{
   const {collectCdekWaybills}=await import('@/lib/cdek-batch-print');
   const result=await collectCdekWaybills(actorId,orders.map(o=>o.id),(done,total)=>setMessage(`Получаем накладные: ${done} из ${total}`));
   if(result.bytes){
    const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/zip'}));
    const a=document.createElement('a');a.href=url;a.download='Накладные-СДЭК.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    onDownloaded(result.completed);
   }
   setErrors(result.errors);setMessage(`Получено: ${result.completed.length} из ${orders.length}.${result.errors.length?' Не полученные заказы остались выбранными.':''}`);
  }catch{setMessage('Не удалось подготовить архив. Повторите скачивание.');}
  finally{setBusy(false);onBusy(false);window.dispatchEvent(new Event('crm-refresh'));}
 }
 return <div><button className="primary cdek-button" disabled={disabled||busy||!orders.length} aria-busy={busy} onClick={()=>void download()}><ArrowDownToLine size={17}/>{busy?'Подготовка накладных…':`Скачать накладные СДЭК (${orders.length})`}</button>{message&&<p role="status">{message}</p>}{errors.length>0&&<details><summary>Не удалось получить: {errors.length}</summary>{errors.map((error,i)=><p key={i}>{error}</p>)}</details>}</div>;
}

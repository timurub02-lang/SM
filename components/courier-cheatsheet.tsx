"use client";
import {useState} from 'react';
import {ArrowDownToLine} from 'lucide-react';
import {toast} from 'sonner';
import type {CourierCheatsheetData} from '@/lib/internal-waybill';
export function CourierCheatsheetButton({orderId,actorId,disabled}:{orderId:string;actorId:string;disabled:boolean}){
 const [loading,setLoading]=useState(false);
 async function download(){
  setLoading(true);
  try{
   const response=await fetch(`/api/warehouse/waybill?actorId=${encodeURIComponent(actorId)}&orderId=${encodeURIComponent(orderId)}&format=cheatsheet`);
   const data=await response.json() as CourierCheatsheetData & {error?:string};if(!response.ok)throw Error(data.error||'Не удалось получить шпаргалку');
   const {downloadCourierCheatsheet}=await import('@/lib/waybill-pdf');await downloadCourierCheatsheet(data);
  }catch(error){toast.error(error instanceof Error?error.message:'Не удалось скачать шпаргалку');}finally{setLoading(false);}
 }
 return <button type="button" className="secondary courier-cheatsheet" disabled={disabled||loading} onClick={download}><ArrowDownToLine size={16}/>{loading?'Подготовка…':'Шпаргалка'}</button>;
}

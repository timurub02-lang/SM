'use client';
import {useState} from 'react';
import {downloadExport} from '@/lib/download-export';
export function BaseExportButton({actorId,base}:{actorId:string;base:'M'|'J'}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function download(){setBusy(true);setMessage('Готовим Excel…');try{await downloadExport('base',base,`/api/base/export?actorId=${encodeURIComponent(actorId)}&base=${base}`,`base-${base}.xlsx`,setMessage);setMessage('Файл готов');}catch(error){setMessage(error instanceof Error?error.message:'Ошибка выгрузки');}finally{setBusy(false);}}
 return <span><button className="secondary" disabled={busy} onClick={()=>void download()}>{busy?'Готовим Excel…':'Скачать Excel'}</button><small role="status">{message}</small></span>;
}

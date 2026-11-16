'use client';
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Order} from '@/lib/crm';

export function LogisticListComment({order,busy,editable,mutate}:{order:Order;busy:boolean;editable:boolean;mutate:(data:Record<string,unknown>)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[text,setText]=useState(''),[version,setVersion]=useState(order.version);
 const saved=order.logisticComment||'';
 return <><button type="button" className="logistic-list-comment" aria-label={`Комментарий логиста к заказу ${order.id}`} onClick={()=>{setText(saved);setVersion(order.version);setOpen(true);}}>{saved|| (editable?'Добавить комментарий':'—')}</button><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Комментарий логиста</DialogTitle><DialogDescription>{order.id}</DialogDescription></DialogHeader>{editable?<><textarea aria-label="Комментарий логиста" rows={6} maxLength={3000} value={text} disabled={busy} onChange={e=>setText(e.target.value)}/><button type="button" className="primary" disabled={busy||text.trim()===saved.trim()} onClick={async()=>{if(await mutate({action:'updateLogisticComment',id:order.id,version,text}))setOpen(false);}}>Сохранить комментарий</button></>:<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{saved||'Комментария пока нет'}</p>}</DialogContent></Dialog></>;
}

'use client';
import {ConfirmationReview} from './confirmation-review';
import {useState} from 'react';
import {headConfirmationTarget,canHeadRequestEdit} from '@/lib/head-confirmation';
import {isDepartmentOrder} from '@/lib/department-orders';
import type {Order,Employee} from '@/lib/crm';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export function HeadConfirmButton({order,name,employee,staff,busy,mutate}:{order:Order;name:string;employee:Employee;staff:Employee[];busy:boolean;mutate:(data:Record<string,unknown>)=>Promise<boolean>}){
 const [open,setOpen]=useState(false);
 const to=headConfirmationTarget(order);
 if(!isDepartmentOrder(employee,order,staff)||!to)return null;
 return <><button type="button" className="primary" disabled={busy} onClick={()=>setOpen(true)}>Подтвердить заказ</button>
  {open&&<ConfirmationReview key={JSON.stringify([order.id,order.version,name,to])} order={order} name={name} to={to} head busy={busy} onCancel={()=>setOpen(false)}
   onSubmit={fields=>mutate({action:'confirmByHead',id:order.id,version:order.version,...fields})}/>}</>;
}

export function HeadEditButton({order,employee,staff,busy,mutate}:{order:Order;employee:Employee;staff:Employee[];busy:boolean;mutate:(data:Record<string,unknown>)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[reason,setReason]=useState('');
 if(!canHeadRequestEdit(employee,order,staff))return null;
 return <><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(true)}>Запросить изменения у логиста</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Запрос изменений</DialogTitle><DialogDescription>Логист рассмотрит запрос и вернёт заказ для исправлений.</DialogDescription></DialogHeader><label className="field"><span>Что нужно изменить</span><textarea maxLength={1900} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="action-buttons"><button type="button" className="primary" disabled={busy||!reason.trim()} onClick={async()=>{if(await mutate({action:'requestOrderEdit',id:order.id,version:order.version,reason}))setOpen(false);}}>Отправить логисту</button><button type="button" className="secondary" onClick={()=>setOpen(false)}>Отмена</button></div></DialogContent></Dialog></>;
}

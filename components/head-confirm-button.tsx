'use client';
import {useState} from 'react';
import {headConfirmationTarget,canHeadRequestEdit} from '@/lib/head-confirmation';
import {isDepartmentOrder} from '@/lib/department-orders';
import type {Order,Employee} from '@/lib/crm';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export function HeadConfirmButton({order,employee,staff,busy,mutate}:{order:Order;employee:Employee;staff:Employee[];busy:boolean;mutate:(data:Record<string,unknown>)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[corrected,setCorrected]=useState(false),[agreed,setAgreed]=useState(false);
 if(!isDepartmentOrder(employee,order,staff)||!headConfirmationTarget(order))return null;
 const returned=order.status==='rework';
 return <><button type="button" className="primary" disabled={busy} onClick={()=>{setCorrected(false);setAgreed(false);setOpen(true);}}>Подтвердить заказ</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Подтвердить заказ</DialogTitle><DialogDescription>Заказ перейдёт на следующий этап без повторного подтверждения логистом. СДЭК после возврата сначала поступит на проверку администратору.</DialogDescription></DialogHeader><div className="stack">{returned&&<><p><strong>Замечания логиста:</strong> {order.returnReason||order.reason||order.editRequest?.reason||'Не указаны'}</p><label><input type="checkbox" checked={corrected} onChange={e=>setCorrected(e.target.checked)}/> Замечания логиста исправлены</label></>}<label><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/> Я связался с клиентом, клиент согласен выкупить заказ</label><div className="action-buttons"><button type="button" className="primary" disabled={busy||!agreed||returned&&!corrected} onClick={async()=>{if(await mutate({action:'confirmByHead',id:order.id,version:order.version,clientConfirmed:agreed,correctionsConfirmed:corrected}))setOpen(false);}}>Подтвердить</button><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Отмена</button></div></div></DialogContent></Dialog></>;
}

export function HeadEditButton({order,employee,staff,busy,mutate}:{order:Order;employee:Employee;staff:Employee[];busy:boolean;mutate:(data:Record<string,unknown>)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[reason,setReason]=useState('');
 if(!canHeadRequestEdit(employee,order,staff))return null;
 return <><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(true)}>Запросить изменения у логиста</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Запрос изменений</DialogTitle><DialogDescription>Логист рассмотрит запрос и вернёт заказ для исправлений.</DialogDescription></DialogHeader><label className="field"><span>Что нужно изменить</span><textarea maxLength={1900} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="action-buttons"><button type="button" className="primary" disabled={busy||!reason.trim()} onClick={async()=>{if(await mutate({action:'requestOrderEdit',id:order.id,version:order.version,reason}))setOpen(false);}}>Отправить логисту</button><button type="button" className="secondary" onClick={()=>setOpen(false)}>Отмена</button></div></DialogContent></Dialog></>;
}

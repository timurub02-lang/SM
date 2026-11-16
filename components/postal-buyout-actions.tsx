'use client';
import {useState} from 'react';
import {mayReportPostalBuyout,postalBuyoutPending} from '@/lib/postal-buyout-report';
import {stamp,type Order,type Employee} from '@/lib/crm';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export function PostalBuyoutActions({order:o,employee,staff,busy,mutate}:{order:Order;employee:Employee;staff:Employee[];busy:boolean;mutate:(p:Record<string,unknown>)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[version,setVersion]=useState(o.version);
 const pending=postalBuyoutPending(o),report=mayReportPostalBuyout(o,employee,staff),logistic=['admin','logistic','chief_logistic'].includes(employee.role);
 if(!report&&!(pending&&logistic))return null;
 return <><div className="order-quick-bar"><div className="order-quick-buttons">{report&&<button type="button" className="primary" disabled={busy||pending} onClick={()=>{setVersion(o.version);setOpen(true);}}>{pending?'Выкуп передан на проверку':'Клиент выкупил заказ'}</button>}{pending&&logistic&&<button type="button" className="secondary" disabled={busy} onClick={()=>void mutate({action:'keepPostalSent',id:o.id,version:o.version})}>Оставить в отправленных</button>}</div></div><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Клиент выкупил заказ</DialogTitle><DialogDescription>{o.id}</DialogDescription></DialogHeader><p>Передать логистам сообщение о выкупе? Заказ останется в отправленных до проверки логистом.</p><button type="button" className="primary" disabled={busy} onClick={async()=>{if(await mutate({action:'reportPostalBuyout',id:o.id,version}))setOpen(false);}}>Сообщить логисту</button></DialogContent></Dialog></>;
}
export function PostalBuyoutNotice({order:o}:{order:Order}){
 const r=o.postalBuyoutReport;if(!r)return null;
 return <section className={postalBuyoutPending(o)?'notice postal-buyout-notice':'notice'}><div><strong>{postalBuyoutPending(o)?'Клиент выкупил заказ — требуется проверка логистом':r.status==='sent'?'Сообщение о выкупе проверено — оставлен в отправленных':r.status==='paid'?'Выкуп подтверждён логистом':'По результату проверки отмечен возврат'}</strong><p>{r.name} · {stamp(r.at,'Europe/Moscow')} МСК</p>{r.decidedAt&&<small>{r.decidedName} · {stamp(r.decidedAt,'Europe/Moscow')} МСК</small>}</div></section>;
}

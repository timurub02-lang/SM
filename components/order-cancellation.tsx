'use client';
import {useState} from 'react';
import {stamp,type Employee,type Order} from '@/lib/crm';
import {cancellationBlockReason} from '@/lib/order-cancellation';
export function OrderCancellationNotice({order,employee,busy,mutate}:{order:Order;employee:Employee;busy:boolean;mutate:(data:Record<string,unknown>)=>Promise<boolean>}){
 const [reason,setReason]=useState(''),r=order.cancellationRequest;if(!r)return null;
 const canDecide=r.status==='pending'&&['admin','logistic','chief_logistic'].includes(employee.role),blocked=cancellationBlockReason(order);
 const decide=(decision:'cancel'|'reject')=>void mutate({action:'resolveOrderCancellation',id:order.id,version:order.version,requestId:r.id,decision,reason});
 return <section className="notice amber stack" aria-label="Запрос на отмену"><strong>{r.status==='pending'?'Клиент просит отменить заказ · запрос передан логисту':r.status==='cancelled'?'Заказ отменён по просьбе клиента':'Запрос на отмену отклонён'}</strong><p>{r.reason}</p><small>{r.name} · {stamp(r.at,'Europe/Moscow')} МСК</small>{r.decidedName&&<p>{r.decidedName} · {stamp(r.decidedAt||r.at,'Europe/Moscow')} МСК{r.decisionReason?' · '+r.decisionReason:''}</p>}{canDecide&&<>{blocked&&<p>{blocked}</p>}<label className="field"><span>Комментарий к решению (обязателен при отклонении)</span><textarea value={reason} maxLength={1900} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><div className="action-buttons"><button type="button" className="primary" disabled={busy||!!blocked} onClick={()=>decide('cancel')}>Подтвердить отмену заказа</button><button type="button" className="secondary" disabled={busy||!reason.trim()} onClick={()=>decide('reject')}>Отклонить запрос</button></div></>}</section>;
}

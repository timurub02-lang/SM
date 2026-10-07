'use client';
import {useState} from 'react';
import {stamp,money,type Order,type Employee} from '@/lib/crm';
import {courierLabel,courierPhase,courierDeadline,courierTimeLeft,courierWaitingSince,courierStage} from '@/lib/courier';

export function CourierWork({order:o,employee,busy,mutate}:{order:Order;employee:Employee;busy:boolean;mutate:(p:Record<string,unknown>)=>Promise<boolean>}){
 const [reason,setReason]=useState('');
 if(!o.courier)return null;
 const c=o.courier,phase=courierPhase(o),deadline=courierDeadline(o),stage=courierStage(o);
 const logistics=['admin','logistic','chief_logistic'].includes(employee.role)&&phase==='logistic'&&stage==='waiting';
 const operator=(employee.role==='admin'||employee.role==='operator'&&o.manager===employee.id)&&phase==='operator'&&o.status==='rework';
 const act=(operation:string)=>void mutate({action:'courierWorkflow',operation,id:o.id,version:o.version,reason});
 return <section className="notice stack courier-work-panel"><strong>{courierLabel(o)}</strong><p>Курьер: {c.name} · {money(c.amount)}<br/>Передан: {stamp(c.assignedAt,'Europe/Moscow')} МСК</p>
 {!c.acceptedAt?<p>Ожидает приёма: {courierWaitingSince(o)}. {c.phase==='pending'?'Таймер подтверждения начнётся после фактического приёма посылки.':'Заказ уже подтверждён; после приёма курьер продолжит доставку.'}</p>:<p>Посылка принята: {stamp(c.acceptedAt,'Europe/Moscow')} МСК. {stage==='settled'?'Расчёт завершён.':'Физическая посылка остаётся под отчётом курьера до сдачи денег или приёма возврата на склад.'}</p>}
 {deadline&&<p>До возврата оператору: <b>{courierTimeLeft(deadline)}</b> · {stamp(deadline,'Europe/Moscow')} МСК. Недозвон и перезвон срок не продлевают.</p>}
 {c.workReason&&['operator','logistic'].includes(phase||'')&&<p><b>Причина передачи:</b> {c.workReason}</p>}
 {c.operatorBudgetMs!==undefined&&<p>Общий запас доработки у оператора: <b>{c.operatorBudgetMs===null?'без ограничения':courierTimeLeft(o.reworkDeadline||new Date(Date.now()+c.operatorBudgetMs).toISOString())}</b>. {phase==='operator'?'Сейчас расходуется.':'Сейчас приостановлен.'} Повторная передача не восстанавливает запас.</p>}
 {c.postponement&&<div className="stack"><p><b>{c.postponement.state==='pending'?'Запрошен перенос доставки':c.postponement.state==='approved'?'Доставка согласована':'Перенос отклонён'}:</b> {stamp(c.postponement.at,'Europe/Moscow')} МСК<br/>{c.postponement.reason}{c.postponement.name&&<><br/>Решение: {c.postponement.name} · {stamp(c.postponement.decidedAt!,'Europe/Moscow')}</>}</p>
 {logistics&&c.postponement.state==='pending'&&<><p>Согласование подтверждает заказ и завершает таймер этого этапа. Курьер продолжит доставку в выбранное время.</p><div className="action-buttons"><button className="primary" disabled={busy} onClick={()=>act('approvePostpone')}>Согласовать доставку</button><button className="secondary" disabled={busy||!reason.trim()} onClick={()=>act('rejectPostpone')}>Отклонить перенос</button></div></>}
 </div>}
 {logistics&&<><label className="field"><span>Причина передачи оператору / отказа в переносе</span><textarea rows={2} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder="Что нужно уточнить у клиента"/></label><div className="action-buttons"><button className="primary" disabled={busy||c.postponement?.state==='pending'} onClick={()=>act('confirm')}>Подтверждено — передать курьеру</button><button className="secondary" disabled={busy||!reason.trim()} onClick={()=>act('toOperator')}>Передать в работу оператору</button></div></>}
 {operator&&<><p>После подтверждения курьер получит сообщение «Клиент готов выкупить заказ». Повторное подтверждение и физический приём этой же посылки не потребуются.</p><button className="primary" disabled={busy} onClick={()=>act('confirm')}>Вернуть курьеру — клиент готов выкупить</button></>}
 </section>;
}

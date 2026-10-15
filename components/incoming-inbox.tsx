'use client';
import {useState} from 'react';
import {departments,stamp,type Client,type Employee,type IncomingRequest} from '@/lib/crm';
import {canOpenClientCard} from '@/lib/permissions';
import {CallButton} from './browser-phone';

export function IncomingResult({item,busy,onSave}:{item:IncomingRequest;busy:boolean;onSave:(reason:string)=>Promise<boolean>}){
 const [reason,setReason]=useState('');
 return <form className="notice stack incoming-result" onSubmit={async e=>{e.preventDefault();if(reason.trim()&&await onSave(reason.trim()))setReason('');}}>
  <strong>Итог входящего обращения · {stamp(item.at,'Europe/Moscow')} МСК</strong>
  <label className="field"><span>Результат / причина закрытия *</span><textarea required maxLength={2000} rows={2} placeholder="Напишите, чем закончилось обращение клиента" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
  <button type="submit" className="primary" disabled={busy||!reason.trim()}>Сохранить итог и закрыть обращение</button>
 </form>;
}
export function IncomingInbox({items,clients,employees,employee,busy,onAssign,onOpenClient,onOpen,onClose}:{items:IncomingRequest[];clients:Client[];employees:Pick<Employee,"id"|"name"|"department">[];onAssign:(incomingId:string,operatorId:string)=>Promise<boolean>;employee:Employee;busy:boolean;onOpenClient:(clientId:string)=>void;onOpen:(orderId:string,incomingId:string)=>void;onClose:(id:string,reason:string)=>Promise<boolean>}){
 const [selectedDepartments,setSelectedDepartments]=useState<Record<string,string>>({});
 const [assignments,setAssignments]=useState<Record<string,string>>({});
 const [history,setHistory]=useState(false),[scope,setScope]=useState('all');
 const scopes=employee.role==='department_head'?[['all','Все доступные'],['mine','Мои'],['department','Мой отдел'],['unknown','Неизвестные клиенты']]:employee.role==='admin'?[['all','Все обращения'],['unknown','Неизвестные клиенты']]:[];
 const scoped=items.filter(i=>scope==='all'||scope==='mine'&&i.assigneeId===employee.id||scope==='unknown'&&!i.clientId||scope==='department'&&!!i.clientId&&i.assigneeId!==employee.id);
 const shown=scoped.filter(i=>!!i.closedAt===history);
 return <div className="stack">
  <p className="muted">Клиенту сообщили, что ему перезвонят. Обращение остаётся открытым до сохранения результата. Время московское.</p>
  <div className="incoming-filters">
  {!!scopes.length&&<label className="incoming-scope"><span>Обращения</span><select aria-label="Категория входящих обращений" value={scope} onChange={e=>setScope(e.target.value)}>{scopes.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
  <div className="notification-tabs"><button className="secondary" aria-pressed={!history} onClick={()=>setHistory(false)}>Требуют действия · {scoped.filter(i=>!i.closedAt).length}</button><button className="secondary" aria-pressed={history} onClick={()=>setHistory(true)}>Закрытые</button></div>
  </div>
  {shown.map(item=><section className="notice stack incoming-card" key={item.id}>
   <strong>{item.clientName||'Неизвестный клиент'}{item.phone?' · '+item.phone:''}</strong>
   <span>Входящий: {stamp(item.at,'Europe/Moscow')} МСК{item.calledNumber?' · На номер '+item.calledNumber:''}</span>
   <span>{item.assigneeName}</span>
   {item.clientId&&canOpenClientCard(employee,clients.find(c=>c.id===item.clientId))&&<div className="action-buttons">
    <button type="button" className="secondary" disabled={busy} onClick={()=>onOpenClient(item.clientId!)}>Карточка клиента</button>
    <CallButton target={{mode:'client',clientId:item.clientId}} disabled={busy}>Перезвонить</CallButton>
   </div>}
   {item.sharedQueue&&!item.closedAt&&item.clientId&&['admin','department_head'].includes(employee.role)&&<div className="action-buttons">
    <label className="field"><span>Отдел</span><select aria-label="Отдел оператора обращения" value={selectedDepartments[item.id]||''} disabled={busy} onChange={e=>{setSelectedDepartments({...selectedDepartments,[item.id]:e.target.value});setAssignments({...assignments,[item.id]:''});}}><option value="">Выберите отдел</option>{Object.entries(departments).map(([id,name])=><option key={id} value={id}>{name.replace(/_$/,'')}</option>)}{employees.some(e=>!e.department)&&<option value="none">Без отдела</option>}</select></label>
    <label className="field"><span>Назначить ответственного оператора</span><select aria-label="Ответственный оператор обращения" value={assignments[item.id]||''} disabled={busy||!selectedDepartments[item.id]} onChange={e=>setAssignments({...assignments,[item.id]:e.target.value})}><option value="">Выберите оператора</option>{employees.filter(e=>(e.department||'none')===selectedDepartments[item.id]).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <button type="button" className="primary incoming-assign-button" disabled={busy||!assignments[item.id]} onClick={()=>void onAssign(item.id,assignments[item.id])}>Передать оператору</button>
    <small>Обращение и клиент будут переданы оператору для дальнейшей работы и оформления заказа.</small>
   </div>}
   {item.closedAt?<><span>Закрыто: {stamp(item.closedAt,'Europe/Moscow')} МСК · {item.closedBy}</span><p>{item.reason}</p></>:<>
    {item.hasActiveOrder?<><span>Действующие заказы</span><div className="action-buttons">{item.orderIds?.map(id=><button className="primary" key={id} onClick={()=>onOpen(id,item.id)}>Открыть {id}</button>)}</div>{!item.orderIds?.length&&<p>Заказ недоступен вашей роли. Обратитесь к администратору.</p>}</>:<><span>Действующего заказа нет</span><IncomingResult item={item} busy={busy} onSave={reason=>onClose(item.id,reason)}/></>}
   </>}
  </section>)}
  {!shown.length&&<p className="muted">{history?'Закрытых обращений пока нет.':'Нет обращений, требующих действия.'}</p>}
  {history&&<small className="muted">Показаны последние 50 закрытых обращений, доступных вам.</small>}
 </div>;
}

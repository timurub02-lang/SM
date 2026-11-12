'use client';
import {OperatorSelect} from './operator-select';
import {useState} from 'react';
import {initials,stamp,type Client,type Employee,type IncomingRequest} from '@/lib/crm';
import {PhoneIncoming,ChevronRight} from 'lucide-react';
import {canOpenClientCard} from '@/lib/permissions';
import {CallButton} from './browser-phone';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {IncomingClientLink} from './incoming-client-link';

export function IncomingResult({item,busy,onSave,onRequestCancellation}:{item:IncomingRequest;busy:boolean;onRequestCancellation?:(reason:string)=>Promise<boolean>;onSave:(reason:string)=>Promise<boolean>}){
 const [reason,setReason]=useState('');
 return <form className="notice stack incoming-result" onSubmit={async e=>{e.preventDefault();if(reason.trim()&&await onSave(reason.trim()))setReason('');}}>
  <strong>Итог входящего обращения · {stamp(item.at,'Europe/Moscow')} МСК</strong>
  <label className="field"><span>Результат / причина закрытия *</span><textarea required maxLength={1900} rows={2} placeholder="Напишите, чем закончилось обращение клиента" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
  <button type="submit" className="primary" disabled={busy||!reason.trim()}>Сохранить итог и закрыть обращение</button>{onRequestCancellation&&<button type="button" className="secondary" disabled={busy||!reason.trim()} onClick={()=>void onRequestCancellation(reason.trim())}>Клиент просит отменить заказ</button>}
 </form>;
}
export function IncomingHandoffNote({item}:{item:IncomingRequest}){
 if(!item.handoff)return null;
 return <div className="notice stack"><strong>Комментарий при передаче · {item.handoff.name}</strong><small>{stamp(item.handoff.at,'Europe/Moscow')} МСК</small><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.handoff.comment}</p></div>;
}
export function IncomingTransfer({item,employee,operators,busy,onTransfer}:{item:IncomingRequest;employee:Employee;operators:Pick<Employee,'id'|'name'|'department'|'login'>[];busy:boolean;onTransfer:(incomingId:string,operatorId:string,comment:string)=>Promise<boolean>}){
 const [operator,setOperator]=useState(operators.some(e=>e.id===item.assigneeId)?item.assigneeId||'':''),[comment,setComment]=useState('');
 if(!['admin','department_head'].includes(employee.role)||item.closedAt||item.spam)return null;
 return <form className="notice stack incoming-transfer" onSubmit={async e=>{e.preventDefault();if(operator&&comment.trim()&&await onTransfer(item.id,operator,comment.trim()))setComment('');}}>
  <strong>Передать входящее оператору</strong>
  <OperatorSelect label="Оператор для передачи входящего" required disabled={busy} operators={operators} value={operator} onChange={setOperator}/>
  <label className="field"><span>Комментарий оператору *</span><textarea required maxLength={1900} rows={3} disabled={busy} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Что выяснили в разговоре и что нужно сделать оператору"/></label>
  <button type="submit" className="primary" disabled={busy||!operator||!comment.trim()}>Передать входящее с комментарием</button>
 </form>;
}
export function IncomingInbox({items,clients,employees,employee,busy,onReload,onCreate,onLink,onTransfer,onOpenClient,onOpen,onClose}:{items:IncomingRequest[];onReload:()=>Promise<unknown>;clients:Client[];employees:Pick<Employee,"id"|"name"|"department"|"login">[];onCreate:(incomingId:string,name:string,operatorId:string,baseType:string)=>Promise<boolean>;onLink:(incomingId:string,clientId:string)=>Promise<boolean>;onTransfer:(incomingId:string,operatorId:string,comment:string)=>Promise<boolean>;employee:Employee;busy:boolean;onOpenClient:(clientId:string,incomingId?:string)=>void;onOpen:(orderId:string,incomingId:string)=>void;onClose:(id:string,reason:string,orderId?:string)=>Promise<boolean>}){
 const [resultId,setResultId]=useState(''),[resultOrder,setResultOrder]=useState('');
 const resultItem=items.find(i=>i.id===resultId&&!i.closedAt);
 function afterCall(item:IncomingRequest){setResultId(item.id);setResultOrder(item.orderIds?.length===1?item.orderIds[0]:'');void onReload();}
 const [tab,setTab]=useState('known');
 const [protecting,setProtecting]=useState(false),[protectionError,setProtectionError]=useState(''),[settings,setSettings]=useState<any>(null),[confirmBlock,setConfirmBlock]=useState('');
 async function protection(payload:any){setProtecting(true);setProtectionError('');try{const r=await fetch('/api/incoming-protection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json() as any;if(!r.ok)throw Error(data.error);setConfirmBlock('');await onReload();return true;}catch(e){setProtectionError(e instanceof Error?e.message:'Не удалось сохранить');return false;}finally{setProtecting(false);}}
 async function openProtection(){setProtectionError('');try{const r=await fetch('/api/incoming-protection');const data=await r.json() as any;if(!r.ok)throw Error(data.error);setSettings(data);}catch(e){setProtectionError(e instanceof Error?e.message:'Ошибка загрузки');}}
 const history=tab==='closed';
 const sharedCallback=(item:IncomingRequest)=>!!item.sharedQueue&&!item.closedAt&&!item.hasActiveOrder&&['admin','department_head'].includes(employee.role);
 const delegated=(item:IncomingRequest)=>employee.role==='operator'&&item.assigneeId===employee.id&&!!item.handoff;

 const shown=items.filter(i=>tab==='spam'?i.spam:!i.spam&&(tab==='closed'?!!i.closedAt:!i.closedAt&&(tab==='mine'?i.assigneeId===employee.id:tab==='known'?!!i.clientId:!i.clientId))).sort((a,b)=>Number(!!b.hasActiveOrder)-Number(!!a.hasActiveOrder));
 return <div className="stack">
 <Dialog open={!!resultItem} onOpenChange={open=>{if(!open)setResultId('');}}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Итог входящего обращения</DialogTitle><DialogDescription>Зафиксируйте результат разговора. Без сохранения обращение останется открытым.</DialogDescription></DialogHeader>{resultItem&&<IncomingHandoffNote item={resultItem}/>} {resultItem&&(resultItem.hasActiveOrder&&!delegated(resultItem)?<div className="stack"><label className="field"><span>Заказ, к которому относится обращение</span><select value={resultOrder} onChange={e=>setResultOrder(e.target.value)}><option value="">Выберите заказ</option>{resultItem.orderIds?.map(id=><option key={id} value={id}>{id}</option>)}</select></label><button className="primary" disabled={!resultOrder||busy} onClick={()=>{setResultId('');onOpen(resultOrder,resultItem.id);}}>Перейти к итогу по заказу</button></div>:<IncomingResult item={resultItem} busy={busy} onSave={async reason=>{const ok=await onClose(resultItem.id,reason);if(ok)setResultId('');return ok;}}/>) }{resultItem&&<IncomingTransfer key={resultItem.id} item={resultItem} employee={employee} operators={employees} busy={busy} onTransfer={async(id,operatorId,comment)=>{const ok=await onTransfer(id,operatorId,comment);if(ok)setResultId('');return ok;}}/>}</DialogContent></Dialog>
  <p className="muted">Клиенту сообщили, что ему перезвонят. Обращение остаётся открытым до сохранения результата. Время московское.</p>
  <div className="incoming-filters">
  <div className="tabs-line incoming-tabs" role="group" aria-label="Фильтры входящих обращений">
   {[...(employee.role==='department_head'?[{id:'mine',label:'Мои',count:items.filter(i=>!i.spam&&!i.closedAt&&i.assigneeId===employee.id).length}]:[]),{id:'known',label:'Наши клиенты',count:items.filter(i=>!i.spam&&!i.closedAt&&!!i.clientId).length},{id:'unknown',label:'Неизвестные клиенты',count:items.filter(i=>!i.spam&&!i.closedAt&&!i.clientId).length},...(employee.role==='admin'?[{id:'spam',label:'Возможный спам',count:items.filter(i=>i.spam).length}]:[]),{id:'closed',label:'Закрытые',count:items.filter(i=>!i.spam&&!!i.closedAt).length}].map(t=><button type="button" key={t.id} data-state={tab===t.id?'active':'inactive'} aria-pressed={tab===t.id} onClick={()=>setTab(t.id)}>{t.label} · {t.count}</button>)}
  </div>
  </div>
  {employee.role==='admin'&&<button className="secondary" type="button" onClick={()=>void openProtection()}>Защита от спама</button>}
  {protectionError&&<p role="alert">{protectionError}</p>}
  {settings&&<div className="notice stack">
   <strong>Защита входящих</strong>
   <p>Каждый неизвестный номер должен нажать 1. Известные клиенты проходят без проверки, кроме заблокированных номеров.</p>
   <p>Без нажатия 1 обращение не создаётся: попытка остаётся в техническом журнале. Повторные подтверждённые звонки объединяются в открытое обращение. После закрытия создаётся новое.</p>
   <button className="secondary" type="button" onClick={()=>setSettings(null)}>Закрыть</button>
  </div>}
  {tab==='spam'&&<p className="muted">Последние 100 обращений, отмеченных как спам. «Вернуть в работу» восстановит обращение, но неизвестному номеру при следующем звонке всё равно нужно нажать 1.</p>}
  <div className="incoming-card-grid">{shown.map(item=><details className={'incoming-card'+(item.hasActiveOrder?' incoming-card-has-order':'')} key={item.id}>
   <summary className="incoming-card-summary">
    <div className="incoming-card-top"><span>Входящий · {new Date(item.at).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}</span><PhoneIncoming size={20}/></div>
    <div className="incoming-card-person"><span className="avatar">{item.clientId?initials(item.clientName||'Клиент'):'?'}</span><strong>{item.clientName||'Неизвестный клиент'}</strong></div>
    <p className="incoming-card-contact">{item.phone||'Номер скрыт'} · {item.clientId?'Наш клиент':'Неизвестный клиент'}</p>
    <div className="incoming-card-order-label">{item.hasActiveOrder?'Есть действующий заказ':'Без действующего заказа'}</div>
    <div className="incoming-card-stats"><div><strong>{item.callCount||1}</strong><span>звонков</span></div>{[[item.at,'первый звонок'],[item.lastAt||item.at,'последний звонок']].map(([at,label])=><div key={label} title={stamp(at,'Europe/Moscow')+' МСК'}><strong>{new Date(at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})}</strong><span>{label}</span></div>)}</div>
    <div className="incoming-card-status"><span className={'badge '+(item.spam?'rose':item.closedAt?'mint':'amber')}>{item.spam?'Возможный спам':item.closedAt?'Закрыто':'Требует действия'}</span><ChevronRight size={22}/></div>
    <div className="incoming-card-footer"><span>Ответственный</span><strong>{item.assigneeName||'Не назначен'}</strong></div>
   </summary>
   <div className="incoming-card-body stack"><IncomingHandoffNote item={item}/>
   <div className="incoming-client-heading">{!item.spam&&!item.clientId&&!item.closedAt&&['admin','department_head'].includes(employee.role)&&<IncomingClientLink incomingId={item.id} phone={item.phone} busy={busy} employees={employees} onCreate={(name,operatorId,baseType)=>onCreate(item.id,name,operatorId,baseType)} onLink={clientId=>onLink(item.id,clientId)}/>}</div>
   {item.calledNumber&&<small className="muted">На номер {item.calledNumber}</small>}
   {item.spam&&<p>{item.spamReason}{item.blocked?' · Номер заблокирован':''}</p>}
   {employee.role==='admin'&&<div className="action-buttons">
    {item.spam&&!item.closedAt&&<button className="primary" disabled={protecting||busy||!item.phone} onClick={()=>void protection({id:item.id,operation:'restore'})}>Вернуть в работу</button>}
    {!item.spam&&!item.closedAt&&<button className="secondary" disabled={protecting||busy} onClick={()=>void protection({id:item.id,operation:'spam'})}>Возможный спам</button>}
    {item.blocked?<button className="secondary" disabled={protecting||busy} onClick={()=>void protection({id:item.id,operation:'unblock'})}>Снять блокировку</button>:<button className="secondary" disabled={protecting||busy||!item.phone} onClick={()=>setConfirmBlock(item.id)}>Заблокировать номер</button>}
    {confirmBlock===item.id&&<div role="alert"><p>Звонки с этого номера будут завершаться без соединения и сохраняться в спаме. Заблокировать?</p><button className="primary" disabled={protecting} onClick={()=>void protection({id:item.id,operation:'block'})}>Подтвердить блокировку</button><button className="secondary" onClick={()=>setConfirmBlock('')}>Отмена</button></div>}
   </div>}

   {!item.spam&&!item.closedAt&&(!item.clientId||delegated(item)||sharedCallback(item))&&(['admin','department_head'].includes(employee.role)||employee.role==='operator'&&item.assigneeId===employee.id)&&<CallButton client={clients.find(c=>c.id===item.clientId)} target={{mode:'incoming',incomingId:item.id}} onCompleted={()=>afterCall(item)} disabled={busy}>Перезвонить</CallButton>}
   {!item.spam&&item.clientId&&canOpenClientCard(employee,clients.find(c=>c.id===item.clientId))&&<div className="action-buttons">
    <button type="button" className="secondary" disabled={busy} onClick={()=>onOpenClient(item.clientId!,item.closedAt?undefined:item.id)}>Карточка клиента</button>
    {!item.hasActiveOrder&&!delegated(item)&&!sharedCallback(item)&&<CallButton client={clients.find(c=>c.id===item.clientId)} target={{mode:'client',clientId:item.clientId}} onCompleted={()=>afterCall(item)} disabled={busy}>Перезвонить</CallButton>}
   </div>}
   {!item.closedAt&&!item.spam&&['admin','department_head'].includes(employee.role)&&<details className="incoming-transfer-fold"><summary>Передать оператору</summary><IncomingTransfer item={item} employee={employee} operators={employees} busy={busy} onTransfer={onTransfer}/></details>}
   {!item.spam&&(item.closedAt?<><span>Закрыто: {stamp(item.closedAt,'Europe/Moscow')} МСК · {item.closedBy}</span><p>{item.reason}</p></>:<>
    {item.hasActiveOrder&&!delegated(item)?<><span>Действующие заказы</span><div className="action-buttons">{item.orderIds?.map(id=><button className="primary" key={id} onClick={()=>onOpen(id,item.id)}>Открыть {id}</button>)}</div>{!item.orderIds?.length&&<p>Заказ недоступен вашей роли. Обратитесь к администратору.</p>}</>:<><span>{item.hasActiveOrder?'Переданное входящее обращение':'Действующего заказа нет'}</span><IncomingResult item={item} busy={busy} onSave={reason=>onClose(item.id,reason)}/></>}
   </>)}
   </div>
  </details>)}</div>
  {!shown.length&&<p className="muted">{history?'Закрытых обращений пока нет.':'Нет обращений, требующих действия.'}</p>}
  {history&&<small className="muted">Показаны последние 50 закрытых обращений, доступных вам.</small>}
 </div>;
}

export function IncomingConsultation({item,busy,onSave}:{item:IncomingRequest;busy:boolean;onSave:(reason:string,orderId?:string)=>Promise<boolean>}){
 const [orderId,setOrderId]=useState(item.orderIds?.length===1?item.orderIds[0]:'');
 return <section className="stack"><h3>Итог входящего обращения · консультация</h3><p>Ответили на вопросы клиента? Сохраните итог здесь. Результат и дата в проекте «Выкуп» не изменятся.</p>{item.hasActiveOrder&&<label className="field"><span>К какому заказу относится обращение</span><select value={orderId} onChange={e=>setOrderId(e.target.value)} disabled={busy}><option value="">Выберите заказ</option>{item.orderIds?.map(id=><option key={id} value={id}>{id}</option>)}</select></label>}<IncomingResult item={item} busy={busy||!!item.hasActiveOrder&&!orderId} onSave={reason=>onSave('Консультация: '+reason,orderId||undefined)}/></section>;
}

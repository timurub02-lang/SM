'use client';
import {incomingIsMissed} from '@/lib/incoming-status';
import {canTransferIncoming,incomingTransferLabel} from '@/lib/incoming-transfer';
import {IncomingOrderActions,type IncomingAction} from './incoming-order-actions';
import {OperatorSelect} from './operator-select';
import {useRef,useState} from 'react';
import {initials,stamp,hideClientPhone,type Client,type Employee,type IncomingRequest} from '@/lib/crm';
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
 return <div className="notice stack incoming-handoff-note"><strong>Комментарий при передаче · {item.handoff.name}</strong><small>{stamp(item.handoff.at,'Europe/Moscow')} МСК</small><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.handoff.comment}</p>{item.handoff.ownerSync&&<small>Автоматически передано владельцу клиента · {stamp(item.handoff.ownerSync.at,'Europe/Moscow')} МСК</small>}</div>;
}
export function IncomingTransfer({item,employee,operators,busy,onTransfer}:{item:IncomingRequest;employee:Employee;operators:Pick<Employee,'id'|'name'|'department'|'login'>[];busy:boolean;onTransfer:(incomingId:string,operatorId:string,comment:string)=>Promise<boolean>}){
 const [operator,setOperator]=useState(operators.some(e=>e.id===item.clientOwnerId)?item.clientOwnerId||'':operators.some(e=>e.id===item.assigneeId)?item.assigneeId||'':''),[comment,setComment]=useState('');
 if(!canTransferIncoming(employee,item))return null;
 return <form className="notice stack incoming-transfer" onSubmit={async e=>{e.preventDefault();if(operator&&comment.trim()&&await onTransfer(item.id,operator,comment.trim()))setComment('');}}>
  <strong>{incomingTransferLabel(employee,item)}</strong>
  <OperatorSelect groupByDepartment label="Оператор для передачи входящего" required disabled={busy} operators={employee.role==='department_head'&&item.clientOwnerId?operators.filter(e=>e.id===item.clientOwnerId):operators} value={operator} onChange={setOperator}/>
  <label className="field"><span>Комментарий оператору *</span><textarea required maxLength={1900} rows={3} disabled={busy} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Что выяснили в разговоре и что нужно сделать оператору"/></label>
  <button type="submit" className="primary" disabled={busy||!operator||!comment.trim()}>Передать входящее с комментарием</button>
 </form>;
}
export function IncomingInbox({now=Date.now(),onMissed,items,clients,employees,employee,busy,onReload,onCreate,onLink,onTransfer,onOpenClient,onOpen,onClose,onRequest,onNewOrder}:{now?:number;onMissed:(id:string,callId?:string)=>Promise<boolean>;items:IncomingRequest[];onRequest:(incomingId:string,action:IncomingAction,reason:string,orderId?:string,info?:{mode:'date'|'comment';date?:string})=>Promise<boolean>;onNewOrder:(item:IncomingRequest)=>void;onReload:()=>Promise<unknown>;clients:Client[];employees:Pick<Employee,"id"|"name"|"department"|"login">[];onCreate:(incomingId:string,name:string,operatorId:string,baseType:string)=>Promise<boolean>;onLink:(incomingId:string,clientId:string,lookupPhone:string)=>Promise<boolean>;onTransfer:(incomingId:string,operatorId:string,comment:string)=>Promise<boolean>;employee:Employee;busy:boolean;onOpenClient:(clientId:string,incomingId?:string)=>void;onOpen:(orderId:string,incomingId:string)=>void;onClose:(id:string,reason:string,orderId?:string)=>Promise<boolean>}){
 const [resultId,setResultId]=useState(''),[resultOrder,setResultOrder]=useState(''),[linkedIncoming,setLinkedIncoming]=useState('');
 const [historyId,setHistoryId]=useState('');
 const missedItem=items.find(item=>item.id===historyId);
 const calls=useRef(new Map<string,string>());
 async function saveMissed(id:string){
  const saved=await onMissed(id,calls.current.get(id));
  if(saved)calls.current.delete(id);
  return saved;
 }
 const resultItem=items.find(i=>i.id===resultId&&!i.closedAt);
 function afterCall(item:IncomingRequest){setResultId(item.id);setResultOrder(item.orderIds?.length===1?item.orderIds[0]:'');void onReload();}
 const [tab,setTab]=useState('known'),[missedTab,setMissedTab]=useState(false);
 const canSeeFree=['admin','department_head'].includes(employee.role);
 const free=(i:IncomingRequest)=>!!i.clientId&&!i.clientOwnerId&&!i.hasActiveOrder;
 const [protecting,setProtecting]=useState(false),[protectionError,setProtectionError]=useState(''),[settings,setSettings]=useState<any>(null),[confirmation,setConfirmation]=useState<{id:string;operation:'spam'|'block'}|null>(null);
 async function protection(payload:any){setProtecting(true);setProtectionError('');try{const r=await fetch('/api/incoming-protection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json() as any;if(!r.ok)throw Error(data.error);setConfirmation(null);await onReload();return true;}catch(e){setProtectionError(e instanceof Error?e.message:'Не удалось сохранить');return false;}finally{setProtecting(false);}}
 async function openProtection(){setProtectionError('');try{const r=await fetch('/api/incoming-protection');const data=await r.json() as any;if(!r.ok)throw Error(data.error);setSettings(data);}catch(e){setProtectionError(e instanceof Error?e.message:'Ошибка загрузки');}}
 const history=tab==='closed';
 const sharedCallback=(item:IncomingRequest)=>!!item.sharedQueue&&!item.closedAt&&!item.hasActiveOrder&&['admin','department_head'].includes(employee.role);
 const delegated=(item:IncomingRequest)=>employee.role==='operator'&&item.assigneeId===employee.id&&!!item.handoff;
 const assignedCallback=(item:IncomingRequest)=>
  (employee.role==='operator'&&item.assigneeId===employee.id)||
  (employee.role==='department_head'&&!!item.clientId&&!item.sharedQueue&&
   (item.hasActiveOrder||(!item.closedAt&&free(item))));

 const inCategory=(i:IncomingRequest,category:string)=>category==='spam'?!!i.spam:!i.spam&&(category==='closed'?!!i.closedAt:!i.closedAt&&(category==='mine'?i.assigneeId===employee.id:category==='free'?free(i):category==='known'?!!i.clientId&&(!canSeeFree||!free(i)):!i.clientId));
 const shown=items.filter(i=>inCategory(i,tab)&&(['closed','spam'].includes(tab)||incomingIsMissed(i,now)===missedTab)).sort((a,b)=>Number(!!b.hasActiveOrder)-Number(!!a.hasActiveOrder));
 const categories=[...(employee.role==='department_head'?[{id:'mine',label:'Мои'}]:[]),{id:'known',label:'Наши клиенты'},...(canSeeFree?[{id:'free',label:'Свободный клиент'}]:[]),{id:'unknown',label:'Неизвестные клиенты'},...(employee.role==='admin'?[{id:'spam',label:'Возможный спам'}]:[]),{id:'closed',label:'Закрытые'}];
 return <div className="stack">
 <Dialog open={!!missedItem} onOpenChange={open=>{if(!open)setHistoryId('');}}>
  <DialogContent className="form-dialog incoming-action-dialog"><DialogHeader>
   <DialogTitle>История недозвонов</DialogTitle><DialogDescription>{missedItem?.clientName||'Неизвестный клиент'}</DialogDescription>
  </DialogHeader>
  <ol className="incoming-miss-history">{missedItem?.missedHistory?.map(miss=><li key={miss.at}>
   <strong>{miss.name||'Сотрудник не указан'}</strong>
   <time dateTime={miss.at}>{stamp(miss.at,'Europe/Moscow')} МСК</time>
   {miss.recording?<audio controls preload="none" aria-label={'Запись звонка от '+stamp(miss.at,'Europe/Moscow')} src={'/api/call-history/recording?id='+encodeURIComponent(miss.recording)+'&missedIncomingId='+encodeURIComponent(missedItem.id)}/>:<small className="muted">Запись недоступна</small>}
  </li>)}</ol></DialogContent>
 </Dialog>
 <Dialog open={!!confirmation} onOpenChange={open=>{if(!open&&!protecting)setConfirmation(null);}}><DialogContent className="form-dialog incoming-action-dialog"><DialogHeader><DialogTitle>{confirmation?.operation==='spam'?'Отметить как возможный спам?':'Заблокировать номер?'}</DialogTitle><DialogDescription>{confirmation?.operation==='spam'?'Вы уверены? Обращение будет убрано из рабочих входящих и перемещено в возможный спам.':'Вы уверены? Следующие звонки с этого номера будут завершаться без соединения. Обращение будет перемещено в спам.'}</DialogDescription></DialogHeader>{protectionError&&<p role="alert">{protectionError}</p>}<div className="form-actions"><button type="button" className="primary" disabled={protecting||busy} onClick={()=>{if(confirmation)void protection(confirmation);}}>Подтвердить</button><button type="button" className="secondary" disabled={protecting} onClick={()=>setConfirmation(null)}>Отмена</button></div></DialogContent></Dialog>
 <Dialog open={!!resultItem} onOpenChange={open=>{if(!open)setResultId('');}}><DialogContent className="form-dialog incoming-action-dialog"><DialogHeader><DialogTitle className="pr-8 break-words">
   {resultItem?.clientName?.trim() || 'Неизвестный клиент'}
   <span className="mt-1 block text-base font-semibold">Итог входящего обращения</span>
  </DialogTitle><DialogDescription>Зафиксируйте результат разговора. Без сохранения обращение останется открытым.</DialogDescription></DialogHeader>{resultItem&&<IncomingHandoffNote item={resultItem}/>} {resultItem&&(resultItem.hasActiveOrder&&!delegated(resultItem)?<div className="stack"><label className="field"><span>Заказ, к которому относится обращение</span><select value={resultOrder} onChange={e=>setResultOrder(e.target.value)}><option value="">Выберите заказ</option>{resultItem.orderIds?.map(id=><option key={id} value={id}>{id}</option>)}</select></label><button className="primary" disabled={!resultOrder||busy} onClick={()=>{setResultId('');onOpen(resultOrder,resultItem.id);}}>Перейти к итогу по заказу</button></div>:<IncomingResult item={resultItem} busy={busy} onSave={async reason=>{const ok=await onClose(resultItem.id,reason);if(ok)setResultId('');return ok;}}/>) }{resultItem&&<button type="button" className="secondary" disabled={busy||incomingIsMissed(resultItem,now)} onClick={async()=>{if(await saveMissed(resultItem.id))setResultId('');}}>Недозвон</button>}{resultItem&&<IncomingTransfer key={resultItem.id} item={resultItem} employee={employee} operators={employees} busy={busy} onTransfer={async(id,operatorId,comment)=>{const ok=await onTransfer(id,operatorId,comment);if(ok)setResultId('');return ok;}}/>}</DialogContent></Dialog>
  <p className="muted">Клиенту сообщили, что ему перезвонят. Обращение остаётся открытым до сохранения результата. Время московское.</p>
  <div className="incoming-filters">
  <div className="tabs-line incoming-tabs" role="group" aria-label="Фильтры входящих обращений">
   {categories.map(t=>{const paired=!['closed','spam'].includes(t.id),rows=items.filter(i=>inCategory(i,t.id)),nd=rows.filter(i=>incomingIsMissed(i,now)).length;return <span className={paired?'incoming-tab-pair':undefined} key={t.id}><button type="button" data-state={tab===t.id&&!missedTab?'active':'inactive'} aria-pressed={tab===t.id&&!missedTab} onClick={()=>{setTab(t.id);setMissedTab(false);}}>{t.label} · {paired?rows.length-nd:rows.length}</button>{paired&&<button type="button" title="Недозвон — повторная обработка через час" aria-label={`НД: ${t.label} · ${nd}`} data-state={tab===t.id&&missedTab?'active':'inactive'} aria-pressed={tab===t.id&&missedTab} onClick={()=>{setTab(t.id);setMissedTab(true);}}>НД · {nd}</button>}</span>;})}
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
  <div className="incoming-card-grid">{shown.map(item=><details className={'incoming-card'+(item.hasActiveOrder?' incoming-card-has-order':item.clientId&&item.clientOwnerId?' incoming-card-owned-no-order':'')} key={item.id} open={linkedIncoming===item.id?true:undefined} onToggle={e=>{if(!e.currentTarget.open&&linkedIncoming===item.id)setLinkedIncoming('');}}>
   <summary className="incoming-card-summary">
    <div className="incoming-card-top"><span>Входящий · {new Date(item.at).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}</span><PhoneIncoming size={20}/></div>
    <div className="incoming-card-person"><span className="avatar">{item.clientId?initials(item.clientName||'Клиент'):'?'}</span><strong>{item.clientName||'Неизвестный клиент'}</strong></div>
    <div className="incoming-miss-row"><div>
    <p className="incoming-card-contact">{!hideClientPhone(employee.role)&&item.phone&&<>{item.phone} · </>}{free(item)?'Свободный клиент':item.clientId?'Наш клиент':'Неизвестный клиент'}</p>
    <div className="incoming-card-order-label">{item.hasActiveOrder?'Есть действующий заказ':'Без действующего заказа'}</div>
    </div>{item.missedHistory?.length?<button type="button" className="secondary incoming-miss-count" aria-haspopup="dialog" aria-label={'История недозвонов, отметок: '+item.missedHistory.length} onClick={e=>{e.preventDefault();setHistoryId(item.id);}}>НД · {item.missedHistory.length}</button>:<span className="incoming-miss-zero">НД · 0</span>}</div>
    <div className="incoming-card-stats"><div><strong>{item.callCount||1}</strong><span>звонков</span></div>{[[item.at,'первый звонок'],[item.lastAt||item.at,'последний звонок']].map(([at,label])=><div key={label} title={stamp(at,'Europe/Moscow')+' МСК'}><strong>{new Date(at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})}</strong><span>{label}</span></div>)}</div>
    <div className="incoming-card-status"><span className={'badge '+(item.spam?'rose':item.closedAt?'mint':'amber')}>{item.spam?'Возможный спам':item.closedAt?'Закрыто':incomingIsMissed(item,now)?'Недозвон':'Требует действия'}</span><ChevronRight size={22}/></div>
    <div className="incoming-card-footer"><span>Ответственный</span><strong>{item.assigneeName||'Не назначен'}</strong></div>
   </summary>
   <div className="incoming-card-body stack"><IncomingOrderActions canRequest={["admin","operator","department_head"].includes(employee.role)} item={item} busy={busy} onSave={(action,reason,orderId,info)=>onRequest(item.id,action,reason,orderId,info)}>{!item.closedAt&&!item.spam&&<button type="button" className="secondary" disabled={busy||incomingIsMissed(item,now)} onClick={()=>void saveMissed(item.id)}>Недозвон</button>}</IncomingOrderActions>{!item.closedAt&&!item.spam&&(item.clientOwnerId||item.assigneeId)&&!item.hasActiveOrder&&["admin","operator","department_head"].includes(employee.role)&&<button type="button" className="primary" disabled={busy} onClick={()=>onNewOrder(item)}>Оформить заказ</button>}<IncomingHandoffNote item={item}/>{item.missedAt&&<p className="incoming-missed-note" role="status">Недозвон · {stamp(item.missedAt,'Europe/Moscow')} МСК{item.missedName?` · ${item.missedName}`:''}{incomingIsMissed(item,now)?` · Вернётся ${stamp(item.missedUntil||'','Europe/Moscow')} МСК`:item.closedAt?' · Обращение закрыто':' · Доступно для повторной обработки'}</p>}

   {!hideClientPhone(employee.role)&&item.calledNumber&&<small className="muted">На номер {item.calledNumber}</small>}
   {item.spam&&<p>{item.spamReason}{item.blocked?' · Номер заблокирован':''}</p>}
   {employee.role==='admin'&&<div className="action-buttons">
    {item.spam&&!item.closedAt&&<button className="primary" disabled={protecting||busy||!item.phone} onClick={()=>void protection({id:item.id,operation:'restore'})}>Вернуть в работу</button>}
    {!item.spam&&!item.closedAt&&<button className="secondary" disabled={protecting||busy} onClick={()=>{setProtectionError('');setConfirmation({id:item.id,operation:'spam'});}}>Возможный спам</button>}
    {item.blocked?<button className="secondary" disabled={protecting||busy} onClick={()=>void protection({id:item.id,operation:'unblock'})}>Снять блокировку</button>:<button className="secondary" disabled={protecting||busy||!item.phone} onClick={()=>{setProtectionError('');setConfirmation({id:item.id,operation:'block'});}}>Заблокировать номер</button>}

   </div>}

   <div className="action-buttons incoming-contact-actions">
   {!item.spam&&!item.clientId&&!item.closedAt&&['admin','department_head'].includes(employee.role)&&<IncomingClientLink incomingId={item.id} phone={item.phone} busy={busy} employees={employees} onCreate={(name,operatorId,baseType)=>onCreate(item.id,name,operatorId,baseType)} phoneOnly={employee.role==='department_head'} onLink={async(clientId,lookupPhone)=>{const ok=await onLink(item.id,clientId,lookupPhone);if(ok){setTab('known');setLinkedIncoming(item.id);}return ok;}}/>}
   {!item.spam&&item.clientId&&(employee.role==='admin'||canOpenClientCard(employee,clients.find(c=>c.id===item.clientId))||!item.closedAt&&(employee.role==='department_head'||employee.role==='operator'&&(item.assigneeId===employee.id||item.clientOwnerId===employee.id)))&&<button type="button" className="secondary" disabled={busy} onClick={()=>onOpenClient(item.clientId!,item.closedAt?undefined:item.id)}>Карточка клиента</button>}
   {!item.spam&&!item.closedAt&&(!item.clientId||assignedCallback(item)||sharedCallback(item))&&(['admin','department_head'].includes(employee.role)||employee.role==='operator'&&item.assigneeId===employee.id)&&<CallButton client={clients.find(c=>c.id===item.clientId)} target={{mode:'incoming',incomingId:item.id}} onPrepared={id=>calls.current.set(item.id,id)} onCompleted={()=>afterCall(item)} disabled={busy}>Перезвонить</CallButton>}
   {!item.spam&&item.clientId&&canOpenClientCard(employee,clients.find(c=>c.id===item.clientId))&&!item.hasActiveOrder&&!assignedCallback(item)&&!sharedCallback(item)&&<CallButton client={clients.find(c=>c.id===item.clientId)} target={{mode:'client',clientId:item.clientId}} onPrepared={id=>calls.current.set(item.id,id)} onCompleted={()=>afterCall(item)} disabled={busy}>Перезвонить</CallButton>}
   </div>
   {canTransferIncoming(employee,item)&&<details className="incoming-transfer-fold" open={linkedIncoming===item.id?true:undefined}><summary>{incomingTransferLabel(employee,item)}</summary><IncomingTransfer key={item.id+':'+(item.clientOwnerId||'')} item={item} employee={employee} operators={employees} busy={busy} onTransfer={onTransfer}/></details>}
   {!item.spam&&(item.closedAt?<><span>Закрыто: {stamp(item.closedAt,'Europe/Moscow')} МСК · {item.closedBy}</span><p>{item.reason}</p>{item.orderId&&<button type="button" className="secondary" onClick={()=>onOpen(item.orderId!,item.id)}>Открыть {item.orderId}</button>}</>:<>
    {item.hasActiveOrder&&!delegated(item)?<><span>Действующие заказы</span><div className="action-buttons">{item.orderIds?.map(id=><button className="primary" key={id} onClick={()=>onOpen(id,item.id)}>Открыть {id}</button>)}</div>{!item.orderIds?.length&&<p>Заказ недоступен вашей роли. Обратитесь к администратору.</p>}</>:<details className="incoming-result-fold"><summary>Итог обращения / закрыть</summary><IncomingResult item={item} busy={busy} onSave={reason=>onClose(item.id,reason)}/></details>}
   </>)}
   </div>
  </details>)}</div>
  {!shown.length&&<p className="muted">{history?'Закрытых обращений пока нет.':missedTab?'В этой категории нет обращений в НД.':'Нет обращений, требующих действия.'}</p>}
  {history&&<small className="muted">Показаны последние 50 закрытых обращений, доступных вам.</small>}
 </div>;
}

export function IncomingConsultation({item,busy,onSave}:{item:IncomingRequest;busy:boolean;onSave:(reason:string,orderId?:string)=>Promise<boolean>}){
 const [orderId,setOrderId]=useState(item.orderIds?.length===1?item.orderIds[0]:'');
 return <section className="stack"><h3>Итог входящего обращения · консультация</h3><p>Ответили на вопросы клиента? Сохраните итог здесь. Результат и дата в проекте «Выкуп» не изменятся.</p>{item.hasActiveOrder&&<label className="field"><span>К какому заказу относится обращение</span><select value={orderId} onChange={e=>setOrderId(e.target.value)} disabled={busy}><option value="">Выберите заказ</option>{item.orderIds?.map(id=><option key={id} value={id}>{id}</option>)}</select></label>}<IncomingResult item={item} busy={busy||!!item.hasActiveOrder&&!orderId} onSave={reason=>onSave('Консультация: '+reason,orderId||undefined)}/></section>;
}

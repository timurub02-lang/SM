'use client';
import {useState} from 'react';
import {departments,initials,stamp,type Client,type Employee,type IncomingRequest} from '@/lib/crm';
import {PhoneIncoming,ChevronRight} from 'lucide-react';
import {canOpenClientCard} from '@/lib/permissions';
import {CallButton} from './browser-phone';
import {IncomingClientLink} from './incoming-client-link';

export function IncomingResult({item,busy,onSave}:{item:IncomingRequest;busy:boolean;onSave:(reason:string)=>Promise<boolean>}){
 const [reason,setReason]=useState('');
 return <form className="notice stack incoming-result" onSubmit={async e=>{e.preventDefault();if(reason.trim()&&await onSave(reason.trim()))setReason('');}}>
  <strong>Итог входящего обращения · {stamp(item.at,'Europe/Moscow')} МСК</strong>
  <label className="field"><span>Результат / причина закрытия *</span><textarea required maxLength={2000} rows={2} placeholder="Напишите, чем закончилось обращение клиента" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
  <button type="submit" className="primary" disabled={busy||!reason.trim()}>Сохранить итог и закрыть обращение</button>
 </form>;
}
export function IncomingInbox({items,clients,employees,employee,busy,onReload,onCreate,onLink,onAssign,onOpenClient,onOpen,onClose}:{items:IncomingRequest[];onReload:()=>Promise<unknown>;clients:Client[];employees:Pick<Employee,"id"|"name"|"department">[];onCreate:(incomingId:string,name:string,operatorId:string,baseType:string)=>Promise<boolean>;onLink:(incomingId:string,clientId:string)=>Promise<boolean>;onAssign:(incomingId:string,operatorId:string)=>Promise<boolean>;employee:Employee;busy:boolean;onOpenClient:(clientId:string)=>void;onOpen:(orderId:string,incomingId:string)=>void;onClose:(id:string,reason:string)=>Promise<boolean>}){
 const [selectedDepartments,setSelectedDepartments]=useState<Record<string,string>>({});
 const [assignments,setAssignments]=useState<Record<string,string>>({});
 const [tab,setTab]=useState('open'),[scope,setScope]=useState('all');
 const [protecting,setProtecting]=useState(false),[protectionError,setProtectionError]=useState(''),[settings,setSettings]=useState<any>(null),[confirmBlock,setConfirmBlock]=useState('');
 async function protection(payload:any){setProtecting(true);setProtectionError('');try{const r=await fetch('/api/incoming-protection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json() as any;if(!r.ok)throw Error(data.error);setConfirmBlock('');await onReload();return true;}catch(e){setProtectionError(e instanceof Error?e.message:'Не удалось сохранить');return false;}finally{setProtecting(false);}}
 async function openProtection(){setProtectionError('');try{const r=await fetch('/api/incoming-protection');const data=await r.json() as any;if(!r.ok)throw Error(data.error);setSettings(data);}catch(e){setProtectionError(e instanceof Error?e.message:'Ошибка загрузки');}}
 const history=tab==='closed';

 const scopes=employee.role==='department_head'?[['all','Все доступные'],['mine','Мои'],['department','Мой отдел']]:employee.role==='admin'?[['all','Все обращения']]:[];
 const scoped=items.filter(i=>scope==='all'||scope==='mine'&&i.assigneeId===employee.id||scope==='department'&&!!i.clientId&&i.assigneeId!==employee.id);
 const shown=scoped.filter(i=>tab==='spam'?i.spam:!i.spam&&(tab==='closed'?!!i.closedAt:!i.closedAt&&(tab==='open'||(tab==='known'?!!i.clientId:!i.clientId))));
 return <div className="stack">
  <p className="muted">Клиенту сообщили, что ему перезвонят. Обращение остаётся открытым до сохранения результата. Время московское.</p>
  <div className="incoming-filters">
  {scopes.length>1&&<label className="incoming-scope"><span>Обращения</span><select aria-label="Категория входящих обращений" value={scope} onChange={e=>setScope(e.target.value)}>{scopes.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
  <div className="tabs-line incoming-tabs" role="group" aria-label="Фильтры входящих обращений">
   {[{id:'open',label:'Требуют действия',count:scoped.filter(i=>!i.spam&&!i.closedAt).length},{id:'known',label:'Наши клиенты',count:scoped.filter(i=>!i.spam&&!i.closedAt&&!!i.clientId).length},{id:'unknown',label:'Неизвестные клиенты',count:scoped.filter(i=>!i.spam&&!i.closedAt&&!i.clientId).length},...(employee.role==='admin'?[{id:'spam',label:'Возможный спам',count:scoped.filter(i=>i.spam).length}]:[]),{id:'closed',label:'Закрытые',count:scoped.filter(i=>!i.spam&&!!i.closedAt).length}].map(t=><button type="button" key={t.id} data-state={tab===t.id?'active':'inactive'} aria-pressed={tab===t.id} onClick={()=>setTab(t.id)}>{t.label} · {t.count}</button>)}
  </div>
  </div>
  {employee.role==='admin'&&<button className="secondary" type="button" onClick={()=>void openProtection()}>Защита от спама</button>}
  {protectionError&&<p role="alert">{protectionError}</p>}
  {settings&&<form className="notice stack" onSubmit={async e=>{e.preventDefault();if(await protection({operation:'settings',config:settings.config}))setSettings(null);}}>
   <strong>Защита входящих</strong><p>Повторные звонки объединяются только в открытое обращение. После закрытия следующий звонок создаёт новое. Подозрительные звонки сохраняются отдельно, без уведомлений сотрудникам.</p>
   <p>При всплеске неизвестным звонящим предлагается нажать 1. Известные клиенты проходят без проверки, кроме явно заблокированных номеров.</p>
   {([['repeatLimit','Звонков с одного неизвестного номера за 5 минут',3,100],['burstLimit','Разных неизвестных номеров за минуту',5,500],['challengeMinutes','Длительность проверки при всплеске, минут',1,60]] as const).map(([key,label,min,max])=><label className="field" key={key}>{label}<input type="number" required min={min} max={max} value={settings.config[key]} onChange={e=>setSettings({...settings,config:{...settings.config,[key]:Number(e.target.value)}})}/></label>)}
   <span>{settings.state?.until_at&&Date.parse(settings.state.until_at)>Date.now()?'Проверка активна до '+stamp(settings.state.until_at,'Europe/Moscow')+' МСК':'Сейчас обычный режим'}</span>
   <div className="action-buttons"><button className="primary" disabled={protecting}>Сохранить</button><button className="secondary" type="button" onClick={()=>setSettings(null)}>Закрыть</button></div>
  </form>}
  {tab==='spam'&&<p className="muted">Последние 100 подозрительных обращений. Они не создают задачи сотрудникам. «Вернуть в работу» также исключит номер из автоматической проверки; «Снять блокировку» снова включает обычную проверку.</p>}
  <div className="incoming-card-grid">{shown.map(item=><details className="incoming-card" key={item.id}>
   <summary className="incoming-card-summary">
    <div className="incoming-card-top"><span>Входящий · {new Date(item.at).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}</span><PhoneIncoming size={20}/></div>
    <div className="incoming-card-person"><span className="avatar">{item.clientId?initials(item.clientName||'Клиент'):'?'}</span><strong>{item.clientName||'Неизвестный клиент'}</strong></div>
    <p className="incoming-card-contact">{item.phone||'Номер скрыт'} · {item.clientId?'Наш клиент':'Неизвестный клиент'}</p>
    <div className="incoming-card-stats"><div><strong>{item.callCount||1}</strong><span>звонков</span></div>{[[item.at,'первый звонок'],[item.lastAt||item.at,'последний звонок']].map(([at,label])=><div key={label} title={stamp(at,'Europe/Moscow')+' МСК'}><strong>{new Date(at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})}</strong><span>{label}</span></div>)}</div>
    <div className="incoming-card-status"><span className={'badge '+(item.spam?'rose':item.closedAt?'mint':'amber')}>{item.spam?'Возможный спам':item.closedAt?'Закрыто':'Требует действия'}</span><ChevronRight size={22}/></div>
    <div className="incoming-card-footer"><span>Ответственный</span><strong>{item.assigneeName||'Не назначен'}</strong></div>
   </summary>
   <div className="incoming-card-body stack">
   <div className="incoming-client-heading">{!item.spam&&!item.clientId&&!item.closedAt&&['admin','department_head'].includes(employee.role)&&<IncomingClientLink incomingId={item.id} phone={item.phone} busy={busy} employees={employees} onCreate={(name,operatorId,baseType)=>onCreate(item.id,name,operatorId,baseType)} onLink={clientId=>onLink(item.id,clientId)}/>}</div>
   <span>Входящий: {stamp(item.at,'Europe/Moscow')} МСК{item.calledNumber?' · На номер '+item.calledNumber:''}</span>
   <span>{item.assigneeName}</span>
   <span>Звонков: {item.callCount||1}{(item.callCount||1)>1&&' · Последний: '+stamp(item.lastAt||item.at,'Europe/Moscow')+' МСК'}</span>
   {item.spam&&<p>{item.spamReason}{item.blocked?' · Номер заблокирован':''}</p>}
   {employee.role==='admin'&&<div className="action-buttons">
    {item.spam&&!item.closedAt&&<button className="primary" disabled={protecting||busy||!item.phone} onClick={()=>void protection({id:item.id,operation:'restore'})}>Вернуть в работу</button>}
    {!item.spam&&!item.closedAt&&<button className="secondary" disabled={protecting||busy} onClick={()=>void protection({id:item.id,operation:'spam'})}>Возможный спам</button>}
    {item.blocked?<button className="secondary" disabled={protecting||busy} onClick={()=>void protection({id:item.id,operation:'unblock'})}>Снять блокировку</button>:<button className="secondary" disabled={protecting||busy||!item.phone} onClick={()=>setConfirmBlock(item.id)}>Заблокировать номер</button>}
    {confirmBlock===item.id&&<div role="alert"><p>Звонки с этого номера будут завершаться без соединения и сохраняться в спаме. Заблокировать?</p><button className="primary" disabled={protecting} onClick={()=>void protection({id:item.id,operation:'block'})}>Подтвердить блокировку</button><button className="secondary" onClick={()=>setConfirmBlock('')}>Отмена</button></div>}
   </div>}

   {!item.spam&&item.clientId&&canOpenClientCard(employee,clients.find(c=>c.id===item.clientId))&&<div className="action-buttons">
    <button type="button" className="secondary" disabled={busy} onClick={()=>onOpenClient(item.clientId!)}>Карточка клиента</button>
    <CallButton target={{mode:'client',clientId:item.clientId}} disabled={busy}>Перезвонить</CallButton>
   </div>}
   {!item.spam&&!item.hasActiveOrder&&!item.closedAt&&item.clientId&&['admin','department_head'].includes(employee.role)&&<div className="incoming-assignment">
    <label className="field"><span>Отдел</span><select aria-label="Отдел оператора обращения" value={selectedDepartments[item.id]||''} disabled={busy} onChange={e=>{setSelectedDepartments({...selectedDepartments,[item.id]:e.target.value});setAssignments({...assignments,[item.id]:''});}}><option value="">Выберите отдел</option>{Object.entries(departments).map(([id,name])=><option key={id} value={id}>{name.replace(/_$/,'')}</option>)}{employees.some(e=>!e.department)&&<option value="none">Без отдела</option>}</select></label>
    <label className="field"><span>Назначить ответственного оператора</span><select aria-label="Ответственный оператор обращения" value={assignments[item.id]||''} disabled={busy||!selectedDepartments[item.id]} onChange={e=>setAssignments({...assignments,[item.id]:e.target.value})}><option value="">Выберите оператора</option>{employees.filter(e=>(e.department||'none')===selectedDepartments[item.id]).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <div className="incoming-assignment-action"><button type="button" className="primary incoming-assign-button" disabled={busy||!assignments[item.id]} onClick={()=>void onAssign(item.id,assignments[item.id])}>Передать оператору</button>
    <small>Обращение и клиент будут переданы оператору для дальнейшей работы и оформления заказа.</small></div>
   </div>}
   {!item.spam&&(item.closedAt?<><span>Закрыто: {stamp(item.closedAt,'Europe/Moscow')} МСК · {item.closedBy}</span><p>{item.reason}</p></>:<>
    {item.hasActiveOrder?<><span>Действующие заказы</span><div className="action-buttons">{item.orderIds?.map(id=><button className="primary" key={id} onClick={()=>onOpen(id,item.id)}>Открыть {id}</button>)}</div>{!item.orderIds?.length&&<p>Заказ недоступен вашей роли. Обратитесь к администратору.</p>}</>:<><span>Действующего заказа нет</span><IncomingResult item={item} busy={busy} onSave={reason=>onClose(item.id,reason)}/></>}
   </>)}
   </div>
  </details>)}</div>
  {!shown.length&&<p className="muted">{history?'Закрытых обращений пока нет.':'Нет обращений, требующих действия.'}</p>}
  {history&&<small className="muted">Показаны последние 50 закрытых обращений, доступных вам.</small>}
 </div>;
}

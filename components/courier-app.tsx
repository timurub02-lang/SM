"use client";
import {useSessionTab} from "@/hooks/use-session-tab";
import {useState,useEffect,useRef} from 'react';
import {Toaster,toast} from 'sonner';
import {money,stamp,type State,type Employee,type Order} from '@/lib/crm';
import {courierBalance,courierStage,courierPhase,courierLabel,courierDeadline,courierTimeLeft,courierWaitingSince,courierConfirmationStage,courierConfirmationTabs,courierReturnReasons,courierOperatorReasons} from '@/lib/courier';
import {defaultOrderPolicy} from '@/lib/order-policy';
type Props={state:State;employee:Employee;busy:boolean;error:string;refresh:()=>Promise<void>;mutate:(p:Record<string,unknown>)=>Promise<boolean>};
const labels:Record<string,string>={pending:'Принять посылки',confirmation:'На подтверждении',delivery:'Заказы на руках',waiting:'Ожидают решения',return:'Вернуть на склад',money:'Сдать деньги',settled:'Завершённые'};
const moscowInput=(at:string)=>new Date(Date.parse(at)+3*3600000).toISOString().slice(0,16);
export function CourierApp({state,employee,busy,error,refresh,mutate}:Props){
 const [tab,setTab]=useSessionTab<string>(`crm-navigation:${employee.id}:courier:tab`,'pending',Object.keys(labels));
 const [filter,setFilter]=useState('new'),[query,setQuery]=useState(''),[now,setNow]=useState(Date.now),[remindersOpen,setRemindersOpen]=useState(false),[target,setTarget]=useState('');
 const [design,setDesign]=useState('aurora'),notified=useRef(new Set<string>());
 const policy=state.settings.orderPolicy||defaultOrderPolicy;
 useEffect(()=>{try{setDesign(localStorage.getItem(`courier-design:${employee.id}`)==='classic'?'classic':'aurora');}catch{}},[employee.id]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(target){document.getElementById('courier-'+target)?.scrollIntoView({block:'center',behavior:'smooth'});}},[target,tab,filter]);
 const reminders=state.reminders||[],unread=reminders.filter(r=>!r.readAt&&!r.resolved);
 function openOrder(id:string){const o=state.orders.find(o=>o.id===id);if(!o)return;setTab(courierStage(o));setQuery('');setFilter('all');setTarget(id);setRemindersOpen(false);}
 useEffect(()=>{for(const r of unread){if(notified.current.has(r.id)||r.kind==='call'&&(!r.due||Date.parse(r.due)>now))continue;notified.current.add(r.id);toast.info(r.kind==='call'?'Пора позвонить клиенту':r.title,{description:r.text,duration:10000,action:r.orderId?{label:'Открыть',onClick:()=>openOrder(r.orderId!)}:undefined});}},[reminders,now]);
 function changeDesign(value:string){setDesign(value);try{localStorage.setItem(`courier-design:${employee.id}`,value);}catch{}}
 const balance=courierBalance(state.orders,employee.id);
 const workParcels=state.orders.filter(o=>o.courier?.acceptedAt&&['confirmation','waiting','pending'].includes(courierStage(o))).reduce((sum,o)=>sum+Math.round(o.courier!.amount*100),0)/100;
 const priority=(o:Order)=>courierPhase(o)==='resume'?0:o.due?Date.parse(o.due):courierDeadline(o)?Date.parse(courierDeadline(o)!):o.courier?.postponement?.state==='approved'?Date.parse(o.courier.postponement.at):Date.parse(o.courier!.assignedAt);
 const orders=state.orders.filter(o=>courierStage(o)===tab&&(tab!=='confirmation'||filter==='all'||courierConfirmationStage(o,now,policy)===filter)&&`${o.id} ${state.clients.find(c=>c.id===o.clientId)?.name||''}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))).sort((a,b)=>priority(a)-priority(b));
 return <main className={`courier-app courier-design-${design}`}><Toaster richColors position="top-center"/><div className="courier-design-picker" role="group" aria-label="Дизайн кабинета"><span>Дизайн</span><button type="button" aria-pressed={design==='classic'} onClick={()=>changeDesign('classic')}>Классический</button><button type="button" aria-pressed={design==='aurora'} onClick={()=>changeDesign('aurora')}>Аврора</button></div>
 <div className="courier-hero"><header className="courier-header"><div><small>СМ · КУРЬЕР</small><h1>{employee.name}</h1></div><button className="secondary" onClick={async()=>{await fetch('/api/auth/logout',{method:'POST'});window.location.replace('/login');}}>Выйти</button></header>
 <section className="courier-balances" aria-label="Мой отчёт"><div><span>Посылки у вас</span><strong>{money(balance.parcels)}</strong><small>Включая подтверждение, доработку и возвраты</small></div><div><span>Деньги на руках</span><strong>{money(balance.cash)}</strong><small>Нужно передать логисту</small></div><div><span>Ожидает приёма</span><strong>{money(balance.pending)}</strong><small>Ещё не входит в ваш отчёт</small></div><div className="courier-total"><span>Всего под отчётом</span><strong>{money(balance.total)}</strong></div></section>
 {workParcels>0&&<p className="courier-work-amount">Из посылок у вас: {money(workParcels)} на подтверждении и доработке.</p>}</div>
 <div className="courier-refresh"><button className="secondary" aria-expanded={remindersOpen} onClick={()=>setRemindersOpen(!remindersOpen)}>Напоминания · {unread.length}</button><button className="secondary" disabled={busy} onClick={()=>void refresh()}>Обновить</button></div>
 {error&&<p role="alert" className="notice amber">{error}. Проверьте соединение и обновите данные.</p>}
 {remindersOpen&&<section className="courier-notices" aria-label="Напоминания"><p>Последние 20. Просмотренные остаются в истории.</p>{reminders.map(r=><article className={r.readAt||r.resolved?'read':''} key={r.id}><strong>{r.title}</strong><p>{r.text}</p><small>{stamp(r.due||r.at,'Europe/Moscow')} МСК</small>{r.orderId&&<button className="secondary" disabled={busy} onClick={()=>{openOrder(r.orderId!);void mutate({action:'readReminder',id:r.id});}}>Открыть заказ</button>}</article>)}{!reminders.length&&<p>Напоминаний пока нет.</p>}</section>}
 <nav className="courier-tabs" aria-label="Мои заказы">{Object.entries(labels).filter(([id])=>id!=='settled').map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setTarget('');}}>{label}<b>{state.orders.filter(o=>courierStage(o)===id).length}</b></button>)}</nav>
 <button className="secondary courier-completed" aria-pressed={tab==='settled'} onClick={()=>setTab('settled')}>Завершённые · {state.orders.filter(o=>courierStage(o)==='settled').length}</button>
 {tab==='confirmation'&&<nav className="courier-subtabs" aria-label="Этап подтверждения">{courierConfirmationTabs.map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}<b>{state.orders.filter(o=>courierStage(o)==='confirmation'&&courierConfirmationStage(o,now,policy)===id).length}</b></button>)}</nav>}
 <label className="courier-search">Поиск заказа<input type="search" placeholder="Номер заказа или имя клиента" value={query} onChange={e=>setQuery(e.target.value)}/></label>
 <section className="courier-orders" aria-label={labels[tab]}>{orders.map(o=>{const c=state.clients.find(c=>c.id===o.clientId),stage=courierStage(o),assignment=o.courier!,deadline=courierDeadline(o),postponement=assignment.postponement,address=(o.address||c?.address||'').trim();return <article id={'courier-'+o.id} className="courier-order" key={o.id}>
 <div className="courier-order-heading"><span>{o.id}</span><strong>{money(assignment.amount)}</strong></div><h2>{c?.name||'Клиент'}</h2><p className="courier-state">{courierLabel(o)}</p>
 {!assignment.acceptedAt&&stage==='pending'&&<p className="courier-deadline">Передан {stamp(assignment.assignedAt,'Europe/Moscow')} МСК<br/>Ожидает приёма: <b>{courierWaitingSince(o,now)}</b></p>}
 {deadline&&<p className={`courier-deadline${Date.parse(deadline)-now<=policy.courierWarningHours*3600000?' urgent':''}`}>До передачи оператору: <b>{courierTimeLeft(deadline,now)}</b><br/>{stamp(deadline,'Europe/Moscow')} МСК</p>}
 {o.due&&['confirmation','waiting'].includes(stage)&&<p className="courier-deadline">{Date.parse(o.due)<=now?'Пора позвонить':'Следующий звонок'}: {stamp(o.due,'Europe/Moscow')} МСК{o.contactAuthor&&<> · назначил {o.contactAuthor.name}</>}</p>}
 {postponement&&<p className="courier-deadline">{postponement.state==='approved'?'Доставка согласована на':postponement.state==='pending'?'Запрошена доставка на':'Перенос отклонён, запрашивали'} <b>{stamp(postponement.at,'Europe/Moscow')} МСК</b>{postponement.state==='approved'&&stage==='delivery'&&Date.parse(postponement.at)<=now&&<><br/>Наступило время доставки</>}<br/>{postponement.reason}{postponement.name&&<> · {postponement.name}</>}</p>}
 <p className="courier-address">{address||'Адрес не указан'}</p>{assignment.acceptedAt&&address&&<div className="courier-navigation"><a className="secondary courier-navigator" href={'yandexnavi://map_search?text='+encodeURIComponent(address)}><svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#ffcf00"/><path d="M24 7 19 25 14 18 7 13Z" fill="#252525"/></svg>Яндекс Навигатор</a></div>}{assignment.acceptedAt&&c?.phone&&<a className="secondary courier-phone" href={'tel:'+c.phone.replace(/[^+\d]/g,'')}>Позвонить · {c.phone}</a>}
 {o.testOnly&&<p className="notice amber">ТЕСТОВЫЙ ЗАКАЗ — не доставлять.</p>}{o.comment&&<p><b>Комментарий:</b> {o.comment}</p>}{o.waybillComment&&<p><b>Для доставки:</b> {o.waybillComment}</p>}{o.reason&&<p><b>Причина:</b> {o.reason}</p>}
 {stage==='waiting'&&<p>С заказом работает {courierPhase(o)==='operator'?'оператор':'логист'}. Посылка остаётся у вас. Решение появится в напоминаниях.</p>}
 <CourierActions order={o} busy={busy} mutate={mutate}/>
 <details><summary>Товары и история заказа</summary><ul>{o.items.map((i,n)=><li key={n}>{i.name} × {i.quantity}</li>)}</ul><ol className="courier-history"><li>Передан логистом · {stamp(assignment.assignedAt,'Europe/Moscow')}</li>{assignment.acceptedAt&&<li>Посылка принята · {stamp(assignment.acceptedAt,'Europe/Moscow')}<small>Под отчётом +{money(assignment.amount)}</small></li>}{assignment.confirmedAt&&<li>Подтверждение · {stamp(assignment.confirmedAt,'Europe/Moscow')}<small>{assignment.confirmedBy==='operator'?'Оператор':assignment.confirmedBy==='logistic'?'Логист':'Курьер'}</small></li>}{o.redeemedAt&&<li>Клиент оплатил · {stamp(o.redeemedAt,'Europe/Moscow')}</li>}{o.cancelledAt&&<li>Заказ отменён · {stamp(o.cancelledAt,'Europe/Moscow')}<small>Верните посылку на склад</small></li>}{o.returnedAt&&<li>Возврат · {stamp(o.returnedAt,'Europe/Moscow')}</li>}{o.warehouseReturnedAt&&<li>Принято на склад · {stamp(o.warehouseReturnedAt,'Europe/Moscow')}</li>}{o.paymentReceivedAt&&<li>Деньги приняты логистом · {stamp(o.paymentReceivedAt,'Europe/Moscow')}</li>}</ol></details>
 </article>;})}{!orders.length&&<div className="empty"><h2>Здесь пока нет заказов</h2><p>{query?'Измените поисковый запрос.':'Выберите другой раздел или этап.'}</p></div>}</section>
 </main>;
}
function CourierActions({order:o,busy,mutate}:Pick<Props,'busy'|'mutate'>&{order:Order}){
 const [mode,setMode]=useState(''),[reason,setReason]=useState(''),[comment,setComment]=useState(''),[at,setAt]=useState('');
 const stage=courierStage(o),phase=courierPhase(o),deadline=courierDeadline(o);
 function choose(value:string){setMode(value);setReason('');setComment('');setAt('');}
 async function send(p:Record<string,unknown>){if(await mutate({id:o.id,version:o.version,...p}))choose('');}
 if(stage==='pending')return <div className="courier-confirm">{phase==='resume'?<><p>Посылка уже у вас. Подтвердите, что увидели решение и продолжаете доставку. Звонить для повторного подтверждения не нужно.</p><button className="primary" disabled={busy} onClick={()=>void send({action:'courierWorkflow',operation:'resume'})}>Продолжить доставку</button></>:<><p>Проверьте номер заказа и фактическое получение посылки. После приёма станут доступны звонок и навигатор. {o.courier?.phase==='pending'?'Начнётся подтверждение клиента.':'Заказ уже подтверждён, можно продолжить доставку.'}</p><button className="primary" disabled={busy} onClick={()=>void send({action:'courierAccept',confirmed:true})}>Принять посылку</button></>}</div>;
 if(!['confirmation','delivery'].includes(stage))return null;
 if(mode){
  const call=['callback','missed'].includes(mode),outcome=['redeemed','returned'].includes(mode),transfer=['toLogistic','toOperator'].includes(mode),postpone=mode==='requestPostpone';
  const reasons=mode==='toLogistic'?courierReturnReasons:courierOperatorReasons;
  const text=[reason,comment.trim()].filter(Boolean).join(' · ');
  const title=mode==='redeemed'?'Деньги получены?':mode==='returned'?'Окончательный возврат посылки':mode==='toLogistic'?'Передать в работу логисту':mode==='toOperator'?'Передать в работу оператору':postpone?'Запросить перенос доставки':mode==='callback'?'Назначить перезвон':'Отметить недозвон';
  return <form className="courier-confirm" onSubmit={e=>{e.preventDefault();const due=at?new Date(at+'+03:00').toISOString():'';void send(call?{action:'contact',contact:mode,reason:text,due}:outcome?{action:'courierOutcome',to:mode,confirmed:true,reason:text}:{action:'courierWorkflow',operation:mode,reason:text,...(postpone?{at:due}:{})});}}><h3>{title}</h3>
   {mode==='redeemed'?<p>Подтвердите получение полной суммы {money(o.courier!.amount)}. Деньги нужно передать логисту.</p>:<>
   {mode==='returned'&&<p>Заказ получит итог «Возврат». Доставьте посылку на склад; до приёма логистом она остаётся под вашим отчётом.</p>}
   {transfer&&<p>Посылка остаётся у вас. {mode==='toOperator'?'Скажите клиенту, что оператор свяжется с ним и ответит на вопросы.':'Логист свяжется с клиентом и сообщит результат.'}</p>}
   {postpone&&<p>Логист согласует дату. До согласования действует срок работы логиста; один запрос не отключает таймер.</p>}
   {(transfer||mode==='returned')&&<label>Причина<select required value={reason} onChange={e=>setReason(e.target.value)}><option value="">Выберите причину</option>{reasons.filter(r=>mode!=='toLogistic'||r!=='Просит перенести доставку').map(r=><option key={r}>{r}</option>)}</select></label>}
   <label>{transfer||mode==='returned'?'Пояснение (необязательно)':call?'Причина звонка':'Причина переноса'}<textarea rows={2} required={!transfer&&mode!=='returned'} maxLength={800} value={comment} onChange={e=>setComment(e.target.value)} placeholder={call?'Укажите причину недозвона или перезвона':'Что нужно знать сотруднику'}/></label>
   {(call||postpone)&&<label>{postpone?'Желаемая доставка · МСК':mode==='missed'?'Следующая попытка · МСК (необязательно)':'Время звонка · МСК'}<input type="datetime-local" required={mode!=='missed'} value={at} min={moscowInput(new Date().toISOString())} max={call&&deadline?moscowInput(deadline):undefined} onChange={e=>setAt(e.target.value)}/></label>}
   </>}
   <button type="submit" className="primary" disabled={busy}>{busy?'Сохранение…':mode==='redeemed'?'Да, деньги получены':postpone?'Отправить на согласование':'Подтвердить'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>choose('')}>Назад</button>
  </form>;
 }
 return <div className="courier-buttons">
 {stage==='confirmation'?<><button className="primary courier-wide" disabled={busy} onClick={()=>void send({action:'courierWorkflow',operation:'confirm'})}>Подтвердить — клиент ожидает заказ</button><button className="secondary" disabled={busy} onClick={()=>choose('missed')}>Недозвон</button><button className="secondary" disabled={busy} onClick={()=>choose('callback')}>Перезвон</button></>:<><button className="primary" disabled={busy} onClick={()=>choose('redeemed')}>Оплачен</button><button className="secondary" disabled={busy} onClick={()=>choose('returned')}>Возврат</button></>}
 <button className="secondary courier-wide" disabled={busy} onClick={()=>choose('toOperator')}>Передать в работу оператору</button><button className="secondary courier-wide" disabled={busy} onClick={()=>choose('toLogistic')}>Передать в работу логисту</button><button className="secondary courier-wide" disabled={busy} onClick={()=>choose('requestPostpone')}>Согласовать перенос доставки</button>
 </div>;
}

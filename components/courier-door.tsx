'use client';
import {useEffect,useRef,useState} from 'react';
import {AlertTriangle} from 'lucide-react';
import {canHandleCourierDoor,courierDoorRefusal,courierDoorPhase,courierDoorNoticeId} from '@/lib/courier';
import type {Order,Employee} from '@/lib/crm';
const elapsed=(at:string,now:number)=>{const seconds=Math.max(0,Math.floor((now-Date.parse(at))/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
function useClock(){const [now,setNow]=useState(Date.now);useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);return now;}
export function CourierDoorStatus({order:o}:{order:Order}){
 const now=useClock(),door=courierDoorRefusal(o);if(!door)return null;
 const phase=courierDoorPhase(o,now),late=phase.endsWith('overdue');
 return <div className="courier-door-status"><strong><AlertTriangle size={18}/> Отказ у двери — курьер ждёт решения</strong><p>Ожидание: <b>{elapsed(door.at,now)}</b> · {door.claimedName?`В работе: ${door.claimedName}`:'Ещё никто не взял в работу'}</p><p>{door.claimedName?`${door.claimedName} взял обращение в работу. Связывается с клиентом — ожидайте решения.`:"Обращение отправлено оператору и руководителю отдела."}</p><p>{o.courier?.workReason}</p>{late&&<p className="courier-door-overdue" role="status">{phase==='claim-overdue'?'Обращение не принято вовремя.':'Окончательный ответ задерживается.'} Требуется подключение руководителя или администратора. Заказ автоматически не отменяется.</p>}</div>;
}
export function CourierDoorDecision({order:o,employee,staff,busy,mutate}:{order:Order;employee:Employee;staff:Employee[];busy:boolean;mutate:(p:Record<string,unknown>)=>Promise<boolean>}){
 const [choice,setChoice]=useState<'deliver'|'return'|null>(null);
 useEffect(()=>setChoice(null),[o.version]);
 const d=courierDoorRefusal(o);if(!d)return null;
 const can=canHandleCourierDoor(o,employee,staff),mine=d.claimedBy===employee.id;
 const act=async(operation:string,result?:string)=>{if(await mutate({action:'courierWorkflow',operation,id:o.id,version:o.version,...(result?{result,confirmed:true}:{})}))setChoice(null);};
 return <section className="courier-door-card" aria-label="Срочное решение у двери"><CourierDoorStatus order={o}/><p>Посылка у курьера. Нужен окончательный ответ клиента; недозвон и перезвон недоступны.</p>{can&&(mine?choice?<div className="courier-door-confirm"><p><b>{choice==='deliver'?'Клиент подтвердил, что готов выкупить заказ?':'Клиент окончательно отказался от заказа?'}</b></p><p>{choice==='deliver'?'Курьер получит указание продолжить доставку. Оплату он отметит только после получения денег.':'Заказ будет отменён. Курьер получит указание вернуть посылку на склад.'}</p><button type="button" className="primary" disabled={busy} onClick={()=>void act('resolveDoor',choice)}>Да, передать ответ курьеру</button><button type="button" className="secondary" disabled={busy} onClick={()=>setChoice(null)}>Назад</button></div>:<div className="action-buttons"><button type="button" className="primary" disabled={busy} onClick={()=>setChoice('deliver')}>Клиент согласен выкупить</button><button type="button" className="secondary" disabled={busy} onClick={()=>setChoice('return')}>Отказ подтверждён</button></div>:!d.claimedBy||['admin','department_head'].includes(employee.role)?<button type="button" className="primary" disabled={busy} onClick={()=>void act('claimDoor')}>{d.claimedBy?'Взять обращение на себя':'Беру в работу'}</button>:<p>Ответ курьеру даст {d.claimedName}. При необходимости подключится руководитель.</p>)}</section>;
}
export function CourierDoorAlerts({orders,employee,staff,openOrder}:{orders:Order[];employee:Employee;staff:Employee[];openOrder:(o:Order)=>void}){
 const now=useClock(),context=useRef<AudioContext|null>(null),lastSound=useRef('');
 const pending=orders.filter(o=>canHandleCourierDoor(o,employee,staff)).sort((a,b)=>Date.parse(courierDoorRefusal(a)!.at)-Date.parse(courierDoorRefusal(b)!.at));
 const signature=pending.map(o=>courierDoorNoticeId(o,now)).join('|'),signatureRef=useRef(signature);signatureRef.current=signature;
 const beep=()=>{const c=context.current;if(!c||c.state!=='running'||!signatureRef.current||lastSound.current===signatureRef.current)return;lastSound.current=signatureRef.current;const oscillator=c.createOscillator(),gain=c.createGain();oscillator.connect(gain);gain.connect(c.destination);oscillator.frequency.value=880;gain.gain.setValueAtTime(.08,c.currentTime);gain.gain.exponentialRampToValueAtTime(.001,c.currentTime+.45);oscillator.start();oscillator.stop(c.currentTime+.45);};
 useEffect(()=>{const enable=()=>{try{context.current||=new AudioContext();void context.current.resume().then(beep).catch(()=>{});}catch{}};window.addEventListener('pointerdown',enable);window.addEventListener('keydown',enable);return()=>{window.removeEventListener('pointerdown',enable);window.removeEventListener('keydown',enable);void context.current?.close().catch(()=>{});};},[]);
 useEffect(()=>beep(),[signature]);
 if(!pending.length)return null;
 return <section className="courier-door-alerts" aria-label="Курьер ждёт у двери"><h2><AlertTriangle size={22}/> Срочно · курьер ждёт у клиента · {pending.length}</h2>{pending.map(o=><article key={o.id}><div><b>{o.id}</b><span>Ожидание {elapsed(courierDoorRefusal(o)!.at,now)} · {courierDoorRefusal(o)!.claimedName||'Нужно взять в работу'}</span>{courierDoorPhase(o,now).endsWith('overdue')&&<strong>Срок реакции превышен — требуется помощь руководителя</strong>}</div><button type="button" className="primary" onClick={()=>openOrder(o)}>Открыть срочно</button></article>)}</section>;
}

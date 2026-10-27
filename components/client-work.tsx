'use client';
import {useState} from 'react';
import type {Client} from '@/lib/crm';
import type {ClientReminder} from '@/lib/client-reminders';
import {clientWorkStatus,clientWorkLabels,type ClientWork} from '@/lib/client-work';
const stamp=(at:string)=>new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'})+' МСК';
type Props={client:Client;work?:ClientWork;reminders:ClientReminder[]};
export function ClientWorkSummary({client,work,reminders,now=Date.now()}:Props&{now?:number}){
 const s=clientWorkStatus(client,work,reminders,now);
 return <div className="client-work-summary"><strong className={s.group==='needed'?'orange':''}>{s.group==='planned'?'Перезвон запланирован':s.group==='done'?'Обработан сегодня':'Нужно обработать'}</strong><small>{s.last?(s.last.source==='incoming'?'Входящее обращение обработано':clientWorkLabels[s.last.outcome])+' · '+stamp(s.last.at):'Работа с клиентом ещё не отмечена'}</small>{s.last?.source==='incoming'&&<small>{s.last.comment}{s.last.author?' · '+s.last.author:''}</small>}{s.due&&<small>{s.overdue?'Пора позвонить: ':'Следующий звонок: '}{stamp(s.due)}</small>}{s.expiresBeforeCall&&<small className="orange">Закрепление закончится раньше перезвона</small>}</div>;
}
export function ClientWorkForm({client,work,reminders,busy,mutate,onSaved}:Props&{onSaved:()=>void;busy:boolean;mutate:(p:any)=>Promise<boolean>}){
 const [outcome,setOutcome]=useState<ClientWork['outcome']|''>(''),[due,setDue]=useState('');
 const expires=Date.parse(client.assignedUntil||''),tooLate=!!due&&Date.parse(due+':00+03:00')>=expires;
 const maxDue=Number.isFinite(expires)?new Date(expires-1+3*60*60*1000).toISOString().slice(0,16):undefined;
 return <section className="client-work-form stack"><h3>Работа с клиентом</h3><ClientWorkSummary client={client} work={work} reminders={reminders}/><form className="stack" onSubmit={async e=>{e.preventDefault();if(!outcome||outcome==='callback'&&tooLate)return;if(await mutate({action:'saveClientWork',clientId:client.id,version:work?.version||0,outcome,...(outcome==='callback'?{due:new Date(due+':00+03:00').toISOString()}:{})})){setDue('');onSaved();}}}><div className="client-work-filters">{Object.entries(clientWorkLabels).filter(([key])=>key!=='reached').map(([key,label])=><button type="button" key={key} className={outcome===key?'secondary selected':'secondary'} aria-pressed={outcome===key} disabled={busy} onClick={()=>setOutcome(key as ClientWork['outcome'])}>{label}</button>)}</div>{outcome==='callback'&&<label className="field"><span>Когда перезвонить · Москва</span><input type="datetime-local" required max={maxDue} value={due} disabled={busy} onChange={e=>setDue(e.target.value)}/>{tooLate&&<small className="orange">Выберите время до окончания закрепления клиента.</small>}</label>}<p className="muted">Открытие карточки не считается обработкой. Перезвон появится в ваших напоминаниях и не продлевает закрепление.</p><div><button className="primary" disabled={busy||!outcome||outcome==='callback'&&(!due||tooLate)}>Сохранить результат</button></div></form></section>;
}

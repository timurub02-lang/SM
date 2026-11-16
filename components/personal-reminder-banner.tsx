'use client';
import {Bell} from 'lucide-react';
import type {ClientReminder} from '@/lib/client-reminders';
import {stamp} from '@/lib/crm';
export function PersonalReminderBanner({rows,clients,now,onOpen}:{rows:ClientReminder[];clients:Map<string,{name:string}>;now:number;onOpen:(clientId:string)=>void}){
 const due=rows.filter(r=>Date.parse(r.due)<=now);
 if(!due.length)return null;
 return <section className="call-reminders" aria-label="Личные напоминания"><h3><Bell size={20}/>Пора выполнить напоминания · {due.length}</h3><p>Напоминание останется, пока вы не отметите его выполненным или не отмените в карточке клиента.</p>{due.map(r=><button key={r.id} className="call-reminder" onClick={()=>onOpen(r.clientId)}><span><b>{clients.get(r.clientId)?.name||'Клиент'}</b><small>{stamp(r.due,'Europe/Moscow')} МСК · {r.text}</small></span><span>Открыть напоминание →</span></button>)}</section>;
}

"use client";
import {useEffect,useState} from 'react';
import {journalAction} from '../lib/journal-action';
import {History} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {stamp,type State,type Employee} from '../lib/crm';
type Visit={id:string;at:string;type:'order'|'client';target:string};
export function ActivityJournal({state,actor,detail,onOpen}:{state:State;actor:Employee;detail:{type:'order'|'client';id:string}|null;onOpen:(target:{type:'order'|'client';id:string})=>void}){
 const [open,setOpen]=useState(false),[visits,setVisits]=useState<Visit[]>([]);
 const key='crm-journal:'+actor.id;
 useEffect(()=>{try{const data=JSON.parse(localStorage.getItem(key)||'[]');setVisits(Array.isArray(data)?data.filter(v=>v&&typeof v.id==='string'&&typeof v.target==='string'&&['order','client'].includes(v.type)&&Number.isFinite(Date.parse(v.at))).slice(0,50):[]);}catch{setVisits([]);}},[key]);
 useEffect(()=>{if(!detail)return;setVisits(previous=>{const next=[{id:crypto.randomUUID(),at:new Date().toISOString(),type:detail.type,target:detail.id},...previous.filter(v=>v.type!==detail.type||v.target!==detail.id)].slice(0,50);try{localStorage.setItem(key,JSON.stringify(next));}catch{}return next;});},[key,detail?.type,detail?.id]);
 const allowed=(type:string,id:string)=>{const order=type==='order'?state.orders.find(o=>o.id===id):undefined;const client=state.clients.find(c=>c.id===(order?.clientId||id));if(type==='order'&&!order||!client)return false;const owner=order?.manager||client.owner;return actor.role==='operator'?owner===actor.id:actor.role==='department_head'?!!actor.department&&state.employees.some(e=>e.id===owner&&e.role==='operator'&&e.department===actor.department):true;};
 const actions=state.events.filter(e=>e.actorId===actor.id||!e.actorId&&(e.actor===actor.login||e.actor.endsWith(' · от имени '+actor.name))).map(e=>({id:e.id,at:e.at,type:e.orderId?'order' as const:'client' as const,target:e.orderId||e.clientId,text:journalAction(e.text,actor.role)}));
 const rows=[...visits.map(v=>({...v,text:v.type==='order'?'Просмотр карточки заказа':'Просмотр карточки клиента'})),...actions].filter(r=>allowed(r.type,r.target)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,50);
 return <><button className="secondary" onClick={()=>setOpen(true)}><History size={18}/>Журнал</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Мой журнал</DialogTitle><DialogDescription>Последние 50 записей. Нажмите на запись, чтобы вернуться в карточку. Просмотры сохраняются в этом браузере.</DialogDescription></DialogHeader><div className="journal-timeline" style={{maxHeight:'65vh',overflowY:'auto'}}>{rows.map(r=>{const order=r.type==='order'?state.orders.find(o=>o.id===r.target):undefined;const client=state.clients.find(c=>c.id===(order?.clientId||r.target));return <button className="journal-entry" key={r.id} onClick={()=>{setOpen(false);onOpen({type:r.type,id:r.target});}}><span className="journal-action">{r.text}</span><span className="journal-client">{client?.name}{order?` · ${order.id}`:''}</span><small>{stamp(r.at)} · {actor.login||actor.name}</small></button>;})}{!rows.length&&<p className="muted">Пока нет действий. Открытые карточки и сохранённые изменения появятся здесь.</p>}</div></DialogContent></Dialog></>;
}

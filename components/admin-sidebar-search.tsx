"use client";
import {useState} from 'react';
import {Search} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {BaseClientSearch} from './base-client-search';
import {orderDisplayGroup} from '@/lib/order-premium-stage';
import {orderLocation,statuses,money,total,type Client,type Order,type Employee} from '@/lib/crm';
export function AdminSidebarSearch({actorId,orders,employees,onOpen}:{actorId:string;orders:Order[];employees:Employee[];onOpen:(client:Client,orderId?:string)=>void}){
 const [query,setQuery]=useState(''),[search,setSearch]=useState<string|null>(null);
 const name=(id:string)=>employees.find(e=>e.id===id)?.name||'Не указан';
 function open(client:Client,orderId?:string){setSearch(null);onOpen(client,orderId);}
 return <><form className="sidebar-global-search" onSubmit={e=>{e.preventDefault();if(query.trim().length>=3)setSearch(query.trim());}}><div className="search"><input aria-label="Общий поиск: ФИО, телефон, заказ" placeholder="ФИО, телефон, заказ" minLength={3} maxLength={100} required value={query} onChange={e=>setQuery(e.target.value)}/><button type="submit" className="icon-button" aria-label="Найти клиента или заказ" disabled={query.trim().length<3}><Search size={18}/></button></div></form><Dialog open={search!==null} onOpenChange={v=>{if(!v)setSearch(null);}}><DialogContent className="form-dialog admin-search-dialog"><DialogHeader><DialogTitle>Поиск клиентов и заказов</DialogTitle><DialogDescription>По всем статусам и обеим базам. Доступно только администратору.</DialogDescription></DialogHeader><div className="sheet-body">{search!==null&&<BaseClientSearch key={search} actorId={actorId} initialQuery={search} onOpen={c=>open(c)} details={client=>{const found=orders.filter(o=>o.clientId===client.id);return <div className="stack">{found.length?found.map(o=><button type="button" className="order-mini admin-search-order" key={o.id} onClick={()=>open(client,o.id)}><div><b>{o.id} · {money(total(o))}</b><small>{orderDisplayGroup(o).label} · {statuses[o.status]} · {orderLocation(o)}</small><small>Оператор: {name(o.manager)}{o.logistic?' · Логист: '+name(o.logistic):''}</small><small>{o.items.map(i=>`${i.name} × ${i.quantity}`).join(' · ')}</small></div><span>Открыть →</span></button>):<small className="muted">Нет заказов в CRM. История доступна в карточке клиента.</small>}</div>;}}/>}</div></DialogContent></Dialog></>;
}

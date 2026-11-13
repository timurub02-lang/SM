'use client';
import {useState} from 'react';
import {Search} from 'lucide-react';
import {matchingOperators} from '@/lib/operator-search';
type Operator={id:string;name:string;login?:string};
export function OperatorSelect({operators,value,onChange,label='Оператор',disabled=false,required=false,inline=false}:{operators:Operator[];value:string;onChange:(id:string)=>void;label?:string;disabled?:boolean;required?:boolean;inline?:boolean}){
 const [query,setQuery]=useState('');
 const matches=matchingOperators(operators,query);
 return <div className={`field operator-select${inline?" operator-select-inline":""}`}><span>{label}{required?' *':''}</span><div className="search"><Search size={16}/><input type="search" aria-label={`Поиск: ${label}`} placeholder="Имя или логин оператора" value={query} disabled={disabled} onChange={e=>{setQuery(e.target.value);onChange('');}}/></div><select aria-label={label} required={required} disabled={disabled} value={value} size={!inline&&query.trim()?Math.max(2,Math.min(6,matches.length+1)):undefined} onChange={e=>onChange(e.target.value)}><option value="">{matches.length?'Выберите оператора':'Операторы не найдены'}</option>{matches.map(o=><option key={o.id} value={o.id}>{o.name}{o.login?' · '+o.login:''}</option>)}</select></div>;
}

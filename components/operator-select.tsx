'use client';
import {useState} from 'react';
import {Search} from 'lucide-react';
import {matchingOperators} from '@/lib/operator-search';
import {departments} from '@/lib/crm';
type Operator={id:string;name:string;login?:string;department?:string};
const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
function option(operator:Operator){
 return <option key={operator.id} value={operator.id}>{operator.login||operator.name}</option>;
}
function departmentOptions(matches:Operator[]){
 const groups=new Map<string,Operator[]>();
 for(const operator of matches){
  const id=operator.department||'';
  const label=departments[id as keyof typeof departments]?.replace(/_$/,'')||id;
  const group=groups.get(label);
  if(group)group.push(operator);
  else groups.set(label,[operator]);
 }
 return [...groups].sort(([a],[b])=>Number(!a)-Number(!b)||collator.compare(a,b))
  .map(([label,operators])=><optgroup key={label} label={label||'Без отдела'}>
   {operators.sort((a,b)=>collator.compare(a.login||a.name,b.login||b.name)).map(option)}
  </optgroup>);
}
export function OperatorSelect({operators,value,onChange,label='Оператор',disabled=false,required=false,inline=false,groupByDepartment=false}:{operators:Operator[];value:string;onChange:(id:string)=>void;label?:string;disabled?:boolean;required?:boolean;inline?:boolean;groupByDepartment?:boolean}){
 const [query,setQuery]=useState<string|null>(null);
 const selected=operators.find(o=>o.id===value),search=query??(selected?.login||selected?.name||'');
 const matches=matchingOperators(operators,search);
 return <div className={`field operator-select${inline?" operator-select-inline":""}`}><span>{label}{required?' *':''}</span><div className="search"><Search size={16}/><input type="search" aria-label={`Поиск: ${label}`} placeholder="Имя или логин оператора" value={search} disabled={disabled} onChange={e=>{setQuery(e.target.value);onChange('');}}/></div><select aria-label={label} required={required} disabled={disabled} value={value} size={query?.trim()?Math.max(2,Math.min(6,matches.length+1)):undefined} onChange={e=>{onChange(e.target.value);setQuery(null);}}><option value="">{matches.length?'Выберите оператора':'Операторы не найдены'}</option>{groupByDepartment?departmentOptions(matches):matches.map(option)}</select></div>;
}

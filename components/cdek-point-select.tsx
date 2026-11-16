'use client';
import {useState} from 'react';
import {filterCdekPoints,type SearchableCdekPoint} from '@/lib/cdek-point-search';
export function CdekPointSelect({points,value,onChange,label='ПВЗ получателя',savedLabel,requireCod=false}:{points:SearchableCdekPoint[];value:string;onChange:(code:string)=>void;label?:string;savedLabel?:string;requireCod?:boolean}){
 const [query,setQuery]=useState('');const filtered=filterCdekPoints(points,query),selected=points.find(p=>p.code===value);
 const caption=(p:SearchableCdekPoint)=>(p.sameStreet?'На улице клиента · ':p.samePostalCode?'Индекс клиента · ':'')+p.code+' · '+p.address+' · '+p.workTime+(p.allowedCod===false?' · без наложенного платежа':'');
 return <><input type="search" aria-label={'Поиск: '+label} placeholder="Поиск ПВЗ по адресу или коду" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">Выберите пункт</option>{value&&!filtered.some(p=>p.code===value)&&<option value={value} disabled={requireCod&&!!selected&&!selected.allowedCod}>{selected?caption(selected):savedLabel||value}</option>}{filtered.map(p=><option key={p.code} value={p.code} disabled={requireCod&&!p.allowedCod}>{caption(p)}</option>)}</select>{query.trim()&&<small role="status">{filtered.length?'Найдено ПВЗ: '+filtered.length:'ПВЗ не найдены. Измените поисковый запрос.'}</small>}</>;
}

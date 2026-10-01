'use client';
import {useEffect,useState} from 'react';
type Product={id:string;name:string;tag:string};
export function ProductChoice({value,onChange,label}:{value:string;onChange:(name:string)=>void;label:string}){
 const [products,setProducts]=useState<Product[]>([]),[tag,setTag]=useState('*'),[query,setQuery]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;fetch('/api/warehouse?catalog=1').then(async r=>{const data=await r.json() as {products:Product[];error?:string};if(!r.ok)throw Error(data.error||'Не удалось загрузить товары');if(!cancelled)setProducts(data.products);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[]);
 const tags=[...new Set(products.map(p=>p.tag))].sort((a,b)=>a.localeCompare(b,'ru'));
 const list=products.filter(p=>(tag==='*'||p.tag===tag)&&p.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 return <span className="stack" style={{gap:8}}><select aria-label={`${label}: метка`} value={tag} onChange={e=>setTag(e.target.value)}><option value="*">Все метки</option>{tags.map(t=><option key={t} value={t}>{t||'Без метки'}</option>)}</select><input aria-label={`${label}: поиск`} placeholder="Найти товар" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label={label} required value={value} disabled={loading||!!error} onChange={e=>onChange(e.target.value)}><option value="">{loading?'Загрузка товаров…':'Выберите товар'}</option>{value&&!list.some(p=>p.name===value)&&<option value={value}>{value} · выбран</option>}{list.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select>{error&&<small role="alert">{error}</small>}{!loading&&!error&&!list.length&&<small>Товары не найдены. Измените фильтр или добавьте товар в склад.</small>}</span>;
}

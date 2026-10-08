'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,Check,ChevronDown,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {Command,CommandInput,CommandItem,CommandList} from '@/components/ui/command';
type Product={id:string;name:string;tag:string;available:number;blocked:boolean};
export function ProductChoice({value,onChange,label}:{value:string;onChange:(name:string)=>void;label:string}){
 const [products,setProducts]=useState<Product[]>([]),[tag,setTag]=useState('*'),[query,setQuery]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [open,setOpen]=useState(false),[invalid,setInvalid]=useState(false);
 const search=useRef<HTMLInputElement>(null),errorId=useId();
 useEffect(()=>{let cancelled=false;setLoading(true);setError('');fetch('/api/warehouse?catalog=1',{cache:'no-store'}).then(async r=>{const data=await r.json() as {products:Product[];error?:string};if(!r.ok)throw Error(data.error||'Не удалось загрузить товары');if(!cancelled)setProducts(data.products);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[open]);
 const tags=[...new Set(products.map(p=>p.tag))].sort((a,b)=>a.localeCompare(b,'ru'));
 const list=products.filter(p=>(tag==='*'||p.tag===tag)&&p.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 const selected=products.find(p=>p.name===value);
 function changeOpen(next:boolean){setOpen(next);if(next){setLoading(true);setQuery('');setTag('*');}}
 return <div className="product-choice">
  {/* Keep native form validation for the custom product picker. */}
  <input className="product-choice-validation" tabIndex={-1} aria-hidden="true" required value={value} onChange={()=>{}} onInvalid={e=>{e.preventDefault();setInvalid(true);if(e.currentTarget.form?.querySelector(':invalid')===e.currentTarget)changeOpen(true);}}/>
  <Dialog open={open} onOpenChange={changeOpen}>
   <DialogTrigger asChild><button type="button" className="product-choice-trigger" aria-label={`${label}: ${value||'Выбрать товар'}`} aria-invalid={invalid&&!value} aria-describedby={invalid&&!value?errorId:undefined}><span><strong>{value||'Выбрать товар'}</strong>{selected&&<small>{selected.tag||'Без метки'}</small>}</span><ChevronDown size={17}/></button></DialogTrigger>
   <DialogContent className="product-choice-dialog" showCloseButton={false} aria-describedby={undefined} onOpenAutoFocus={e=>{e.preventDefault();search.current?.focus();}}>
    <div className="product-choice-heading"><DialogTitle>Выберите товар</DialogTitle><button type="button" className="icon-button" aria-label="Закрыть список товаров" onClick={()=>setOpen(false)}><X size={17}/></button></div>
    <Command shouldFilter={false} className="product-choice-command">
     <CommandInput ref={search} aria-label={`${label}: поиск`} placeholder="Найти товар по названию…" value={query} onValueChange={setQuery}/>
     <div className="product-choice-tags" aria-label="Метки товаров"><button type="button" aria-pressed={tag==='*'} onClick={()=>setTag('*')}>Все метки</button>{tags.map(t=><button type="button" key={t} aria-pressed={tag===t} onClick={()=>setTag(t)}>{t||'Без метки'}</button>)}</div>
     <CommandList aria-label="Товары со склада">
      {loading?<p className="product-choice-message" role="status">Загрузка товаров…</p>:error?<p className="product-choice-message orange" role="alert">{error}</p>:!list.length?<p className="product-choice-message" role="status">{products.length?'Товары не найдены. Измените поиск или метку.':'В каталоге пока нет товаров. Добавьте их в разделе «Склад».'}</p>:list.map(p=><CommandItem key={p.id} value={p.id} disabled={p.blocked||!(p.available>0)} onSelect={()=>{if(p.blocked||!(p.available>0))return;onChange(p.name);setInvalid(false);setOpen(false);}} className="product-choice-option"><span><strong>{p.name}</strong><small>{p.tag||'Без метки'}{!p.blocked&&p.available>0&&` · Доступно: ${p.available} шт.`}</small></span><span className="product-choice-action">{p.blocked?'Остаток на сверке':!(p.available>0)?'Нет в наличии':value===p.name?<><Check size={16}/>Выбран</>:<>Выбрать<ArrowRight size={16}/></>}</span></CommandItem>)}
     </CommandList>
    </Command>
   </DialogContent>
  </Dialog>
  {invalid&&!value&&<small className="orange" id={errorId}>Выберите товар из списка</small>}
 </div>;
}

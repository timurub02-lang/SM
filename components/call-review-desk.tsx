'use client';
import {useEffect,useState} from 'react';
import {Check,Headphones} from 'lucide-react';
import type {ReviewRow} from '@/lib/call-reviews';

type Page={rows:ReviewRow[];done:number;pending:number;more:boolean};
const stamp=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
const dateTime=(value:string)=>stamp.format(new Date(value))+' МСК';
const key=(r:ReviewRow)=>r.source+':'+r.id;
export function CallReviewDesk(){
  const [term,setTerm]=useState(''),[employee,setEmployee]=useState(''),[from,setFrom]=useState(''),[until,setUntil]=useState('');
  const [search,setSearch]=useState(''),[status,setStatus]=useState('pending'),[offset,setOffset]=useState(0);
  const [scope,setScope]=useState<{kind:'client'|'order';id:string;label:string}|null>(null);
  const [page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState('');
  const [refresh,setRefresh]=useState(0),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const params=new URLSearchParams(search);
  params.set('status',status);params.set('offset',String(offset));if(scope)params.set(scope.kind,scope.id);
  const query=params.toString();
  useEffect(()=>{
    const ctl=new AbortController();
    setPage(null);setError('');
    (async()=>{
      const res=await fetch('/api/call-reviews?'+query,{cache:'no-store',signal:ctl.signal});
      const data=await res.json() as Page & {error?:string};if(!res.ok)throw Error(data.error||'Не удалось загрузить записи');
      if(!ctl.signal.aborted)setPage(data);
    })().catch(e=>{if(!ctl.signal.aborted)setError(e.message);});
    return ()=>ctl.abort();
  },[query,refresh]);
  const row=page?.rows.find(r=>key(r)===selected)||page?.rows[0];
  function drill(kind:'client'|'order',id:string,label:string){
    setScope({kind,id,label});setOffset(0);setSearch('');setTerm('');setEmployee('');setFrom('');setUntil('');setMessage('');
  }
  async function save(r:ReviewRow){
    setSaving(true);setError('');setMessage('');
    try{
      const res=await fetch('/api/call-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:r.source,id:r.id,revision:r.revision,note:drafts[key(r)]??r.note??''})});
      if(!res.ok)throw Error(((await res.json()) as {error?:string}).error||'Не удалось сохранить отметку');
      setDrafts(v=>{const next={...v};delete next[key(r)];return next;});
      setMessage(r.reviewedAt?'Комментарий сохранён':'Запись перемещена в «Прослушано»');
      if(!r.reviewedAt&&offset&&page?.rows.length===1)setOffset(Math.max(0,offset-25));
      setRefresh(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');}
    finally{setSaving(false);}
  }
  return <section className="review-desk stack" aria-label="Прослушка">
    <form className="review-filters" onSubmit={e=>{e.preventDefault();setOffset(0);setSearch(new URLSearchParams({q:term,employee,from,until}).toString());setMessage('');}}>
      <label className="field">Клиент или заказ<input type="search" placeholder="ФИО, телефон или номер заказа" value={term} maxLength={100} onChange={e=>setTerm(e.target.value)}/></label>
      <label className="field">Сотрудник<input placeholder="Все сотрудники" value={employee} maxLength={100} onChange={e=>setEmployee(e.target.value)}/></label>
      <label className="field">Звонки с<input type="date" value={from} max={until||undefined} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="field">По включительно<input type="date" value={until} min={from||undefined} onChange={e=>setUntil(e.target.value)}/></label>
      <button className="secondary">Найти</button>
    </form>
    {scope&&<div className="action-buttons"><button className="secondary" onClick={()=>{setScope(null);setOffset(0);}}>{scope.label} ×</button></div>}
    <div className="action-buttons">{(['pending','done'] as const).map(s=><button key={s} aria-pressed={status===s} className={status===s?'primary':'secondary'} onClick={()=>{setStatus(s);setOffset(0);setMessage('');}}>{s==='pending'?'К прослушке':'Прослушано'}{page&&' · '+page[s]}</button>)}<button className="text-button" onClick={()=>setRefresh(n=>n+1)}>Обновить</button></div>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error-banner">{error}</p>}
    {!page&&!error&&<p role="status">Загрузка записей…</p>}
    {page&&!row&&<p>Записей по этому отбору нет.</p>}
    {page&&row&&<div className="review-columns">
      <div className="review-list">{page.rows.map(r=><button key={key(r)} disabled={saving} aria-current={key(row)===key(r)} onClick={()=>{setSelected(key(r));setMessage('');}}>
        <small>{dateTime(r.at)} · {r.employee}</small><strong>{r.name||'Клиент'}</strong><span>{r.orderId||'Звонок из карточки клиента'} · {Math.floor((r.seconds||0)/60)}:{String((r.seconds||0)%60).padStart(2,'0')}</span>
      </button>)}</div>
      <article className="review-detail" key={key(row)}>
        <h2>{row.name||'Клиент'}</h2><div><strong>Дата звонка</strong> · {dateTime(row.at)}</div><div>{row.employee}</div>
        <div className="action-buttons">{row.client&&<button className="text-button" onClick={()=>drill('client',row.client,row.name||'Клиент')}>Все звонки клиента</button>}{row.orderId&&<button className="text-button" onClick={()=>drill('order',row.orderId!,row.orderId!)}>Заказ {row.orderId}</button>}</div>
        <audio controls preload="none" aria-label="Запись разговора" src={'/api/call-history/recording?review=1&id='+encodeURIComponent(row.id)+(row.source==='masked'?'&masked=1':'')}/>
        <label className="field">Комментарий к прослушке<textarea rows={3} maxLength={3000} disabled={saving} placeholder="Что важно отметить в этом разговоре?" value={drafts[key(row)]??row.note??''} onChange={e=>setDrafts({...drafts,[key(row)]:e.target.value})}/></label>
        {row.reviewedAt&&<small><Check size={14}/> Прослушала {row.reviewer} · {dateTime(row.reviewedAt)}</small>}
        <button type="button" className="primary" disabled={saving||Boolean(row.reviewedAt&&(drafts[key(row)]??row.note)===row.note)} onClick={()=>void save(row)}><Headphones size={16}/>{row.reviewedAt?'Сохранить комментарий':'Отметить как прослушано'}</button>
      </article>
    </div>}
    {page&&(offset>0||page.more)&&<div className="action-buttons"><button className="secondary" disabled={!offset} onClick={()=>setOffset(offset-25)}>Назад</button><button className="secondary" disabled={!page.more} onClick={()=>setOffset(offset+25)}>Далее</button></div>}
  </section>;
}

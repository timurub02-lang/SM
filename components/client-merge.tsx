'use client';
import {useState} from 'react';
import {BaseClientSearch} from './base-client-search';
import {money,total,statuses,type Client,type Order} from '@/lib/crm';
type Preview={clients:Client[];orders:Order[];owners:{id:string;name:string;login:string}[];revision:string};
export function ClientMerge({first,actorId,onClose,onMerged}:{first:Client;actorId:string;onClose:()=>void;onMerged:(client:Client)=>void}){
 const [selected,setSelected]=useState<Client[]>([first]),[preview,setPreview]=useState<Preview|null>(null),[ownerClientId,setOwner]=useState(''),[phone,setPhone]=useState(first.phone),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
 async function request(action:'preview'|'merge'){
  setBusy(true);setError('');try{
   const r=await fetch('/api/client-merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,ids:selected.map(c=>c.id),ownerClientId,phone,revision:preview?.revision})}),d=await r.json() as Preview & {error?:string;client:Client};
   if(!r.ok)throw Error(d.error||'Не удалось выполнить объединение');
   if(action==='preview'){setPreview(d);setSelected(d.clients);setConfirmed(false);setOwner('');}else onMerged(d.client);
  }catch(e){setError(e instanceof Error?e.message:'Ошибка');if(action==='merge'){setPreview(null);setConfirmed(false);}}finally{setBusy(false);}
 }
 function add(c:Client,ownerName?:string){if(!selected.some(v=>v.id===c.id)&&selected.length<10){setSelected([...selected,Object.assign({},c,{mergeOwnerName:ownerName})]);setPreview(null);setConfirmed(false);}}
 const ownerLabel=(c:Client)=>preview?.owners.find(e=>e.id===c.owner)?.login||(c as Client & {mergeOwnerName?:string}).mergeOwnerName||c.owner||'Не назначен';
 const cards=preview?.clients||selected;
 return <section className="client-merge" aria-label="Сравнение дублей">
  <div className="toolbar client-merge-header"><h3>Найти дубль</h3><button className="secondary" disabled={busy} onClick={onClose}>Вернуться к поиску</button></div>
  <p className="muted">Сравните ФИО, телефоны и адрес. Объединение — только после вашего подтверждения.</p>
  <div className={preview?'client-merge-workspace is-preview':'client-merge-workspace'}>
   <div className="client-merge-selected"><h4>Выбрано карточек: {cards.length}</h4><div className="client-merge-cards">{cards.map(c=><article className="client-merge-card" key={c.id}>
    <div className="client-merge-card-heading"><b>{c.name}</b><small>База {c.baseType==='J'?'Ж':'М'} · {c.sheet}</small></div>
    <div className="client-merge-phones">{[c.phone,...c.linkedPhones||[]].join(', ')}</div>
    <div className="client-merge-address"><span className="muted">Адрес</span><p>{c.address||c.city||'Не указан'}</p></div>
    <div className="client-merge-owner"><span className="muted">Владелец</span><b>{ownerLabel(c)}</b></div>
    {c.owner&&<small className="muted">Срок: {c.assignedUntil?new Date(c.assignedUntil).toLocaleDateString('ru-RU'):'по действующим основаниям закрепления'}</small>}
    {preview&&<details><summary>Заказы: {preview.orders.filter(o=>o.clientId===c.id).length} · история: {c.legacyOrderHistory?.length||0}</summary><div className="client-merge-orders">{preview.orders.filter(o=>o.clientId===c.id).map(o=><small key={o.id}>{o.id} · {statuses[o.status]} · {money(total(o))}</small>)}</div></details>}
    {c.id!==first.id&&<button className="text-button" disabled={busy} onClick={()=>{setSelected(selected.filter(v=>v.id!==c.id));setPreview(null);}}>Убрать из сравнения</button>}
   </article>)}</div></div>
   {!preview&&selected.length<10&&<div className="client-merge-find"><h4>Найти другую карточку</h4><BaseClientSearch comparisonMode actorId={actorId} excludeIds={selected.map(c=>c.id)} selectLabel="Добавить к сравнению →" onOpen={add}/></div>}
  </div>
  {error&&<p role="alert">{error}</p>}
  {!preview?<div className="client-merge-actions"><span className="muted">{selected.length<2?'Добавьте ещё одну карточку для сравнения':'Проверьте выбранные карточки перед объединением'}</span><button className="primary" disabled={busy||selected.length<2} onClick={()=>void request('preview')}>{busy?'Проверяем…':'Сравнить перед объединением'}</button></div>:<>
   <div className="client-merge-fields"><label>Чей владелец и срок сохраняются<select value={ownerClientId} disabled={busy} onChange={e=>{setOwner(e.target.value);setConfirmed(false);}}><option value="">Выберите явно</option>{cards.map(c=><option key={c.id} value={c.id}>{ownerLabel(c)} · {c.phone}</option>)}</select></label><label>Основной телефон<select value={phone} disabled={busy} onChange={e=>{setPhone(e.target.value);setConfirmed(false);}}>{[...new Set(cards.flatMap(c=>[c.phone,...c.linkedPhones||[]]))].map(v=><option key={v}>{v}</option>)}</select></label></div>
   <p className="muted">Остальные телефоны станут дополнительными. Сохраняются ФИО, база и исходные сроки выбранного владельца. История объединится; авторы заказов и премии не меняются. Другие операторы потеряют право работать с клиентом.</p>
   <label className="client-merge-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> Проверил: это один человек, владелец и основной телефон выбраны верно</label>
   <div className="client-merge-actions"><button className="secondary" disabled={busy} onClick={()=>setPreview(null)}>Изменить выбор</button><button className="primary" disabled={busy||!ownerClientId||!confirmed} onClick={()=>void request('merge')}>{busy?'Объединяем…':'Объединить клиентов'}</button></div>
  </>}
 </section>;
}

'use client';
import {useState} from 'react';
import {departments} from '@/lib/crm';
import {retentionDays} from '@/lib/base-distribution';
import type {BaseSettings} from '@/lib/base-policy';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
type Operator={id:string;name:string;login:string;department:string;assignedClients:number};
export function OperatorRetentionWeeks({actorId,config,revision,operators,stats,period,onClose,onSaved}:{actorId:string;config:BaseSettings;revision:string;operators:Operator[];stats:Record<string,{percent:number;coverage:number}>;period:{from:string;to:string};onClose:()=>void;onSaved:()=>void}){
 const [department,setDepartment]=useState('all'),[changes,setChanges]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const available=[...new Set(operators.map(o=>o.department||''))].sort();
 const visible=operators.filter(o=>department==='all'||(o.department||'')===department).sort((a,b)=>b.assignedClients-a.assignedClients||a.name.localeCompare(b.name,'ru'));
 async function save(){
  setBusy(true);setError('');
  try{
   const policies={...config.retention.operators};
   for(const [id,value] of Object.entries(changes)){
    const weeks=Number(value);if(!value.trim()||!Number.isInteger(weeks)||weeks<0||weeks>104)throw Error('Укажите целое число недель от 0 до 104');
    policies[id]={...policies[id],mode:'fixed',days:weeks*7,defaultWeeks:weeks,bands:policies[id]?.bands||[]};
   }
   const r=await fetch(`/api/base?actorId=${encodeURIComponent(actorId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,config:{...config,retention:{...config.retention,operators:policies}}})});
   const result=await r.json() as {error?:string};if(!r.ok)throw Error(result.error||'Не удалось сохранить');onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');}finally{setBusy(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="form-dialog cdek-routing-dialog retention-dialog"><DialogHeader><DialogTitle>Сроки закрепления</DialogTitle><DialogDescription>Срок после последнего выкупа у оператора. Изменения применяются к действующим закреплениям при ближайшем фоновом пересчёте, обычно в течение минуты. Активный заказ сохраняет закрепление.</DialogDescription></DialogHeader><form className="stack" onSubmit={e=>{e.preventDefault();void save();}}><fieldset className="stack" disabled={busy}><label className="field"><span>Отдел</span><select value={department} onChange={e=>setDepartment(e.target.value)}><option value="all">Все отделы</option>{available.map(d=><option key={d} value={d}>{departments[d as keyof typeof departments]||d||'Без отдела'}</option>)}</select></label><div className="stats-table-wrap retention-table-wrap"><table className="stats-table retention-table"><thead><tr><th scope="col">Оператор</th><th scope="col">Клиентов</th><th scope="col">Доля с повтором</th><th scope="col">Срок, недель</th></tr></thead><tbody>{visible.map(o=>{
 const policy=config.retention.operators[o.id],days=retentionDays(policy,stats[o.id]?.percent),value=changes[o.id]??(days%7===0?String(days/7):'');
 return <tr key={o.id}><th scope="row"><strong>{o.name}</strong><small>{o.login}</small></th><td>{o.assignedClients.toLocaleString('ru-RU')}</td><td>{stats[o.id]?`${stats[o.id].coverage.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}%`:'—'}</td><td><input aria-label={`Срок в неделях: ${o.name} · ${o.login}`} type="number" min="0" max="104" step="1" value={value} placeholder={days%7?`${days} дней`:undefined} onChange={e=>setChanges({...changes,[o.id]:e.target.value})}/>{policy?.mode==='statistics'?<small>По продажам; ввод заменит расчёт</small>:days%7?<small>Сейчас {days} дней</small>:null}</td></tr>;
 })}{!visible.length&&<tr><td colSpan={4}>В этом отделе нет операторов.</td></tr>}</tbody></table></div><p className="muted retention-stat-note">Клиентов — закреплены сейчас, включая ПВ, в обеих базах. Доля с повтором — доля клиентов с двумя и более выкупами у оператора за {period.from.split('-').reverse().join('.')}–{period.to.split('-').reverse().join('.')}. Без выкупов — «—».</p><p className="muted">0 недель — без дополнительного удержания после выкупа. Сокращение срока может освободить клиентов, чей срок уже истёк. Изменения в других отделах также сохраняются.</p><button className="primary" disabled={!Object.keys(changes).length}>{busy?'Сохранение…':'Сохранить сроки'}</button></fieldset>{error&&<p role="alert">{error}</p>}</form></DialogContent></Dialog>;
}

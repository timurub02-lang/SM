'use client';
import {useState} from 'react';
import {departments} from '@/lib/crm';
import {retentionDays} from '@/lib/base-distribution';
import type {BaseSettings} from '@/lib/base-policy';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
type Operator={id:string;name:string;login:string;department:string};
export function OperatorRetentionWeeks({actorId,config,revision,operators,stats,onClose,onSaved}:{actorId:string;config:BaseSettings;revision:string;operators:Operator[];stats:Record<string,{percent:number}>;onClose:()=>void;onSaved:()=>void}){
 const [department,setDepartment]=useState('all'),[changes,setChanges]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const available=[...new Set(operators.map(o=>o.department||''))].sort();
 const visible=operators.filter(o=>department==='all'||(o.department||'')===department).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
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
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="form-dialog cdek-routing-dialog"><DialogHeader><DialogTitle>Сроки закрепления</DialogTitle><DialogDescription>Срок после последнего выкупа у оператора. Изменения применяются к действующим закреплениям при ближайшем фоновом пересчёте, обычно в течение минуты. Активный заказ сохраняет закрепление.</DialogDescription></DialogHeader><form className="stack" onSubmit={e=>{e.preventDefault();void save();}}><fieldset className="stack" disabled={busy}><label className="field"><span>Отдел</span><select value={department} onChange={e=>setDepartment(e.target.value)}><option value="all">Все отделы</option>{available.map(d=><option key={d} value={d}>{departments[d as keyof typeof departments]||d||'Без отдела'}</option>)}</select></label><div className="stack" style={{maxHeight:'45vh',overflowY:'auto'}}>{visible.map(o=>{
 const policy=config.retention.operators[o.id],days=retentionDays(policy,stats[o.id]?.percent),value=changes[o.id]??(days%7===0?String(days/7):'');
 return <label className="field" key={o.id}><span>{o.name} · {o.login}</span><input aria-label={`Срок в неделях: ${o.name} · ${o.login}`} type="number" min="0" max="104" step="1" value={value} placeholder={days%7?`${days} дней`:undefined} onChange={e=>setChanges({...changes,[o.id]:e.target.value})}/><small>{policy?.mode==='statistics'?'Сейчас рассчитывается по повторным продажам. Ввод недель заменит этот расчёт фиксированным сроком.':days%7?`Сейчас ${days} дней; без ввода сохраняется прежний срок.`:'Недель после выкупа'}</small></label>;
 })}{!visible.length&&<p>В этом отделе нет операторов.</p>}</div><p className="muted">0 недель — без дополнительного удержания после выкупа. Сокращение срока может освободить клиентов, чей срок уже истёк. Изменения в других отделах также сохраняются.</p><button className="primary" disabled={!Object.keys(changes).length}>{busy?'Сохранение…':'Сохранить сроки'}</button></fieldset>{error&&<p role="alert">{error}</p>}</form></DialogContent></Dialog>;
}

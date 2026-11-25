'use client';
import {SettingsRulesTabs} from './settings-rules-tabs';
import {useEffect,useState} from 'react';
import {Pencil,ArrowUp,ArrowDown,Trash2,CalendarDays,Check,Plus} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {departments} from '@/lib/crm';
import type {RoutingAccount,RoutingConfig,RoutingRule} from '@/lib/cdek-routing';
import {moscowDate} from '@/lib/base-distribution';
import {editableCycleSlots,previewRoutingDay,routingCycleIndex} from '@/lib/cdek-routing';

const days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const everyDay=days.map((_,i)=>i+1);
function thisMonday(today:string){
 const date=new Date(today+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return date.toISOString().slice(0,10);
}
function RoutingSummary({config,accounts,today}:{config:RoutingConfig;accounts:RoutingAccount[];today:string}){
 const monday=thisMonday(today);
 const week=routingCycleIndex(config.cycleStart,today);
 const firstMonday=config.cycleStart&&monday<config.cycleStart?config.cycleStart:monday;
 const firstDate=Date.parse(firstMonday+'T00:00:00Z')-(week===1?7*86400000:0);
 const rows=Array.from({length:config.cycleStart?2:1},(_,row)=>days.map((_,day)=>{
  const date=new Date(firstDate+(row*7+day)*86400000).toISOString().slice(0,10);
  return {date,...previewRoutingDay(config,date)};
 }));
 return <div className="routing-summary">
  <div className="routing-summary-scroll" tabIndex={0} role="region" aria-label="Расписание по дням">
   <table><thead><tr><th scope="col">Неделя</th>{days.map(day=><th key={day} scope="col">{day}</th>)}</tr></thead>
    <tbody>{rows.map((cells,row)=><tr key={row}>
     <th scope="row">{config.cycleStart?(row+1)+'-я':'Каждая'}<small>с {cells[0].date.slice(8)}.{cells[0].date.slice(5,7)}</small></th>
     {cells.map(cell=><td key={cell.date} aria-current={cell.date===today?'date':undefined}>
      {cell.slots.length?cell.slots.map(slot=><span key={slot}>{accounts.find(a=>a.slot===slot)?.name||'Не подключён'}</span>):<span aria-label="Нет выгрузки">—</span>}
      {cell.conditional&&<small>По условиям</small>}
     </td>)}
    </tr>)}</tbody>
   </table>
  </div>
  {rows.some(cells=>cells.some(cell=>cell.conditional))&&<p className="muted">В ячейках «По условиям» аккаунты указаны по приоритету. Выбор зависит от заказа и доступных лимитов.</p>}
 </div>;
}
function DayRow({label,selected,change,weekly=false}:{label:string;selected:number[];change:(days:number[])=>void;weekly?:boolean}){
 return <div className="routing-week" role="group" aria-label={label}>
  <span>{label}</span>
  <div className="routing-days">{days.map((name,i)=>{
   const number=i+1,active=selected.includes(number);
   const last=weekly&&active&&selected.length===1;
   return <button type="button" key={name} aria-label={name} aria-pressed={active} disabled={last}
    title={last?'Чтобы пропустить все дни, выключите правило':undefined}
    onClick={()=>change(active?selected.filter(d=>d!==number):[...selected,number])}>{name}</button>;
  })}</div>
 </div>;
}
export function CdekRoutingSettings({actorId}:{actorId:string}){
 const [open,setOpen]=useState(false),[config,setConfig]=useState<RoutingConfig|null>(null),[accounts,setAccounts]=useState<RoutingAccount[]>([]),[products,setProducts]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!open)return;let active=true;setConfig(null);setError('');fetch(`/api/cdek/routing?actorId=${encodeURIComponent(actorId)}`).then(async r=>{const d=await r.json() as {config:RoutingConfig;accounts:RoutingAccount[];products:string[];error?:string};if(!r.ok)throw Error(d.error);if(active){setConfig(d.config.cycleStart?{...d.config,cycleSlots:editableCycleSlots(d.config)}:d.config);setAccounts(d.accounts.filter((a:RoutingAccount)=>a.configured));setProducts(d.products);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[open,actorId]);
 function patch(id:string,p:Partial<RoutingRule>){setConfig(c=>c?{...c,rules:c.rules.map(r=>r.id===id?{...r,...p}:r)}:c);}
 function move(index:number,delta:number){if(!config)return;const rules=[...config.rules];[rules[index],rules[index+delta]]=[rules[index+delta],rules[index]];setConfig({...config,rules});}
 async function save(){setBusy(true);setError('');try{const r=await fetch(`/api/cdek/routing?actorId=${encodeURIComponent(actorId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,actorId})});const d=await r.json() as {config:RoutingConfig;accounts:RoutingAccount[];products:string[];error?:string};if(!r.ok)throw Error(d.error);setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');}finally{setBusy(false);}}
 const today=moscowDate(),twoWeeks=config?.cycleStart!==undefined;
 const start=config?.cycleStart||'',validMonday=start!==''&&new Date(start+'T00:00:00Z').getUTCDay()===1;
 const week=validMonday?routingCycleIndex(start,today):null;
 return <>
  <button className="sidebar-settings-pencil" type="button" title="Правила распределения СДЭК" aria-label="Настроить распределение СДЭК" onClick={()=>setOpen(true)}><Pencil size={16}/></button>
  <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}>
   <DialogContent className="form-dialog cdek-routing-dialog">
    <DialogHeader><DialogTitle>Куда выгружать заказы СДЭК</DialogTitle><DialogDescription>График выгрузки по аккаунтам · московское время</DialogDescription></DialogHeader>
    <SettingsRulesTabs section="cdek">
     <div className="notice">Заказы отдела A_ всегда уходят на ИП Аскерова.</div>
     {config?<form className="stack" onSubmit={e=>{e.preventDefault();if(!twoWeeks||validMonday)void save();}}>
      <fieldset disabled={busy} className="stack order-fields">
       <label className="routing-check routing-auto"><input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})}/>Автоматически распределять заказы остальных отделов</label>
       {!config.enabled&&<p className="muted">Сейчас аккаунт для этих отделов выбирает логист.</p>}
       <section className="routing-schedule">
        <h3><CalendarDays size={18} aria-hidden="true"/>График выгрузки</h3>
        <div className="routing-mode" role="group" aria-label="Повтор графика">
         <button type="button" aria-pressed={!twoWeeks} onClick={()=>setConfig({...config,cycleStart:undefined})}>{!twoWeeks&&<Check size={16} aria-hidden="true"/>}Каждую неделю</button>
         <button type="button" aria-pressed={twoWeeks} onClick={()=>{if(!twoWeeks)setConfig({...config,cycleStart:thisMonday(today),cycleSlots:editableCycleSlots(config)});}}>{twoWeeks&&<Check size={16} aria-hidden="true"/>}Цикл из двух недель</button>
        </div>
        <p className="routing-selected-mode">Выбран режим «{twoWeeks?'Цикл из двух недель':'Каждую неделю'}»</p>
        {twoWeeks&&<div className="routing-anchor">
         <label className="field"><span>Понедельник первой недели</span>
          <input type="date" required step={7} min="1970-01-05" value={start} aria-invalid={!validMonday} onChange={e=>setConfig({...config,cycleStart:e.target.value})}/>
         </label>
         <p aria-live="polite">{!validMonday?'Выберите понедельник.':week===null?'До начала цикла действует еженедельный график.':`Сейчас идёт ${week===0?'первая':'вторая'} неделя цикла.`} После второй недели повторяется первая.</p>
        </div>}
        {config.enabled&&(!twoWeeks||validMonday)&&<RoutingSummary config={config} accounts={accounts} today={today}/>}
       </section>
       {twoWeeks?<><p className="muted">Один аккаунт на день. Выбор другого аккаунта переносит выгрузку к нему.</p>
        {accounts.map(account=><section className="routing-card" aria-label={account.name} key={account.slot}>
         <h4>{account.name}</h4>
         {[0,1].map(weekIndex=>{
          const slots=config.cycleSlots!;
          const offset=weekIndex*7;
          const selected=everyDay.filter(day=>slots[offset+day-1]===account.slot);
          return <DayRow key={weekIndex} label={weekIndex+1+'-я неделя'} selected={selected} change={next=>{
           const updated=slots.slice();
           for(const day of everyDay){
            const cell=offset+day-1;
            if(next.includes(day))updated[cell]=account.slot;
            else if(updated[cell]===account.slot)updated[cell]=null;
           }
           setConfig({...config,cycleSlots:updated});
          }}/>;
         })}
        </section>)}</>:<>
       <div><h3>Правила по приоритету</h3><p className="muted">CRM выбирает первое подходящее правило с доступным лимитом. Если такого правила нет, выгрузка блокируется.</p></div>
       {config.rules.map((r,index)=>{
        const weekly=r.weekdays.length?r.weekdays:everyDay;
        const account=accounts.find(a=>a.slot===r.slot)?.name||'Аккаунт не подключён';
        return <section className="routing-rule routing-card" key={r.id} aria-label={r.name+' · '+account}>
         <header className="routing-card-head"><div><h4>{account}</h4><small>{index+1}. {r.name}</small></div>
          <label className="routing-check"><input type="checkbox" checked={r.enabled} onChange={e=>patch(r.id,{enabled:e.target.checked})}/>{r.enabled?'Включено':'Выключено'}</label>
         </header>
         <DayRow label="Дни выгрузки" selected={weekly} weekly change={next=>patch(r.id,{weekdays:next})}/>
         <details className="routing-advanced"><summary>Аккаунт, условия и приоритет</summary><div className="stack">
          <div className="routing-tools">
           <button type="button" className="secondary" disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={16}/>Выше</button>
           <button type="button" className="secondary" disabled={index===config.rules.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/>Ниже</button>
           <button type="button" className="secondary" aria-label={'Удалить '+r.name} onClick={()=>setConfig({...config,rules:config.rules.filter(x=>x.id!==r.id)})}><Trash2 size={16}/>Удалить</button>
          </div>
<div className="form-grid"><label className="field"><span>Название правила</span><input required maxLength={120} value={r.name} onChange={e=>patch(r.id,{name:e.target.value})}/></label><label className="field"><span>Аккаунт СДЭК</span><select value={r.slot} onChange={e=>patch(r.id,{slot:Number(e.target.value)})}>{!accounts.some(a=>a.slot===r.slot)&&<option value={r.slot}>Не подключён</option>}{accounts.map(a=><option key={a.slot} value={a.slot}>{a.name}</option>)}</select></label><label className="field"><span>Действует с (пусто — без ограничения)</span><input type="date" value={r.from} onChange={e=>patch(r.id,{from:e.target.value})}/></label><label className="field"><span>По дату включительно</span><input type="date" min={r.from||undefined} value={r.to} onChange={e=>patch(r.id,{to:e.target.value})}/></label></div><fieldset className="routing-options"><legend>Отделы — не отмечено значит все, кроме A_</legend>{Object.entries(departments).filter(([id])=>id!=='5').map(([id,label])=><label className="routing-check" key={id}><input type="checkbox" checked={r.departments.includes(id as '1')} onChange={e=>patch(r.id,{departments:e.target.checked?[...r.departments,id as '1']:r.departments.filter(d=>d!==id)})}/>{label}</label>)}</fieldset>
<details><summary>Главный товар: {r.products.length?r.products.join(', '):'любой'}</summary><div className="routing-products">{[...new Set([...products,...r.products])].map(name=><label className="routing-check" key={name}><input type="checkbox" checked={r.products.includes(name)} onChange={e=>patch(r.id,{products:e.target.checked?[...r.products,name]:r.products.filter(p=>p!==name)})}/>{name}</label>)}{!products.length&&<p>Товары появятся после добавления на склад.</p>}</div></details><div className="form-grid"><label className="field"><span>Считать лимиты за</span><select value={r.period} onChange={e=>patch(r.id,{period:e.target.value as RoutingRule['period']})}><option value="day">День</option><option value="week">Неделю (Пн–Вс)</option><option value="month">Месяц</option><option value="rule">Весь срок правила</option></select></label><label className="field"><span>Не больше заказов (пусто — без лимита)</span><input type="number" min="1" max="1000000" step="1" value={r.maxCount??''} onChange={e=>patch(r.id,{maxCount:e.target.value===''?null:Number(e.target.value)})}/></label><label className="field"><span>Не больше суммы товаров, ₽</span><input type="number" min="0.01" max="1000000000" step="0.01" value={r.maxAmount??''} placeholder="Без лимита" onChange={e=>patch(r.id,{maxAmount:e.target.value===''?null:Number(e.target.value)})}/></label></div>
          <p className="muted">Лимиты относятся ко всем выгрузкам аккаунта за выбранный период. Сумма считается по корзине без доставки.</p>
         </div></details>
        </section>;
       })}</>}
       <div className="routing-footer">
        {!twoWeeks&&<button type="button" className="secondary" disabled={!accounts.length||config.rules.length>=100} onClick={()=>setConfig({...config,rules:[...config.rules,{id:crypto.randomUUID(),name:`Правило ${config.rules.length+1}`,enabled:true,slot:accounts[0].slot,from:'',to:'',departments:[],products:[],weekdays:[],period:'week',maxCount:null,maxAmount:null}]})}><Plus size={16}/>Добавить правило</button>}
        <button type="submit" disabled={twoWeeks&&!validMonday} className="primary">{busy?'Сохранение…':'Сохранить настройки'}</button>
       </div>
      </fieldset>
     </form>:!error&&<p>Загрузка…</p>}
     {error&&<p role="alert" className="orange">{error}</p>}
    </SettingsRulesTabs>
   </DialogContent>
  </Dialog>
 </>;
}

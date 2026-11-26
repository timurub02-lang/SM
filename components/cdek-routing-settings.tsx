'use client';
import {SettingsRulesTabs} from './settings-rules-tabs';
import {useEffect,useState} from 'react';
import {Pencil,CalendarDays} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {defaultDepartmentAWeek,departmentAAccount} from '@/lib/cdek-accounts';
import type {RoutingAccount,RoutingConfig} from '@/lib/cdek-routing';
import {moscowDate} from '@/lib/base-distribution';
import {cycleSettingsForEdit,previewRoutingDay,routingCycleIndex} from '@/lib/cdek-routing';

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
function DayRow({label,selected,change}:{label:string;selected:number[];change:(days:number[])=>void}){
 return <div className="routing-week" role="group" aria-label={label}><span>{label}</span>
  <div className="routing-days">{days.map((name,i)=><button key={name} type="button" aria-pressed={selected.includes(i+1)} onClick={()=>change(selected.includes(i+1)?selected.filter(n=>n!==i+1):[...selected,i+1])}>{name}</button>)}</div></div>;
}
export function CdekRoutingSettings({actorId}:{actorId:string}){
 const [open,setOpen]=useState(false),[config,setConfig]=useState<RoutingConfig|null>(null),[accounts,setAccounts]=useState<RoutingAccount[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!open)return;let active=true;setConfig(null);setError('');fetch(`/api/cdek/routing?actorId=${encodeURIComponent(actorId)}`).then(async r=>{const d=await r.json() as {config:RoutingConfig;accounts:RoutingAccount[];products:string[];error?:string};if(!r.ok)throw Error(d.error);if(active){setConfig({...cycleSettingsForEdit(d.config),cycleStart:d.config.cycleStart||d.config.savedCycleStart||thisMonday(moscowDate()),departmentAWeek:d.config.departmentAWeek??(d.accounts.some(a=>a.configured&&departmentAAccount(a))?defaultDepartmentAWeek(d.accounts):undefined)});setAccounts(d.accounts.filter((a:RoutingAccount)=>a.configured));}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[open,actorId]);
 async function save(){setBusy(true);setError('');try{const r=await fetch(`/api/cdek/routing?actorId=${encodeURIComponent(actorId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,actorId})});const d=await r.json() as {config:RoutingConfig;accounts:RoutingAccount[];products:string[];error?:string};if(!r.ok)throw Error(d.error);setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');}finally{setBusy(false);}}
 const scheduleAccounts=accounts.filter(account=>!departmentAAccount(account));
 const aAccounts=accounts.filter(departmentAAccount);
 const today=moscowDate(),twoWeeks=config?.cycleStart!==undefined;
 const autoEnabled=twoWeeks?config?.cycleEnabled:config?.enabled;
 const start=config?.cycleStart||'',validMonday=start!==''&&new Date(start+'T00:00:00Z').getUTCDay()===1;
 const week=validMonday?routingCycleIndex(start,today):null;
 return <>
  <button className="sidebar-settings-pencil" type="button" title="Правила распределения СДЭК" aria-label="Настроить распределение СДЭК" onClick={()=>setOpen(true)}><Pencil size={16}/></button>
  <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}>
   <DialogContent className="form-dialog cdek-routing-dialog">
    <DialogHeader><DialogTitle>Куда выгружать заказы СДЭК</DialogTitle><DialogDescription>График выгрузки по аккаунтам · московское время</DialogDescription></DialogHeader>
    <SettingsRulesTabs section="cdek">

     {config?<form className="stack" onSubmit={e=>{e.preventDefault();if(!twoWeeks||validMonday)void save();}}>
      <fieldset disabled={busy} className="stack order-fields">
       <section className="routing-schedule"><h3>Отдел А_ · недельный график</h3>
        {aAccounts.length?<div className="form-grid">{days.map((day,i)=><label className="field" key={day}><span>{day}</span>
         <select aria-label={'Отдел А_ · '+day} value={config.departmentAWeek?.[i]||''} onChange={e=>{
          const week=[...(config.departmentAWeek??defaultDepartmentAWeek(aAccounts))];week[i]=Number(e.target.value);setConfig({...config,departmentAWeek:week});
         }}>{aAccounts.map(a=><option key={a.slot} value={a.slot}>{a.name}</option>)}</select></label>)}</div>:<p>Подключите аккаунт «Только отдел А_» в настройках интеграции СДЭК.</p>}
       </section>
       <label className="routing-check routing-auto"><input type="checkbox" checked={!!autoEnabled} onChange={e=>setConfig({...config,[twoWeeks?'cycleEnabled':'enabled']:e.target.checked})}/>Автоматически распределять заказы остальных отделов</label>
       {!autoEnabled&&<p className="muted">Сейчас аккаунт для этих отделов выбирает логист.</p>}
       <section className="routing-schedule">
        <h3><CalendarDays size={18} aria-hidden="true"/>Все отделы, кроме А_ · цикл из двух недель</h3>
        {twoWeeks&&<div className="routing-anchor">
         <label className="field"><span>Понедельник первой недели</span>
          <input type="date" required step={7} min="1970-01-05" value={start} aria-invalid={!validMonday} onChange={e=>setConfig({...config,cycleStart:e.target.value})}/>
         </label>
         <p aria-live="polite">{!validMonday?'Выберите понедельник.':week===null?'До начала цикла действует еженедельный график.':`Сейчас идёт ${week===0?'первая':'вторая'} неделя цикла.`} После второй недели повторяется первая.</p>
        </div>}
        {autoEnabled&&(!twoWeeks||validMonday)&&<RoutingSummary config={config} accounts={accounts} today={today}/>}
       </section>
       <p className="muted">Один аккаунт на день. Выбор другого аккаунта переносит выгрузку к нему.</p>
        {scheduleAccounts.map(account=><section className="routing-card" aria-label={account.name} key={account.slot}>
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
        </section>)}
       <div className="routing-footer">

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

import {CalendarDays,ChevronDown} from 'lucide-react';
import {useState} from 'react';
import {departments,type Employee} from '@/lib/crm';
import {coversHead,moscowWorkDay} from '@/lib/head-vacation';
import {Switch} from '@/components/ui/switch';

type Save=(payload:Record<string,unknown>)=>Promise<boolean>;
export function VacationForm({head,staff,busy,save}:{head:Employee;staff:Employee[];busy:boolean;save:Save}){
 const [open,setOpen]=useState(false);
 const current=head.vacation;
 const options=staff.filter(x=>x.role==='department_head'&&x.department&&x.department!==head.department);
 return <section className="vacation-panel"><button type="button" className="vacation-heading" aria-expanded={open} onClick={()=>setOpen(!open)}>
  <CalendarDays size={20} aria-hidden="true"/>
  <span>Отпуск и замещение</span>
  <ChevronDown size={18} className="vacation-chevron" aria-hidden="true"/>
 </button>{open&&<form className="vacation-fields" key={head.version} onSubmit={async event=>{
  event.preventDefault();
  const fields=new FormData(event.currentTarget);
  if(await save({action:'headVacation',operation:'schedule',id:head.id,version:head.version,from:fields.get('from'),until:fields.get('until'),substitute:fields.get('substitute')}))setOpen(false);
 }}>
 <header><strong>Отпуск · {head.name}</strong><p>Выберите руководителя, который будет помогать отделу в эти дни.</p></header>
 <div className="vacation-dates">
 <label className="field">Первый день отпуска<input required type="date" name="from" defaultValue={current?.from||moscowWorkDay()}/></label>
 <label className="field">Последний день отпуска<input required type="date" name="until" defaultValue={current?.until}/></label>
 </div>
 <label className="field">Кто замещает<select className="pick" required name="substitute" defaultValue={current?.substitute||''}><option value="">Выберите руководителя</option>{options.map(x=><option key={x.id} value={x.id}>{x.name} · {departments[x.department!]}</option>)}</select></label>
 <div className="action-buttons"><button className="primary" disabled={busy}>Сохранить замещение</button>{current&&<button type="button" className="secondary" disabled={busy} onClick={()=>save({action:'headVacation',operation:'end',id:head.id,version:head.version})}>Завершить замещение</button>}</div>
 </form>}</section>;
}
export function VacationSwitches({actor,staff,busy,save}:{actor:Employee;staff:Employee[];busy:boolean;save:Save}){
 return <>{staff.filter(head=>coversHead(actor,head)).map(head=><label key={head.id} className="sidebar-settings-toggle"><Switch checked={!!head.vacation?.enabled} disabled={busy} onCheckedChange={enabled=>void save({action:'headVacation',operation:'toggle',id:head.id,version:head.version,enabled})}/>Показывать также отдел {departments[head.department!]} · {head.name}</label>)}</>;
}

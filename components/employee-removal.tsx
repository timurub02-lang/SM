'use client';
import {useState} from 'react';
import type {Employee,State} from '@/lib/crm';
export function EmployeeRemoval({employee,creator,state,busy,onDelete}:{employee:Employee;creator:Employee;state:State;busy:boolean;onDelete:(mode:string,targetId:string)=>Promise<void>}){
 const [open,setOpen]=useState(false),[mode,setMode]=useState('transfer'),[targetId,setTargetId]=useState(''),[confirmed,setConfirmed]=useState(false);
 if(creator.id===employee.id)return <p className="muted">Собственную учётную запись удалить нельзя.</p>;
 if(creator.role!=='admin'&&!(creator.role==='department_head'&&employee.role==='operator'&&creator.department&&creator.department===employee.department))return null;
 const targets=state.employees.filter(e=>e.id!==employee.id&&e.role==='operator'&&!!employee.department&&e.department===employee.department);
 const clients=state.clients.filter(c=>c.owner===employee.id);
 const orders=state.orders.filter(o=>o.manager===employee.id||clients.some(c=>c.id===o.clientId));
 return <section className="stack" style={{borderTop:'1px solid #e5e7eb',paddingTop:16}} aria-label="Удаление сотрудника">
 <button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(!open)}>{open?'Отменить удаление':'Удалить сотрудника'}</button>
 {open&&<><h3>Удаление: {employee.name}</h3><p>Клиентов: {clients.length}. Заказов во всех статусах: {orders.length}. Доступ сотрудника будет закрыт, история сохранится.</p>
 <label className="field"><span>Клиенты и заказы</span><select disabled={busy} value={mode} onChange={e=>{setMode(e.target.value);setConfirmed(false);}}><option value="transfer">Передать другому оператору того же отдела</option><option value="release">Освободить клиентов без передачи</option></select></label>
 {mode==='transfer'?<><label className="field"><span>Кому передать</span><select disabled={busy} value={targetId} onChange={e=>{setTargetId(e.target.value);setConfirmed(false);}}><option value="">Выберите оператора</option>{targets.map(e=><option key={e.id} value={e.id}>{e.name} · {e.login}</option>)}</select></label>{!targets.length&&<p className="notice">В этом отделе нет другого оператора для передачи. Можно добавить его или выбрать освобождение клиентов.</p>}</>:<p className="notice">Все клиенты станут свободными. С активными заказами — лист «К». Без активных заказов, но с выкупами — «ТК», без ожидания 5 недель. Остальные — исходный лист; без заказов — лист возврата, по умолчанию «Т1». Статусы заказов сохранятся, оператор не будет назначен.</p>}
 <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> Подтверждаю удаление сотрудника и выбранное действие с клиентами и заказами</label>
 <button type="button" className="secondary" style={{color:'#b42318'}} disabled={busy||!confirmed||(mode==='transfer'&&!targetId)} onClick={()=>void onDelete(mode,targetId)}>{busy?'Удаление…':'Подтвердить удаление'}</button></>}
 </section>;
}

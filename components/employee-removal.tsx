'use client';
import {useState} from 'react';
import type {Employee,State} from '@/lib/crm';
export function EmployeeRemoval({employee,creator,state,busy,onDelete}:{employee:Employee;creator:Employee;state:State;busy:boolean;onDelete:(mode:string,targetId:string)=>Promise<void>}){
 const [open,setOpen]=useState(false),[mode,setMode]=useState('release'),[targetId,setTargetId]=useState(''),[confirmed,setConfirmed]=useState(false);
 if(employee.dismissedAt)return <p className="muted">Уволен. Карточка сохранена для расчётов и истории.</p>;
 if(creator.id===employee.id)return <p className="muted">Собственную учётную запись удалить нельзя.</p>;
 if(creator.role!=='admin'&&!(creator.role==='department_head'&&employee.role==='operator'&&creator.department&&creator.department===employee.department))return null;
 const archive=employee.role==='operator';
 const targets=state.employees.filter(e=>!e.dismissedAt&&e.accessEnabled!==false&&e.id!==employee.id&&e.role==='operator'&&!!employee.department&&e.department===employee.department);
 const clients=state.clients.filter(c=>c.owner===employee.id);
 const orders=state.orders.filter(o=>o.manager===employee.id||clients.some(c=>c.id===o.clientId));
 return <section className="stack" style={{borderTop:'1px solid #e5e7eb',paddingTop:16}} aria-label="Удаление сотрудника">
 <button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(!open)}>{open?'Отмена':archive?'Уволить оператора':'Удалить сотрудника'}</button>
 {open&&<><h3>{archive?'Увольнение':'Удаление'}: {employee.name}</h3><p>Клиентов: {clients.length}. Заказов во всех статусах: {orders.length}. Доступ сотрудника будет закрыт, история сохранится.</p>
 {archive&&<p>Карточка останется в архиве. Премия по прежним заказам сохранится у оператора и будет учитываться для премии руководителя по действующим правилам.</p>}
 {creator.role==='admin'&&<label className="field"><span>Клиенты и заказы</span><select disabled={busy} value={mode} onChange={e=>{setMode(e.target.value);setConfirmed(false);}}><option value="transfer">Передать другому оператору того же отдела</option><option value="release">Освободить клиентов без передачи</option></select></label>}
 {mode==='transfer'?<label className="field"><span>Кому передать</span><select disabled={busy} value={targetId} onChange={e=>{setTargetId(e.target.value);setConfirmed(false);}}><option value="">Выберите оператора</option>{targets.map(e=><option key={e.id} value={e.id}>{e.name} · {e.login}</option>)}</select></label>:<p className="notice">{archive?'Клиенты без незавершённых заказов открепятся сразу. Остальные останутся закреплёнными до оплаты, отмены или возврата всех незавершённых заказов. Заказы продолжат работу у руководителя и логистов.':'Клиенты будут освобождены, заказы и история сохранятся без оператора.'}</p>}
 <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> Подтверждаю выбранное действие</label>
 <button type="button" className="secondary" style={{color:'#b42318'}} disabled={busy||!confirmed||(mode==='transfer'&&!targetId)} onClick={()=>void onDelete(mode,targetId)}>{busy?'Сохранение…':archive?'Подтвердить увольнение':'Подтвердить удаление'}</button></>}
 </section>;
}

'use client';
import {useEffect,useState} from 'react';
import type {baseStats} from '../lib/base-stats';
import {departments} from '../lib/crm';

export function BaseStats({actorId}:{actorId:string}){
 const [rows,setRows]=useState<ReturnType<typeof baseStats>>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/operator-statistics?section=base&actorId=${encodeURIComponent(actorId)}`,{signal:controller.signal}).then(async response=>{
   const data=await response.json() as {rows:ReturnType<typeof baseStats>;error?:string};if(!response.ok)throw Error(data.error||'Не удалось загрузить базу');return data.rows;
  }).then(rows=>{if(!controller.signal.aborted)setRows(rows);}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[actorId]);
 if(loading)return <p role="status">Загрузка базы…</p>;
 if(error)return <p role="alert">{error}</p>;
 return <><p className="muted">Текущее количество закреплённых клиентов в обеих базах, включая ПВ. У руководителя — клиенты операторов его отдела. Период заказов не применяется.</p><div className="stats-results"><div className="stats-table-wrap"><table className="stats-table"><thead><tr><th>Сотрудник</th><th>Логин</th><th>Отдел</th><th>Клиентов</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.name}{r.role==='department_head'?' · руководитель':''}</td><td>{r.login}</td><td>{r.department?departments[r.department]||r.department:'Без отдела'}</td><td>{r.clients.toLocaleString('ru-RU')}</td></tr>)}</tbody></table></div>{!rows.length&&<p>Сотрудники не найдены.</p>}</div></>;
}

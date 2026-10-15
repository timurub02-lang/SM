'use client';
import {useEffect,useState} from 'react';
import {statuses} from '@/lib/crm';
import {cdekStatuses} from '@/lib/cdek-statuses';
export function PhoneReplacementSettings(){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[numbers,setNumbers]=useState('');
 async function request(body?:any){setBusy(true);setError('');try{const r=await fetch('/api/phone-replacement',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined),v:any=await r.json();if(!r.ok)throw Error(v.error);setData(v);if(body?.action==='import')setNumbers('');}catch(e){setError(e instanceof Error?e.message:'Ошибка');}finally{setBusy(false);}}
 useEffect(()=>{void request();},[]);
 const date=(v:string)=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
 if(!data)return <p>{error||'Загрузка…'}</p>;
 const change=(key:string,value:any)=>setData({...data,config:{...data.config,[key]:value}}),free=data.numbers.filter((n:any)=>!n.order_id).length;
 return <div className="stack">{error&&<p role="alert" className="notice">{error}</p>}<p><strong>Всего: {data.numbers.length} · Свободно: {free} · Закреплено: {data.numbers.length-free}</strong></p>
 <p className="muted">Последняя связь с АТС: {date(data.health?.at)}</p><label><input type="checkbox" checked={data.config.enabled} onChange={e=>change('enabled',e.target.checked)}/> Подменять телефон при выгрузке в СДЭК</label>
 <p className="muted">Номер соединяет с текущим основным телефоном клиента. Пока соединение выключено — гудки 60 секунд. При отсутствии свободных номеров заказ отправится с реальным телефоном; при сбое сервиса выгрузка остановится.</p>
 <label>Предупреждать администратора, когда свободных номеров меньше<input type="number" min={0} value={data.config.threshold} onChange={e=>change('threshold',Number(e.target.value))}/></label>
 <p className="muted">При совпадении правил: освобождение, затем выключение, затем включение. Изменённые правила применяются при следующем изменении статуса заказа.</p>
 {(['enable','disable','release'] as const).map((key,i)=><fieldset key={key}><legend>{['Включать соединение','Выключать соединение','Освобождать номер'][i]}</legend><div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:16}}>{(['crm','cdek'] as const).map(source=><label key={source}>Статусы {source==='crm'?'CRM':'СДЭК'}<select multiple size={7} value={data.config[key][source]} onChange={e=>change(key,{...data.config[key],[source]:Array.from(e.target.selectedOptions,o=>o.value)})}>{(source==='crm'?Object.entries(statuses).map(([code,label])=>({code,label})):cdekStatuses).map(o=><option key={o.code} value={o.code}>{o.label}</option>)}</select></label>)}</div></fieldset>)}
 <button className="primary" disabled={busy} onClick={()=>request({action:'save',config:data.config})}>Сохранить настройки</button>
 <h3>Добавить подменные номера</h3><textarea aria-label="Номера для подмены" placeholder="По одному номеру в строке" value={numbers} onChange={e=>setNumbers(e.target.value)}/><button className="secondary" disabled={busy||!numbers.trim()} onClick={()=>request({action:'import',numbers:numbers.split(/\n|;/).map(n=>n.trim()).filter(Boolean)})}>Загрузить номера</button>
 <div style={{overflow:'auto',maxHeight:350}}><table><thead><tr><th>Номер</th><th>Использований</th><th>Последнее назначение, МСК</th><th>Заказ / состояние</th></tr></thead><tbody>{data.numbers.map((n:any)=><tr key={n.number}><td>+{n.number}</td><td>{n.uses}</td><td>{date(n.last_assigned_at)}</td><td>{n.order_id?`${n.order_id} · ${n.client_name} · ${n.connected?'соединение включено':'соединение выключено'}`:'Свободен'}</td></tr>)}</tbody></table></div>
 <h3>История закреплений</h3><p className="muted">Последние 1000 закреплений. Время московское.</p><div style={{overflow:'auto',maxHeight:400}}><table><thead><tr><th>Номер</th><th>Заказ / клиент</th><th>Назначен</th><th>Освобождён / причина</th></tr></thead><tbody>{data.history.map((a:any)=><tr key={a.id}><td>+{a.number}</td><td>{a.order_id}<br/>{a.client_name}</td><td>{date(a.assigned_at)}</td><td>{a.released_at?`${date(a.released_at)} · ${a.release_reason}`:'Закреплён'}</td></tr>)}</tbody></table></div></div>;
}

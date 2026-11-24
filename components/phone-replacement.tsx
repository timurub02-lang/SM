'use client';
import {useEffect,useRef,useState} from 'react';
import {statuses} from '@/lib/crm';
import {Tabs,TabsList,TabsTrigger,TabsContent} from './ui/tabs';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from './ui/alert-dialog';
import {cdekStatuses} from '@/lib/cdek-statuses';
import {readReplacementCsv} from '@/lib/replacement-csv';
export function PhoneReplacementSettings(){
 const csvInput=useRef<HTMLInputElement>(null);
 const [warnRemoved,setWarnRemoved]=useState(false);
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[numbers,setNumbers]=useState('');
 const [csv,setCsv]=useState<{name:string;numbers:string[]}|null>(null);
 const [importNotice,setImportNotice]=useState('');
 async function chooseCsv(file:File) {
   setBusy(true);
   setCsv(null);
   setError('');
   setImportNotice('');
   try {
     if(file.size>5*1024*1024) throw Error('Размер CSV должен быть до 5 МБ');
     setCsv({name:file.name,numbers:readReplacementCsv(await file.arrayBuffer())});
   } catch(e) {
     setError(e instanceof Error?e.message:'Не удалось прочитать CSV');
   } finally {
     setBusy(false);
   }
 }
 async function request(body?:any){
   setBusy(true);setError('');setImportNotice('');
   try {
     const r=await fetch('/api/phone-replacement',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
     const v=await r.json() as {error?:string};
     if(!r.ok)throw Error(v.error);
     setData(v);
     if(body?.action==='import'){
       if(csv)setCsv(null);else setNumbers('');
       setImportNotice('Загрузка завершена. Список подменных номеров обновлён.');
     }
   } catch(e){setError(e instanceof Error?e.message:'Ошибка');}
   finally{setBusy(false);}
 }
 useEffect(()=>{void request();},[]);
 const date=(v:string)=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
 if(!data)return <p>{error||'Загрузка…'}</p>;
 const change=(key:string,value:any)=>setData({...data,config:{...data.config,[key]:value}}),free=data.numbers.filter((n:any)=>!n.order_id).length;
 const existingNumbers = new Set(data.numbers.map((n:{number:string})=>n.number));
 const newNumbers = csv?.numbers.filter(number=>!existingNumbers.has(number));
 return <div className="stack replacement-settings">{error&&<p role="alert" className="notice">{error}</p>}<p><strong>Всего: {data.numbers.length} · Свободно: {free} · Закреплено: {data.numbers.length-free}</strong></p>
 <p className="muted">Последняя связь с АТС: {date(data.health?.at)}</p><label><input type="checkbox" checked={data.config.enabled} onChange={e=>change('enabled',e.target.checked)}/> Подменять телефон при выгрузке в СДЭК</label>
 <p className="muted">Номер соединяет с текущим основным телефоном клиента. Обратный звонок с основного или дополнительного телефона клиента направляется последнему звонившему через этот номер в рамках текущего заказа. Пока соединение выключено — гудки 60 секунд. При отсутствии свободных номеров заказ отправится с реальным телефоном; при сбое сервиса выгрузка остановится.</p>
 <label>Предупреждать администратора, когда свободных номеров меньше<input type="number" min={0} value={data.config.threshold} onChange={e=>change('threshold',Number(e.target.value))}/></label>
 <p className="muted">Соединение разрешено, если текущий статус CRM или СДЭК отмечен галочкой. Если совпадений нет — только гудки 60 секунд. Изменения действуют после сохранения. Освобождение номера имеет приоритет.</p>
 <Tabs defaultValue="enable" className="replacement-status-tabs"><TabsList aria-label="Правила подменного номера"><TabsTrigger value="enable">Статусы, при которых можно соединять с клиентом</TabsTrigger><TabsTrigger value="release">Освобождать номер</TabsTrigger></TabsList>
 {(['enable','release'] as const).map((key,i)=><TabsContent key={key} value={key}><fieldset><legend>{['Статусы, при которых можно соединять с клиентом','Освобождать номер'][i]}</legend><div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:16}}>{(['crm','cdek'] as const).map(source=><div key={source} className="replacement-statuses"><strong>Статусы {source==='crm'?'CRM':'СДЭК'}</strong><div className="replacement-status-list">{(source==='crm'?Object.entries(statuses).map(([code,label])=>({code,label})):cdekStatuses).map(o=><label key={o.code}><input type="checkbox" checked={data.config[key][source].includes(o.code)} onChange={e=>{if(key==='release'&&source==='cdek'&&o.code==='REMOVED'&&e.target.checked){setWarnRemoved(true);return;}change(key,{...data.config[key],[source]:e.target.checked?[...data.config[key][source],o.code]:data.config[key][source].filter((v:string)=>v!==o.code)});}}/><span>{o.label}</span></label>)}</div></div>)}</div></fieldset></TabsContent>)}</Tabs>
 <AlertDialog open={warnRemoved} onOpenChange={setWarnRemoved}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Освобождать номер при удалении из СДЭК?</AlertDialogTitle><AlertDialogDescription>Обычно при возврате заказа из СДЭК на сборку подменный номер сохраняется для повторной выгрузки. Если включить «Удалён», после подтверждения удаления накладной номер освободится и сможет перейти другому заказу. При повторной выгрузке может назначиться другой номер. Чтобы сохранить прежнюю логику, оставьте галочку снятой. Изменение вступит в силу только после сохранения настроек.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Оставить номер за заказом</AlertDialogCancel><AlertDialogAction onClick={()=>change('release',{...data.config.release,cdek:[...data.config.release.cdek,'REMOVED']})}>Всё равно включить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 <button className="primary" disabled={busy} onClick={()=>request({action:'save',config:data.config})}>Сохранить настройки</button>
 <h3>Добавить подменные номера</h3>
 <button type="button" className="primary" disabled={busy} aria-describedby="replacement-csv-format" onClick={()=>csvInput.current?.click()}>Выбрать CSV-файл</button>
 <p id="replacement-csv-format" className="muted">В файле нужен столбец «Номер телефона».</p>
 <input ref={csvInput} type="file" hidden accept=".csv,text/csv" disabled={busy} onChange={e=>{
     const file=e.currentTarget.files?.[0];
     e.currentTarget.value='';
     if(file)void chooseCsv(file);
   }}/>
 {csv && newNumbers ? <>
   <p role="status">{csv.name} · Уникальных номеров: {csv.numbers.length} · Уже в списке: {csv.numbers.length-newNumbers.length} · К добавлению: {newNumbers.length}</p>
   <button className="secondary" disabled={busy} onClick={()=>setCsv(null)}>Убрать файл</button>
 </> : <textarea aria-label="Номера для подмены" placeholder="По одному номеру в строке" value={numbers} onChange={e=>setNumbers(e.target.value)}/>}
 <button className="secondary" disabled={busy||(newNumbers ? !newNumbers.length : !numbers.trim())} onClick={()=>request({action:'import',numbers:newNumbers??numbers.split(/\n|;/).map(n=>n.trim()).filter(Boolean)})}>Загрузить номера</button>
 {importNotice&&<p role="status">{importNotice}</p>}
 <div style={{overflow:'auto',maxHeight:350}}><table><thead><tr><th>Номер</th><th>Использований</th><th>Последнее назначение, МСК</th><th>Заказ / состояние</th></tr></thead><tbody>{data.numbers.map((n:any)=><tr key={n.number}><td>+{n.number}</td><td>{n.uses}</td><td>{date(n.last_assigned_at)}</td><td>{n.order_id?`${n.order_id} · ${n.client_name} · ${n.connected?'соединение включено':'соединение выключено'}`:'Свободен'}</td></tr>)}</tbody></table></div>
 <h3>История закреплений</h3><p className="muted">Последние 1000 закреплений. Время московское.</p><div style={{overflow:'auto',maxHeight:400}}><table><thead><tr><th>Номер</th><th>Заказ / клиент</th><th>Назначен</th><th>Освобождён / причина</th></tr></thead><tbody>{data.history.map((a:any)=><tr key={a.id}><td>+{a.number}</td><td>{a.order_id}<br/>{a.client_name}</td><td>{date(a.assigned_at)}</td><td>{a.released_at?`${date(a.released_at)} · ${a.release_reason}`:'Закреплён'}</td></tr>)}</tbody></table></div></div>;
}

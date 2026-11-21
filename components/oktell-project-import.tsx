'use client';
import {useEffect,useRef,useState} from 'react';
import type {ImportInventory,ImportOptions,ImportPreview,ImportReceipt} from '@/lib/oktell-project-import';
import styles from './oktell-projects.module.css';

export default function ProjectImport({projectId,disabled}:{projectId:string;disabled:boolean}){
 const [inventory,setInventory]=useState<ImportInventory|null>(null),[file,setFile]=useState<File|null>(null),[options,setOptions]=useState<ImportOptions>({projectId,name:0,city:0});
 const [preview,setPreview]=useState<ImportPreview|null>(null),[receipt,setReceipt]=useState<ImportReceipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [checked,setChecked]=useState(false);const lock=useRef(false);
 async function inventoryRead(){const r=await fetch('/api/oktell-projects/import?projectId='+projectId,{cache:'no-store'});const d=await r.json() as ImportInventory&{error?:string};if(!r.ok)throw Error(d.error);setInventory(d);}
 useEffect(()=>{let alive=true;fetch('/api/oktell-projects/import?projectId='+projectId,{cache:'no-store'}).then(async r=>{const d=await r.json() as ImportInventory&{error?:string};if(!r.ok)throw Error(d.error);if(alive)setInventory(d);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[projectId]);
 async function upload(selected:File,opts:ImportOptions,confirm=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   if(!/\.xlsx$/i.test(selected.name)||selected.size>5*1024*1024)throw Error('Выберите .xlsx до 5 МБ. Старый .xls сохраните в Excel как .xlsx.');
   const q=new URLSearchParams({projectId,filename:selected.name,action:confirm?'confirm':'preview'});
   for(const key of ['sheet','phone','name','city'] as const)if(opts[key]!==undefined&&(key!=='phone'||opts[key]))q.set(key,String(opts[key]));
   if(confirm&&preview)q.set('token',preview.token);
   const response=await fetch('/api/oktell-projects/import?'+q,{method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:selected});
   const data=await response.json() as ({applied:true;receipt:ImportReceipt}|{applied:false;preview:ImportPreview})&{error?:string};if(!response.ok)throw Error(data.error);
   if(data.applied){setReceipt(data.receipt);setPreview(null);setChecked(false);await inventoryRead();}
   else{setPreview(data.preview);setOptions(data.preview.options);setChecked(true);}
  }catch(e){setError((e as Error).message);if(!confirm)setChecked(false);}finally{setBusy(false);lock.current=false;}
 }
 function mapping(key:'phone'|'name'|'city',label:string){return <label className={styles.field}><span>{label}</span><select value={options[key]||0} onChange={e=>{setOptions({...options,[key]:Number(e.target.value)});setChecked(false);}}><option value={0}>{key==='phone'?'Выберите столбец':'Не загружать'}</option>{preview?.columns.map(c=><option key={c.id} value={c.id}>{c.id}. {c.name}</option>)}</select></label>;}
 return <div className={styles.importer}>
  <h3>Загрузить базу из Excel</h3>
  <p className={styles.help}>Контакты сохраняются только в этом проекте. Передача базы в Oktell ещё не подключена; загрузка не запускает обзвон.</p>
  <p><a href="/api/oktell-projects/import?template=1" download>Скачать шаблон Excel</a></p>
  <fieldset disabled={disabled||busy}>
   <label className={styles.field}><span>Файл с контактами</span><input type="file" accept=".xlsx" onChange={e=>{const next=e.target.files?.[0];setFile(next||null);setReceipt(null);setPreview(null);setChecked(false);setError('');if(next)void upload(next,{projectId,name:0,city:0});}}/><small>До 5 МБ и 50 000 строк на лист. Первая строка — названия столбцов. Телефон обязателен; имя и город — по желанию. Остальные столбцы не загружаются. Формулы замените значениями.</small></label>
   {preview&&<>
    <label className={styles.field}><span>Лист Excel</span><select value={options.sheet} onChange={e=>{if(file)void upload(file,{projectId,sheet:Number(e.target.value),name:0,city:0});}}>{preview.sheets.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className={styles.importColumns}>{mapping('phone','Телефон')}{mapping('name','Имя')}{mapping('city','Город')}</div>
    {!checked&&<button className={styles.secondary} disabled={!options.phone} onClick={()=>file&&void upload(file,options)}>Проверить выбранные столбцы</button>}
    {checked&&<>
     {!preview.options.phone?<p role="status">Столбец телефона не найден автоматически. Выберите его выше.</p>:<>
      <p role="status">Новых контактов: <strong>{preview.added}</strong>. Дублей: {preview.duplicates}. Ошибок: {preview.invalid}. Пустых строк: {preview.empty}.</p>
      <p className={styles.help}>Номера приводятся к формату 7XXXXXXXXXX. Дубли в файле и проекте пропускаются; существующие имя и город сохраняются.</p>
      {preview.sample.length>0&&<div className={styles.comparison}><table><caption>Первые {preview.sample.length} новых контактов</caption><thead><tr><th>Телефон</th><th>Имя</th><th>Город</th></tr></thead><tbody>{preview.sample.map(c=><tr key={c.phone}><td>{c.phone}</td><td>{c.name||'—'}</td><td>{c.city||'—'}</td></tr>)}</tbody></table></div>}
      {preview.errors.length>0&&<details><summary>Строки с ошибками: {preview.invalid}</summary><p>Показаны первые {preview.errors.length} ошибок. Эти строки не будут загружены.</p><ul>{preview.errors.map(e=><li key={e.row}>Строка {e.row}: {e.reason}</li>)}</ul></details>}
      <button className={styles.primary} disabled={!preview.added} onClick={()=>file&&void upload(file,options,true)}>Добавить контакты: {preview.added}</button>
     </>}
    </>}
   </>}
  </fieldset>
  {busy&&<p role="status">Обрабатываем Excel…</p>}
  {receipt&&<p className={styles.success} role="status">Файл «{receipt.filename}» обработан. Добавлено: {receipt.added}. Дублей: {receipt.duplicates}. Ошибок: {receipt.invalid}. В Oktell контакты не передавались.</p>}
  {error&&<p role="alert" className={styles.error}>{error} <button className={styles.secondary} disabled={busy||disabled} onClick={()=>file?void upload(file,options):void inventoryRead().catch(e=>setError(e.message))}>Повторить проверку</button></p>}
  <div className={styles.subsection}><h3>Контакты проекта{inventory?` · ${inventory.total}`:''}</h3>
   {!inventory?<p>Загружаем сведения о базе…</p>:!inventory.total?<p className={styles.help}>В проекте пока нет загруженных контактов.</p>:<details><summary>Посмотреть первые {inventory.contacts.length} контактов</summary><div className={styles.comparison}><table><thead><tr><th>Телефон</th><th>Имя</th><th>Город</th></tr></thead><tbody>{inventory.contacts.map(c=><tr key={c.phone}><td>{c.phone}</td><td>{c.name||'—'}</td><td>{c.city||'—'}</td></tr>)}</tbody></table></div></details>}
   {!!inventory?.imports.length&&<details><summary>История загрузок</summary><ul>{inventory.imports.map(i=><li key={i.id}>{new Date(i.at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК · {i.filename} · добавлено {i.added}, дублей {i.duplicates}, ошибок {i.invalid}</li>)}</ul></details>}
  </div>
 </div>;
}

'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,Check,ChevronRight,Copy,History,Plus,Save,Trash2} from 'lucide-react';
import {newProjectSettings,projectSettingsSchema,retryLabels,settingsChecklist,type ProjectSettings,type ProjectDraft,type ProjectHistory} from '@/lib/oktell-project-settings';
import styles from './oktell-projects.module.css';
import type {NativeProjectState} from '@/lib/oktell-settings-native';
import {nativeSettingsDiff,nativeFieldLabels,nativeFieldValue,nativeModeLabels} from '@/lib/oktell-settings-diff';

const sections=[['overview','Основное'],['operators','Операторы'],['source','База клиентов'],['dialing','Обзвон и повторы'],['schedule','Расписание'],['queue','Очередь'],['results','Сценарий и результаты'],['history','История изменений']] as const;
type Section=typeof sections[number][0];
type Operator={id:string;name:string;linked:boolean};
type State={projects:ProjectDraft[];operators:Operator[];native:{connected:boolean;canApply:boolean;message:string}};
type NativeStatus={state:NativeProjectState|null;pending:boolean;creating:boolean;appliedRevision?:number};
const days=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const modes=nativeModeLabels;
const sectionHelp:Partial<Record<Section,string>>={overview:'Название применяется к задаче Oktell. Описание сохраняется только в черновике.',operators:'Назначения и порядок передачи звонков пока сохраняются только в черновике.',dialing:'В Oktell применяются режим набора, время дозвона и предел линий. Попытки, повторы, порядок клиентов и номер звонящего пока остаются черновиком.',schedule:'Применяется расписание по Москве. Ограничение по местному времени клиента пока сохраняется только в черновике.',queue:'Настройки очереди пока сохраняются только в черновике.',results:'Текст, результаты и правила перезвона пока сохраняются только в черновике.'};
const date=(s:string)=>new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'});
function Field({label,hint,children}:{label:string;hint?:string;children:ReactNode}){return <label className={styles.field}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
function NumberField({label,hint,value,min=0,max=10080,onChange}:{label:string;hint?:string;value:number;min?:number;max?:number;onChange:(n:number)=>void}){return <Field label={label} hint={hint}><input type="number" min={min} max={max} step="1" value={Number.isNaN(value)?'':value} onChange={e=>onChange(e.target.value===''?NaN:Number(e.target.value))}/></Field>;}
async function request<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const d=await r.json() as T&{issues?:{message:string}[];error?:string};if(!r.ok)throw Error(d.issues?.map(i=>i.message).join('. ')||d.error||'Не удалось получить ответ');return d;
}
export default function OktellProjects(){
 const [data,setData]=useState<State|null>(null),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true);
 const [selected,setSelected]=useState<ProjectDraft|null>(null),[form,setForm]=useState<ProjectSettings|null>(null),[section,setSection]=useState<Section>('overview');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[history,setHistory]=useState<ProjectHistory[]>([]),[historyLoading,setHistoryLoading]=useState(false);
 const [native,setNative]=useState<NativeStatus|null>(null),[nativeLoading,setNativeLoading]=useState(false);
 const createId=useRef(''),saveLock=useRef(false),heading=useRef<HTMLHeadingElement>(null);
 const baseline=useRef('');
 const dirty=!!form&&JSON.stringify(form)!==baseline.current;
 const changes=form?nativeSettingsDiff(form,native?.state||null):[];
 const applyBlock=form?.mode==='preview'?'Для применения выберите прогрессивный или предиктивный режим.':form?.timezone!=='Europe/Moscow'?'Для применения выберите часовой пояс Москва.':!form?.schedule.length?'Для применения задайте расписание.':dirty?'Сначала сохраните черновик.':null;
 const load=async()=>{setLoading(true);setLoadError('');try{setData(await request<State>('/api/oktell-projects'));}catch(e){setLoadError((e as Error).message);}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 useEffect(()=>{
  setNative(null);if(!selected?.id||!data?.native.canApply)return;
  let alive=true;setNativeLoading(true);
  request<NativeStatus>('/api/oktell-projects/native?id='+selected.id).then(value=>{if(alive)setNative(value);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setNativeLoading(false);});
  return()=>{alive=false;};
 },[selected?.id,data?.native.canApply]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 useEffect(()=>{
  if(section!=='history'||!selected)return;
  let alive=true;setHistoryLoading(true);setHistory([]);
  request<{history:ProjectHistory[]}>('/api/oktell-projects?history='+encodeURIComponent(selected.id)).then(d=>{if(alive)setHistory(d.history);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setHistoryLoading(false);});
  return()=>{alive=false;};
 },[section,selected]);
 const leave=()=>!dirty||window.confirm('Есть несохранённые изменения. Перейти без сохранения?');
 function open(project:ProjectDraft|null,settings?:ProjectSettings){
  if(busy||!leave())return;
  const next=structuredClone(settings||project!.settings);baseline.current=project?JSON.stringify(next):'';
  createId.current=crypto.randomUUID();setSelected(project);setForm(next);setSection('overview');setError('');setNotice('');
 }
 function patch<K extends keyof ProjectSettings>(key:K,value:ProjectSettings[K]){setForm(s=>s?{...s,[key]:value}:s);setNotice('');setError('');}
 function jump(next:Section){setSection(next);setError('');requestAnimationFrame(()=>heading.current?.focus());}
 async function save(){
  if(!form||saveLock.current)return;
  const parsed=projectSettingsSchema.safeParse(form);
  if(!parsed.success){setError(parsed.error.issues.map(i=>i.message).join('. '));return;}
  saveLock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const {project}=await request<{project:ProjectDraft}>('/api/oktell-projects',{action:selected?'save':'create',id:selected?.id||createId.current,...(selected?{revision:selected.revision}:{}),settings:parsed.data});
   baseline.current=JSON.stringify(project.settings);setForm(project.settings);setSelected(project);
   setData(d=>d?{...d,projects:[project,...d.projects.filter(p=>p.id!==project.id)]}:d);
   setNotice('Черновик сохранён. Настройки в Oktell пока не применены.');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);saveLock.current=false;}
 }
 async function refreshNative(){
  if(!selected||busy)return;setNativeLoading(true);setError('');
  try{setNative(await request<NativeStatus>('/api/oktell-projects/native?id='+selected.id));}catch(e){setNative(null);setError((e as Error).message);}finally{setNativeLoading(false);}
 }
 async function applyNative(action:'apply'|'retry'){
  if(!selected||saveLock.current||!native)return;
  saveLock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await request<NativeStatus>('/api/oktell-projects/native',{action,id:selected.id,revision:selected.revision,expected:native.state?.snapshot||null});
   setNative(result);setNotice(`Основные параметры версии ${result.appliedRevision} сохранены в Oktell. Задача остановлена. Остальные разделы остаются черновиком.`);
  }catch(e){
   try{setNative(await request<NativeStatus>('/api/oktell-projects/native?id='+selected.id));}catch{setNative({...native,pending:true});}
   setError((e as Error).message);
  }finally{setBusy(false);saveLock.current=false;}
 }
 const number=(key:'ringSeconds'|'maxLines'|'maxAttempts',label:string,hint:string,min:number,max:number)=><NumberField label={label} hint={hint} min={min} max={max} value={form![key]} onChange={n=>patch(key,n)}/>;
 return <div className={styles.app}>
  <header className={styles.header}><a href="/oktell-projects" className={styles.brand} onClick={e=>{if(!leave())e.preventDefault();}}><span>см</span><b>Проекты Oktell</b></a><a href="/" onClick={e=>{if(!leave())e.preventDefault();}}><ArrowLeft size={16}/>В CRM</a></header>
  <div className={styles.layout}>
   <aside className={styles.projects} aria-label="Проекты"><div className={styles.listTitle}><h2>Проекты</h2><span>{data?.projects.length||0}</span></div>
    <button className={styles.create} disabled={busy||!data} onClick={()=>open(null,newProjectSettings())}><Plus size={17}/>Создать проект</button>
    <button className={styles.template} disabled={busy||!data} onClick={()=>open(null,newProjectSettings('t1'))}>Взять настройки Т1<ChevronRight size={15}/></button>
    <nav aria-label="Список проектов">{data?.projects.map(p=><button disabled={busy} key={p.id} aria-current={selected?.id===p.id?'page':undefined} className={styles.project} onClick={()=>open(p)}><strong>{p.settings.name}</strong><span>Черновик · {date(p.updatedAt)}</span></button>)}</nav>
    {data&&!data.projects.length&&<p className={styles.listEmpty}>Создайте пустой проект или начните с настроек Т1.</p>}
    <p className={styles.sidebarNote}>Сохранение настроек не запускает обзвон.</p>
   </aside>
   <main className={styles.main}>
    {loading?<div className={styles.empty} role="status">Загружаем проекты…</div>:loadError?<div className={styles.empty}><h1>Не удалось загрузить проекты</h1><p role="alert">{loadError}</p><button className={styles.primary} onClick={()=>void load()}>Повторить загрузку</button></div>:!form?<div className={styles.empty}><h1>Настройте свой проект</h1><p>Кто звонит, кому, когда и что делать после разговора — всё в одном месте.</p><div className={styles.emptyActions}><button className={styles.primary} onClick={()=>open(null,newProjectSettings())}><Plus size={18}/>С нуля</button><button className={styles.secondary} onClick={()=>open(null,newProjectSettings('t1'))}>По образцу Т1</button></div><p className={styles.templateNote}>Образец Т1 — сохранённые правила на 28 октября 2026 года. База клиентов, операторы и линии не копируются.</p></div>:<>
     <div className={styles.heading}><div><div className={styles.titleLine}><h1>{form.name||'Новый проект'}</h1><span className={styles.badge}>Черновик</span></div><p>{selected?`Сохранён ${date(selected.updatedAt)} МСК · версия ${selected.revision}`:'Новый проект ещё не сохранён'}</p></div><button className={styles.secondary} disabled={busy} onClick={()=>open(null,{...structuredClone(form),name:(form.name+' · копия').slice(0,100)})}><Copy size={16}/>Копировать</button></div>
     <div className={styles.connection}><strong>{data?.native.canApply?'Настройки в Oktell':'Настройки ещё не связаны с Oktell'}</strong>{!data?.native.canApply&&<p>{data?.native.message}</p>}
      {data?.native.canApply&&<>
       <p>Можно применить пять основных параметров. Остальные настройки пока сохраняются в черновике. Применение не запускает звонки.</p>
       {!selected?<p>Сохраните черновик, чтобы создать проект и остановленную задачу в Oktell.</p>:<>
        {nativeLoading?<p role="status">Проверяем состояние Oktell…</p>:native?.state?<p><strong>{native.state.active===0&&native.state.runtimeActivity==='0'?'Задача остановлена':'Состояние требует проверки'}</strong> · {native.state.ringSeconds} сек. дозвона · предел {native.state.maxLines} линий · {native.state.schedule.length} интервалов. Применена версия {native.appliedRevision??'—'}.<br/>Задача Oktell: <code>{native.state.taskId}</code></p>:native&&!native.pending?<p>Настройки ещё не применены в Oktell.</p>:null}
        {native?.pending&&<p>Предыдущая операция не подтверждена. Проверка использует тот же запрос и защищает от повторного создания задачи.</p>}
        {!nativeLoading&&native&&!native.pending&&<>{changes.length?<div className={styles.comparison}><table><caption>{native.state?'Изменения перед применением':'Параметры новой остановленной задачи'}</caption><thead><tr><th scope="col">Параметр</th><th scope="col">В Oktell</th><th scope="col">Будет</th></tr></thead><tbody>{changes.map(key=><tr key={key}><th scope="row">{nativeFieldLabels[key]}</th><td>{native.state?nativeFieldValue(native.state,key):'Не создано'}</td><td>{nativeFieldValue(form,key)}</td></tr>)}</tbody></table></div>:<p role="status">Основные параметры совпадают с Oktell.</p>}{applyBlock&&<p>{applyBlock}</p>}</>}
        <div className={styles.nativeActions}>
         <button className={styles.secondary} disabled={busy||nativeLoading} onClick={()=>void refreshNative()}>Сверить с Oktell</button>
         {native?.pending?<button className={styles.primary} disabled={busy||nativeLoading} onClick={()=>void applyNative('retry')}>Проверить предыдущую операцию</button>:<button className={styles.primary} disabled={busy||!!applyBlock||nativeLoading||!native||changes.length===0} onClick={()=>void applyNative('apply')}>{native?.state?'Применить изменения':'Создать в Oktell'}</button>}
        </div>
       </>}
      </>}
     </div>
     <nav className={styles.sections} aria-label="Настройки проекта">{sections.map(([key,label])=><button key={key} aria-current={section===key?'page':undefined} onClick={()=>jump(key)}>{label}</button>)}</nav>
     <div className={styles.editor}>
      <div className={styles.form} aria-busy={busy}><h2 ref={heading} tabIndex={-1}>{sections.find(([key])=>key===section)?.[1]}</h2>
       <fieldset disabled={busy}>
       {sectionHelp[section]&&<p className={styles.help}>{sectionHelp[section]}</p>}
       {section==='overview'&&<>
        <Field label="Название проекта"><input value={form.name} maxLength={100} onChange={e=>patch('name',e.target.value)}/></Field>
        <Field label="Описание" hint="Для какой задачи создан проект и что важно знать руководителю."><textarea rows={3} maxLength={1000} value={form.description} onChange={e=>patch('description',e.target.value)}/></Field>
        <div className={styles.subsection}><h3>План проекта</h3><dl className={styles.summary}><div><dt>Режим</dt><dd>{modes[form.mode]}</dd></div><div><dt>Операторы</dt><dd>{form.operatorIds.length?`Выбрано: ${form.operatorIds.length}`:'Пока не выбраны'}</dd></div><div><dt>Попытки</dt><dd>Не более {form.maxAttempts} на клиента</dd></div><div><dt>Время клиента</dt><dd>{form.clientWindow.from}–{form.clientWindow.to}</dd></div></dl></div>
        <p className={styles.help}>Каждый проект сохраняется отдельно. Изменение образца Т1 не меняет существующие проекты и настройки Скорозвона.</p>
       </>}
       {section==='operators'&&<>
        <p className={styles.help}>Выберите сотрудников для проекта. Эти назначения ещё не передаются в Oktell.</p>
        {!data?.operators.length?<p className={styles.inlineEmpty}>В этой среде пока нет операторов. Добавьте сотрудников в CRM, затем обновите страницу.</p>:<div className={styles.choices}>{data.operators.map(o=><label key={o.id}><input type="checkbox" checked={form.operatorIds.includes(o.id)} onChange={e=>patch('operatorIds',e.target.checked?[...form.operatorIds,o.id]:form.operatorIds.filter(id=>id!==o.id))}/><span>{o.name}<small>{o.linked?'Есть привязка к Oktell':'Привязка к Oktell ещё не подтверждена'}</small></span></label>)}</div>}
        {form.operatorIds.filter(id=>!data?.operators.some(o=>o.id===id)).length>0&&<div className={styles.inlineEmpty}><p>Часть выбранных сотрудников больше недоступна. Перед применением их нужно заменить.</p><button className={styles.secondary} onClick={()=>patch('operatorIds',form.operatorIds.filter(id=>data?.operators.some(o=>o.id===id)))}>Убрать недоступных</button></div>}
        <Field label="Кому передавать следующий звонок"><select value={form.distribution} onChange={e=>patch('distribution',e.target.value as ProjectSettings['distribution'])}><option value="longest_idle">Кто дольше свободен</option><option value="round_robin">По очереди</option></select></Field>
       </>}
       {section==='source'&&<><h3>Источник клиентов</h3><p className={styles.help}>Существующая тестовая база находится в Oktell. Для выбора списка редактор должен получить его из АТС.</p><div className={styles.inlineEmpty}><strong>{form.source.kind==='none'?'База пока не подключена':form.source.label}</strong><p>Списки Oktell недоступны до настройки подключения. Сохранение черновика не загружает, не удаляет и не перемещает клиентов.</p></div><Field label="Порядок обработки"><select value={form.order} onChange={e=>patch('order',e.target.value as ProjectSettings['order'])}><option value="least_attempts">Сначала клиенты с меньшим числом попыток</option><option value="oldest_first">В порядке добавления в базу</option></select></Field><p className={styles.help}>Повторы и перезвоны учитываются отдельно. Исключение дублей и запретов будет проверяться при подключении базы.</p></>}
       {section==='dialing'&&<>
        <Field label="Режим обзвона"><select value={form.mode} onChange={e=>patch('mode',e.target.value as ProjectSettings['mode'])}>{Object.entries(modes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
        {form.mode==='predictive'&&<p className={styles.help}>Oktell заранее набирает номера с учётом ожидаемой доступности операторов. Лимит линий ограничивает одновременные вызовы.</p>}
        <div className={styles.twoColumns}>{number('maxLines','Одновременно занятых линий','Включая вызовы, на которые клиент ещё не ответил.',1,100)}{number('ringSeconds','Ждать ответа, секунд','После этого ожидание ответа завершается.',10,180)}{number('maxAttempts','Общий предел попыток на клиента','Ограничивает все повторы вместе, даже если ниже указано больше.',1,30)}</div>
        <div className={styles.subsection}><h3>Когда пробовать снова</h3><p className={styles.help}>0 повторов означает: не повторять после этого исхода. Общий предел попыток всегда важнее отдельного правила.</p><div className={styles.retryTable}>{form.retries.map((r,i)=><div key={r.outcome}><strong>{retryLabels[r.outcome]}</strong><NumberField label="Пауза, минут" min={1} value={r.minutes} onChange={minutes=>patch('retries',form.retries.map((v,j)=>j===i?{...v,minutes}:v))}/><NumberField label="Повторов, не более" max={30} value={r.attempts} onChange={attempts=>patch('retries',form.retries.map((v,j)=>j===i?{...v,attempts}:v))}/></div>)}</div><p className={styles.help}>Правило «Автоответчик» сработает только при подтверждённом распознавании. Само это поле не включает распознавание.</p></div>
        <Field label="Номер, который увидит клиент" hint="Только номер, разрешённый вашим провайдером. Линия и право предъявления проверяются отдельно."><input inputMode="tel" value={form.callerId} maxLength={20} placeholder="Не выбран" onChange={e=>patch('callerId',e.target.value)}/></Field>
       </>}
       {section==='schedule'&&<>
        <Field label="Часовой пояс расписания"><select value={form.timezone} onChange={e=>patch('timezone',e.target.value as ProjectSettings['timezone'])}>{Object.entries({'Europe/Moscow':'Москва · UTC+3','Europe/Kaliningrad':'Калининград · UTC+2','Europe/Samara':'Самара · UTC+4','Asia/Yekaterinburg':'Екатеринбург · UTC+5','Asia/Omsk':'Омск · UTC+6','Asia/Novosibirsk':'Новосибирск · UTC+7','Asia/Krasnoyarsk':'Красноярск · UTC+7','Asia/Irkutsk':'Иркутск · UTC+8','Asia/Yakutsk':'Якутск · UTC+9','Asia/Vladivostok':'Владивосток · UTC+10','Asia/Magadan':'Магадан · UTC+11','Asia/Kamchatka':'Камчатка · UTC+12'}).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
        <div className={styles.periods}>{form.schedule.map((p,i)=><div key={i}><Field label="День"><select value={p.day} onChange={e=>patch('schedule',form.schedule.map((v,j)=>i===j?{...v,day:Number(e.target.value)}:v))}>{days.map((day,n)=><option key={day} value={n+1}>{day}</option>)}</select></Field><Field label="С"><input type="time" value={p.from} onChange={e=>patch('schedule',form.schedule.map((v,j)=>i===j?{...v,from:e.target.value}:v))}/></Field><Field label="До"><input type="time" value={p.to} onChange={e=>patch('schedule',form.schedule.map((v,j)=>i===j?{...v,to:e.target.value}:v))}/></Field><button className={styles.iconButton} aria-label={`Удалить интервал: ${days[p.day-1]}, ${p.from}–${p.to}`} onClick={()=>patch('schedule',form.schedule.filter((_,j)=>j!==i))}><Trash2 size={17}/></button></div>)}</div>
        <button className={styles.secondary} disabled={form.schedule.length>=28} onClick={()=>patch('schedule',[...form.schedule,{day:1,from:'09:00',to:'18:00'}])}><Plus size={16}/>Добавить интервал</button><p className={styles.help}>Можно задать несколько интервалов в день. Ночное окно разделите на два дня. Пустое расписание означает, что проект пока не готов к запуску.</p>
        <div className={styles.subsection}><h3>Допустимое время у клиента</h3><p className={styles.help}>Планируемое правило: учитывать расписание проекта и местное время клиента. Проверка местного времени ещё не подключена.</p><div className={styles.twoColumns}><Field label="Не раньше"><input type="time" value={form.clientWindow.from} onChange={e=>patch('clientWindow',{...form.clientWindow,from:e.target.value})}/></Field><Field label="Не позже"><input type="time" value={form.clientWindow.to} onChange={e=>patch('clientWindow',{...form.clientWindow,to:e.target.value})}/></Field></div><Field label="Если часовой пояс клиента неизвестен"><select value={form.clientWindow.unknownTimezone} onChange={e=>patch('clientWindow',{...form.clientWindow,unknownTimezone:e.target.value as 'exclude'|'project_timezone'})}><option value="exclude">Не включать в обзвон</option><option value="project_timezone">Использовать часовой пояс проекта</option></select></Field></div>
       </>}
       {section==='queue'&&<><label className={styles.check}><input type="checkbox" checked={form.queue.enabled} onChange={e=>patch('queue',{...form.queue,enabled:e.target.checked})}/><span>Клиент может ждать свободного оператора</span></label><p className={styles.help}>Если очередь выключена, проект не должен рассчитывать на ожидание ответившего клиента.</p>{form.queue.enabled&&<div className={styles.twoColumns}><NumberField label="Клиентов в очереди, не более" value={form.queue.maxClients} min={1} max={100} onChange={maxClients=>patch('queue',{...form.queue,maxClients})}/><NumberField label="Ожидание, секунд" value={form.queue.maxWaitSeconds} min={5} max={600} onChange={maxWaitSeconds=>patch('queue',{...form.queue,maxWaitSeconds})}/></div>}<p className={styles.help}>Музыка ожидания и поведение при переполнении требуют выбора существующего сценария Oktell. Они ещё не подключены к редактору.</p></>}
       {section==='results'&&<>
        <Field label="Текст для оператора" hint="Подсказка разговора. Это текст сценария, не настройка голосового меню IVR."><textarea rows={8} maxLength={12000} value={form.script} placeholder="Приветствие, вопросы, что предложить клиенту…" onChange={e=>patch('script',e.target.value)}/></Field>
        <div className={styles.subsection}><h3>Результаты разговора</h3><p className={styles.help}>Для каждого результата укажите, что должно произойти с клиентом.</p>{form.results.length===0&&<p className={styles.inlineEmpty}>Добавьте результаты, которые оператор выбирает после разговора.</p>}
        <div className={styles.results}>{form.results.map((r,i)=><div key={r.id}><Field label="Название результата"><input value={r.name} maxLength={100} onChange={e=>patch('results',form.results.map((v,j)=>i===j?{...v,name:e.target.value}:v))}/></Field><Field label="Действие"><select value={r.action} onChange={e=>patch('results',form.results.map((v,j)=>i===j?{...v,action:e.target.value as typeof r.action,success:e.target.value==='finish'?v.success:false}:v))}><option value="finish">Завершить обработку</option><option value="callback">Назначить перезвон</option><option value="retry">Вернуть на повтор</option><option value="exclude">Исключить из обзвона</option></select></Field><label className={styles.check}><input type="checkbox" checked={r.success} disabled={r.action!=='finish'} onChange={e=>patch('results',form.results.map((v,j)=>i===j?{...v,success:e.target.checked}:v))}/>Успех</label><button className={styles.iconButton} aria-label={`Удалить результат ${r.name||i+1}`} onClick={()=>patch('results',form.results.filter((_,j)=>j!==i))}><Trash2 size={17}/></button></div>)}</div>
        <button className={styles.secondary} disabled={form.results.length>=40} onClick={()=>patch('results',[...form.results,{id:crypto.randomUUID(),name:'',action:'finish',success:false}])}><Plus size={16}/>Добавить результат</button></div>
        <div className={styles.subsection}><h3>Назначенный перезвон</h3><label className={styles.check}><input type="checkbox" checked={form.callback.sameOperator} onChange={e=>patch('callback',{...form.callback,sameOperator:e.target.checked})}/>Сначала предложить прежнему оператору</label>{form.callback.sameOperator&&<NumberField label="Передать другому через, минут" hint="Если прежний оператор недоступен. 0 — передать сразу." value={form.callback.fallbackMinutes} max={1440} onChange={fallbackMinutes=>patch('callback',{...form.callback,fallbackMinutes})}/>}</div>
       </>}
       {section==='history'&&<>{!selected?<p className={styles.inlineEmpty}>История появится после первого сохранения.</p>:historyLoading?<p role="status">Загружаем историю…</p>:<div className={styles.history}>{history.map(h=><div key={h.revision}><History size={17}/><div><strong>Версия {h.revision} · {h.settings.name}</strong><p>{date(h.at)} МСК</p></div><button className={styles.secondary} onClick={()=>{if(!leave())return;setForm(structuredClone(h.settings));setSection('overview');setNotice(`Загружена версия ${h.revision}. Чтобы восстановить её, сохраните черновик.`);}}>Взять эту версию</button></div>)}</div>}</>}
       </fieldset>
      </div>
      <aside className={styles.checklist} aria-label="Подготовка проекта"><h3>До первого запуска</h3>{settingsChecklist(form).map(item=><button key={item.key} onClick={()=>jump(item.key==='native'?'overview':item.key as Section)}><span className={item.complete?styles.complete:styles.pending}>{item.complete?<Check size={13}/>:null}</span>{item.label}</button>)}<p>Черновик сохраняет ваш план. Готовность АТС, линий и операторов проверяется отдельно.</p></aside>
     </div>
     <div className={styles.feedback} aria-live="polite">{notice&&<p className={styles.success}>{notice}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}</div>
     <footer className={styles.footer}><span>{dirty?'Есть несохранённые изменения':'Все изменения черновика сохранены'}</span><button className={styles.primary} disabled={busy||!dirty} onClick={()=>void save()}><Save size={17}/>{busy?'Сохраняем…':'Сохранить черновик'}</button></footer>
    </>}
   </main>
  </div>
 </div>;
}

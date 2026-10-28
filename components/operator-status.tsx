'use client';
import {useEffect,useState,useRef} from 'react';
import {Check,Pause,LogOut,ChevronDown,Headphones,Coffee,Utensils} from 'lucide-react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {OktellPhonePanel,useOktellPhone} from './oktell-phone';
import {toast} from 'sonner';
type Status={state:'ready'|'break'|'finished'|'busy'|'offline'|'unavailable';checkedAt:string;hasLine:boolean|null;busy:boolean;login:string};
const labels={offline:'Работа не начата',unavailable:'Телефон Oktell не подключён',ready:'Готов',break:'Перерыв',finished:'Работа завершена',busy:'Занят · разговор или обработка'};
export default function OperatorStatus({actorId}:{actorId:string}){
 const native=useOktellPhone();
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const seq=useRef(0),sending=useRef(false);
 async function refresh(){if(sending.current)return;const n=++seq.current;try{const r=await fetch('/api/operator-state',{cache:'no-store'}),data=await r.json() as Status & {error?:string};if(seq.current!==n)return;if(!r.ok)throw Error(data.error||"Oktell не подтвердил команду");setStatus(data);setError('');}catch(e){if(seq.current===n){setStatus(null);setError(e instanceof Error?e.message:'Нет соединения с Oktell');}}}
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),10000);return()=>{clearInterval(timer);seq.current++;};},[actorId]);
 async function command(action:'ready'|'break'|'finish',reason?:string){
  if(sending.current)return;sending.current=true;seq.current++;setWorking(true);setError('');
  try{if(action==='finish'&&native){await native.disconnect();setStatus(null);return;}const r=await fetch('/api/operator-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(action==='break'?{reason}:{})})}),data=await r.json() as Status & {error?:string};if(!r.ok)throw Error(data.error||"Oktell не подтвердил команду");setStatus(data);toast.success('Статус подтверждён Oktell');}
  catch(e){setStatus(null);setError(e instanceof Error?e.message:'Команда не подтверждена');}
  finally{sending.current=false;setWorking(false);}
 }
 const connectedEmployee=!!native;
 const disabled=!connectedEmployee||working||status?.busy||native?.busy;
 return <section className="operator-workspace" aria-labelledby="operator-status-title">
  <div className="operator-workspace-top">
   <div className="operator-workspace-heading"><span className="operator-workspace-icon"><Headphones size={24}/></span><div><h2 id="operator-status-title">Управление звонками</h2><p>Выберите свой рабочий статус</p></div></div>
  </div>
  <OktellPhonePanel/>
  <div className="operator-presence" data-state={status?.state||'unknown'} aria-live="polite"><span className="operator-presence-dot"/><strong>{working?'Обновляем статус…':status?labels[status.state]:connectedEmployee?'Проверяем подключение':'Подключение настраивается'}</strong></div>
  <div className="operator-controls" aria-label="Рабочий статус">
   <button className="secondary operator-control operator-ready" aria-pressed={status?.state==='ready'} disabled={disabled} onClick={()=>command('ready')}><Check size={19}/><span>Готов</span></button>
   <DropdownMenu><DropdownMenuTrigger asChild><button className="secondary operator-control" aria-pressed={status?.state==='break'} disabled={disabled}><Pause size={19}/><span>Перерыв</span><ChevronDown size={15}/></button></DropdownMenuTrigger><DropdownMenuContent align="start" className="operator-break-menu"><DropdownMenuItem onSelect={()=>void command('break','Короткий перерыв')}><Coffee size={17}/>Короткий перерыв</DropdownMenuItem><DropdownMenuItem onSelect={()=>void command('break','Обед')}><Utensils size={17}/>Обед</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
   <button className="secondary operator-control operator-finish" disabled={disabled} onClick={()=>command('finish')}><LogOut size={19}/><span>Завершить работу</span></button>
  </div>
  {error&&connectedEmployee&&<p className="operator-connection-message" role="alert">{error}</p>}
  <div className="operator-workspace-foot"><p>{status?.hasLine===true?'На перерыве новые звонки не поступают. После работы завершите сеанс.':connectedEmployee?'Для теста подключите гарнитуру и откройте тестовую карточку в клиентах. Готовность к автоматическому обзвону настраивается отдельно.':'Учётная запись Oktell для вас пока не подключена.'}</p>{status&&<span>Обновлено в {new Date(status.checkedAt).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})} МСК</span>}</div>
 </section>;
}

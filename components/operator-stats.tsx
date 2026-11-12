"use client";
import {useEffect,useState} from 'react';
import {Tabs,TabsList,TabsTrigger} from './ui/tabs';
import {Switch} from './ui/switch';
import {BarChart3} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {operatorStats,sortOperatorStats,type StatsSortKey, type operatorStatsSummary} from '../lib/operator-stats';
import {money,statuses,departments,type Order,type State,type Employee} from '../lib/crm';
export function OperatorStats({state,actor,onOpenOrder,detailOpen}:{state:State;actor:Employee;onOpenOrder:(id:string)=>void;detailOpen:boolean}){
 const [section,setSection]=useState('created');
 const [department,setDepartment]=useState(''),[showAll,setShowAll]=useState(false);
 const [summary,setSummary]=useState<ReturnType<typeof operatorStatsSummary>>([]),[summaryError,setSummaryError]=useState(''),[summaryLoading,setSummaryLoading]=useState(false);
 const [sort,setSort]=useState<{key:StatsSortKey;ascending:boolean}>({key:'created',ascending:false});
 const [open,setOpen]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const visible=open&&!detailOpen;
 const summaryMode=actor.role==='department_head'&&showAll;
 useEffect(()=>{
  if(!visible||!summaryMode)return;
  const controller=new AbortController();setSummaryLoading(true);setSummaryError('');setSummary([]);
  fetch(`/api/operator-statistics?actorId=${encodeURIComponent(actor.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,{signal:controller.signal}).then(async response=>{const data=await response.json() as {rows:ReturnType<typeof operatorStatsSummary>;error?:string};if(!response.ok)throw Error(data.error||'Не удалось загрузить статистику');return data.rows;}).then(rows=>{if(!controller.signal.aborted)setSummary(rows);}).catch(error=>{if(!controller.signal.aborted)setSummaryError(error.message);}).finally(()=>{if(!controller.signal.aborted)setSummaryLoading(false);});
  return ()=>controller.abort();
 },[visible,summaryMode,from,to,actor.id]);
 if(!['admin','department_head','operator'].includes(actor.role))return null;
 const sourceRows=!visible?[]:summaryMode?summary.map(row=>({...row,orderLists:{redeemed:[],created:[],inWork:[],cancelled:[],confirmed:[],awaitingShipment:[],sent:[]}})):operatorStats(state,actor,from,to);
 const invalid=!!from&&!!to&&from>to,rows=invalid||!visible?[]:sortOperatorStats(sourceRows.filter(r=>(section==='buyouts'?r.buyoutCount>0:r.created>0)&&(!department||r.department===department)),sort.key,sort.ascending);
 const columns: [StatsSortKey,string][]=section==='buyouts'?[["login","Оператор"],["buyoutCdek","СДЭК"],["buyoutPost","Почта России"],["buyoutMoscow","Курьер Москва"],["buyoutCount","Всего выкуплено"],["buyoutAmount","Сумма выкупов"]]:[["login","Оператор"],["created","Создано"],["inWork","В работе"],["average","Средний чек"],["amount","Сумма"],["cancelled","Отменено"],["confirmed","Подтверждено"],["awaitingShipment","Ожидают отправки"],["sent","Отправлено"]];
 const colgroup=<colgroup><col style={{width:"28%"}}/>{Array.from({length:columns.length-1},(_,i)=><col key={i}/>)}</colgroup>;
 const headers=<thead><tr>{columns.map(([key,label])=><th key={key} aria-sort={sort.key===key?(sort.ascending?"ascending":"descending"):"none"}><button className="stats-sort" onClick={()=>setSort({key,ascending:sort.key===key?!sort.ascending:key==="login"})}>{label} <span aria-hidden="true">{sort.key===key?(sort.ascending?"↑":"↓"):"↕"}</span></button></th>)}</tr></thead>;
 function openOrder(id:string){onOpenOrder(id);}
 function metric(value:string|number,orders:Order[],label:string){
  if(summaryMode)return <span className="stats-value">{value}</span>;
  if(!orders.length)return <span className="stats-zero">{value}</span>;
  if(orders.length===1)return <button className="stats-metric" aria-label={`${label}: открыть заказ ${orders[0].id}`} onClick={()=>openOrder(orders[0].id)}>{value}</button>;
  return <select className="stats-metric stats-order-select" aria-label={`${label}: выбрать заказ`} value="" onChange={e=>{if(e.target.value)openOrder(e.target.value);}}><option value="" disabled>{value}</option>{orders.map(o=><option key={o.id} value={o.id}>{o.id} · {state.clients.find(c=>c.id===o.clientId)?.name||'Клиент'} · {statuses[o.status]} · {money(o.items.reduce((n,i)=>n+i.price*i.quantity,0))}</option>)}</select>;
 }
 const buyoutCells: [ 'buyoutCdek'|'buyoutPost'|'buyoutMoscow'|'buyoutCount'|'buyoutAmount',string,string[]?][]=[['buyoutCdek','СДЭК',['cdek_pickup','cdek_courier']],['buyoutPost','Почта России',['russian_post']],['buyoutMoscow','Курьер Москва',['moscow_courier']],['buyoutCount','Всего выкуплено'],['buyoutAmount','Сумма выкупов']];
 const allOrders=(key:'created'|'inWork'|'cancelled'|'confirmed'|'awaitingShipment'|'sent')=>rows.flatMap(r=>r.orderLists[key]);
 const count=rows.reduce((n,r)=>n+r.created,0),amount=rows.reduce((n,r)=>n+Math.round(r.amount*100),0)/100;
 return <>
  <button className="secondary" onClick={()=>{const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Moscow"});setFrom(today);setTo(today);setOpen(true);}} title="Статистика операторов"><BarChart3 size={18}/>Статистика</button>
  <Dialog open={visible} onOpenChange={setOpen}>{visible&&<DialogContent className="form-dialog operator-stats-dialog">
   <DialogHeader><DialogTitle>Статистика операторов</DialogTitle><DialogDescription>{section==='buyouts'?'По дате выкупа, включая перенесённые заказы ЛВ. Даты — по Москве.':'Заказы из Скорозвона и CRM, созданные за выбранный период. Даты — по Москве.'}</DialogDescription></DialogHeader>
   <div className="stack">
    <Tabs value={section} onValueChange={value=>{setSection(value);setSort({key:value==='buyouts'?'buyoutCount':'created',ascending:false});}}><TabsList aria-label="Вид статистики"><TabsTrigger value="created">Созданные заказы</TabsTrigger><TabsTrigger value="buyouts">Выкупы</TabsTrigger></TabsList></Tabs>
    <div className="stats-period">
     <label>С даты<input aria-label="Начало периода" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
     <label>По дату<input aria-label="Конец периода" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
     <button className="secondary" onClick={()=>{const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Moscow"});setFrom(today.slice(0,7)+"-01");setTo(today);}}>За месяц</button>
     {(actor.role==='admin'||summaryMode)&&<div className="stats-departments" role="group" aria-label="Отделы"><button className="secondary" aria-pressed={!department} onClick={()=>setDepartment('')}>Все отделы</button>{Object.entries(departments).map(([id,name])=><button className="secondary" key={id} aria-pressed={department===id} onClick={()=>setDepartment(id)}>{name}</button>)}</div>}
     {actor.role==='department_head'&&<label className="stats-all-switch"><Switch aria-label="Показать все отделы" checked={showAll} onCheckedChange={checked=>{setShowAll(checked);setDepartment('');}}/>Показать все отделы</label>}
    </div>
    {summaryMode&&<p className="muted">Общая сводка: только показатели, без доступа к заказам.</p>}
    {summaryMode&&summaryLoading?<p role="status">Загрузка статистики отделов…</p>:summaryMode&&summaryError?<p role="alert">{summaryError}</p>:invalid?<p role="alert">Начало периода не может быть позже конца.</p>:<div className="stats-results"><div className="stats-table-wrap"><table className="stats-table">{colgroup}{headers}
     {section==='buyouts'?<><tbody>{rows.map(r=><tr key={r.id}><td>{r.login}</td>{buyoutCells.map(([key,label,deliveries])=><td key={key}>{metric(key==='buyoutAmount'?money(r[key]):r[key],r.orderLists.redeemed.filter(o=>!deliveries||deliveries.includes(o.delivery||'')),label)}</td>)}</tr>)}</tbody><tfoot><tr><th>Итого</th>{buyoutCells.map(([key,label,deliveries])=><td key={key}>{metric(key==='buyoutAmount'?money(rows.reduce((n,r)=>n+Math.round(r[key]*100),0)/100):rows.reduce((n,r)=>n+r[key],0),rows.flatMap(r=>r.orderLists.redeemed).filter(o=>!deliveries||deliveries.includes(o.delivery||'')),label+' — итого')}</td>)}</tr></tfoot></>:<><tbody>{rows.map(r=><tr key={r.id}>
      <td title={r.login}>{r.login}</td><td>{metric(r.created,r.orderLists.created,"Создано заказов")}</td>
      <td>{metric(r.inWork,r.orderLists.inWork,"В работе")}</td>
      <td>{metric(money(r.average),r.orderLists.created,"Средний чек")}</td><td>{metric(money(r.amount),r.orderLists.created,"Сумма заказов")}</td>
      <td>{metric(r.cancelled,r.orderLists.cancelled,"Отменено")}</td><td>{metric(r.confirmed,r.orderLists.confirmed,"Подтверждено логистом")}</td><td>{metric(r.awaitingShipment,r.orderLists.awaitingShipment,"Ожидают отправки")}</td><td>{metric(r.sent,r.orderLists.sent,"Отправлено")}</td>
     </tr>)}</tbody>
     <tfoot><tr><th>Итого</th><td>{metric(count,allOrders("created"),"Создано — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.inWork,0),allOrders("inWork"),"В работе — итого")}</td>
      <td>{metric(money(count?amount/count:0),allOrders("created"),"Средний чек — итого")}</td><td>{metric(money(amount),allOrders("created"),"Сумма — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.cancelled,0),allOrders("cancelled"),"Отменено — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.confirmed,0),allOrders("confirmed"),"Подтверждено — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.awaitingShipment,0),allOrders("awaitingShipment"),"Ожидают отправки — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.sent,0),allOrders("sent"),"Отправлено — итого")}</td>
     </tr></tfoot></>}
    </table></div>{!rows.length&&<p>{section==='buyouts'?'За выбранный период нет выкупленных заказов.':'За выбранный период нет созданных заказов.'}</p>}</div>}
    {section==='buyouts'?<p className="muted">Учитываются выкупы за выбранные даты независимо от даты создания заказа. Без известной даты выкупа заказ в статистику не входит. Нажмите на показатель, чтобы посмотреть доступные вам заказы.</p>:<p className="muted">В работе — ещё не подтверждены и не отменены. Сортировка — нажатием на заголовок. Подтверждено — логистом. Ожидают отправки — подтверждены, ещё не отправлены и не отменены. Средний чек и сумма включают все созданные заказы, в том числе отменённые. Подтверждение и отправка учитываются независимо: отправленный заказ остаётся в подтверждённых. Доставка — СДЭК, Почта России и курьер. {!summaryMode&&'Нажмите на показатель, чтобы открыть входящие в него заказы.'}</p>}
   </div>
  </DialogContent>}</Dialog>
 </>;
}

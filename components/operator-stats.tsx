"use client";
import {useState} from 'react';
import {BarChart3} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {operatorStats,sortOperatorStats,type StatsSortKey} from '../lib/operator-stats';
import {money,statuses,type Order,type State,type Employee} from '../lib/crm';
export function OperatorStats({state,actor,onOpenOrder,detailOpen}:{state:State;actor:Employee;onOpenOrder:(id:string)=>void;detailOpen:boolean}){
 const [sort,setSort]=useState<{key:StatsSortKey;ascending:boolean}>({key:'created',ascending:false});
 const [open,setOpen]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState('');
 if(!['admin','department_head','operator'].includes(actor.role))return null;
 const visible=open&&!detailOpen;
 const invalid=!!from&&!!to&&from>to,rows=invalid||!visible?[]:sortOperatorStats(operatorStats(state,actor,from,to),sort.key,sort.ascending);
 const columns: [StatsSortKey,string][]=[["login","Оператор"],["created","Создано"],["average","Средний чек"],["amount","Сумма"],["cancelled","Отменено"],["confirmed","Подтверждено"],["sent","Отправлено"]];
 const groups=rows.length>24?[rows.slice(0,Math.ceil(rows.length/2)),rows.slice(Math.ceil(rows.length/2))]:[rows];
 const colgroup=<colgroup><col style={{width:"34%"}}/>{Array.from({length:6},(_,i)=><col key={i}/>)}</colgroup>;
 const headers=<thead><tr>{columns.map(([key,label])=><th key={key} aria-sort={sort.key===key?(sort.ascending?"ascending":"descending"):"none"}><button className="stats-sort" onClick={()=>setSort({key,ascending:sort.key===key?!sort.ascending:key==="login"})}>{label} <span aria-hidden="true">{sort.key===key?(sort.ascending?"↑":"↓"):"↕"}</span></button></th>)}</tr></thead>;
 function openOrder(id:string){onOpenOrder(id);}
 function metric(value:string|number,orders:Order[],label:string){
  if(!orders.length)return <span className="stats-zero">{value}</span>;
  if(orders.length===1)return <button className="stats-metric" aria-label={`${label}: открыть заказ ${orders[0].id}`} onClick={()=>openOrder(orders[0].id)}>{value}</button>;
  return <select className="stats-metric stats-order-select" aria-label={`${label}: выбрать заказ`} value="" onChange={e=>{if(e.target.value)openOrder(e.target.value);}}><option value="" disabled>{value} ▾</option>{orders.map(o=><option key={o.id} value={o.id}>{o.id} · {state.clients.find(c=>c.id===o.clientId)?.name||'Клиент'} · {statuses[o.status]} · {money(o.items.reduce((n,i)=>n+i.price*i.quantity,0))}</option>)}</select>;
 }
 const allOrders=(key:'created'|'cancelled'|'confirmed'|'sent')=>rows.flatMap(r=>r.orderLists[key]);
 const count=rows.reduce((n,r)=>n+r.created,0),amount=rows.reduce((n,r)=>n+Math.round(r.amount*100),0)/100;
 return <>
  <button className="secondary" onClick={()=>{const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Moscow"});setFrom(today);setTo(today);setOpen(true);}} title="Статистика операторов"><BarChart3 size={18}/>Статистика</button>
  <Dialog open={visible} onOpenChange={setOpen}>{visible&&<DialogContent className="form-dialog operator-stats-dialog">
   <DialogHeader><DialogTitle>Статистика операторов</DialogTitle><DialogDescription>Заказы из Скорозвона и CRM, созданные за выбранный период. Даты — по Москве.</DialogDescription></DialogHeader>
   <div className="stack">
    <div className="stats-period">
     <label>С даты<input aria-label="Начало периода" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
     <label>По дату<input aria-label="Конец периода" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
     <button className="secondary" onClick={()=>{const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Moscow"});setFrom(today.slice(0,7)+"-01");setTo(today);}}>За месяц</button>
    </div>
    {invalid?<p role="alert">Начало периода не может быть позже конца.</p>:<div className="stats-results"><div className={`stats-tables ${groups.length>1?"stats-tables-pair":""}`}>{groups.map((group,index)=><div className="stats-table-wrap" key={index}><table className="stats-table">{colgroup}{headers}
     <tbody>{group.map(r=><tr key={r.id}>
      <td title={r.login}>{r.login}</td><td>{metric(r.created,r.orderLists.created,"Создано заказов")}</td>
      <td>{metric(money(r.average),r.orderLists.created,"Средний чек")}</td><td>{metric(money(r.amount),r.orderLists.created,"Сумма заказов")}</td>
      <td>{metric(r.cancelled,r.orderLists.cancelled,"Отменено")}</td><td>{metric(r.confirmed,r.orderLists.confirmed,"Подтверждено логистом")}</td><td>{metric(r.sent,r.orderLists.sent,"Отправлено")}</td>
     </tr>)}</tbody></table></div>)}</div><div className="stats-table-wrap stats-totals"><table className="stats-table">{colgroup}{headers}
     <tfoot><tr><th>Итого</th><td>{metric(count,allOrders("created"),"Создано — итого")}</td>
      <td>{metric(money(count?amount/count:0),allOrders("created"),"Средний чек — итого")}</td><td>{metric(money(amount),allOrders("created"),"Сумма — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.cancelled,0),allOrders("cancelled"),"Отменено — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.confirmed,0),allOrders("confirmed"),"Подтверждено — итого")}</td>
      <td>{metric(rows.reduce((n,r)=>n+r.sent,0),allOrders("sent"),"Отправлено — итого")}</td>
     </tr></tfoot>
    </table></div>{!rows.length&&<p>Нет операторов для отображения.</p>}</div>}
    <p className="muted">Сортировка — нажатием на заголовок. Подтверждено — логистом. Средний чек и сумма включают все созданные заказы, в том числе отменённые. Подтверждение и отправка учитываются независимо: отправленный заказ остаётся в подтверждённых. Доставка — СДЭК, Почта России и курьер. Нажмите на показатель, чтобы открыть входящие в него заказы.</p>
   </div>
  </DialogContent>}</Dialog>
 </>;
}

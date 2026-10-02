"use client";
import {EmployeeCash} from "@/components/employee-cash";
import {Cash} from "@/components/cash";
import {hasCash} from "@/lib/cash";
import {useState} from "react";
import {deliveryLabels,money,stamp,type Order,type Employee} from "@/lib/crm";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";

export function Finances({orders,employee}:{orders:Order[];employee:Employee}){return <div className="stack">{employee.role==="admin"&&<EmployeeCash/>}{hasCash(employee.role)&&<Cash key={employee.id} actorId={employee.id}/>}{employee.role!=="department_head"&&<DeliveryFinances orders={orders}/>}</div>;}
function DeliveryFinances({orders}:{orders:Order[]}){
 const [from,setFrom]=useState("");const [to,setTo]=useState("");
 const rows=orders.filter(o=>{
  if(!o.paymentReceivedAt)return false;
  const date=new Date(o.paymentReceivedAt).toLocaleDateString("sv-SE",{timeZone:"Europe/Moscow"});
  return (!from||date>=from)&&(!to||date<=to);
 }).sort((a,b)=>b.paymentReceivedAt!.localeCompare(a.paymentReceivedAt!));
 const amount=rows.reduce((sum,o)=>sum+Math.round((o.paymentReceipt?.amount||0)*100),0)/100;
 return <div className="stack">
  <div className="notice amber"><div><strong>Нужно настроить вознаграждение курьера</strong><p>За каждый заказ курьеру полагается вознаграждение. Позже необходимо определить сумму и правила начисления. Сейчас вознаграждение не рассчитывается и не вычитается из принятых денег.</p></div></div>
  <div className="toolbar"><label>С даты <input aria-label="Финансы с даты" type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label><label>По дату <input aria-label="Финансы по дату" type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label><strong>Принято: {money(amount)} · заказов: {rows.length}</strong></div>
  <p className="muted">Отчёт пополняется при нажатии «Принять оплату — деньги получены» в карточке заказа. Даты указаны по Москве. Сумма автоматически берётся из заказа. Сумма и логин оператора сохраняются на момент приёма денег.</p>
  <div className="table-panel"><Table><TableHeader><TableRow><TableHead>Дата приёма</TableHead><TableHead>Номер заказа</TableHead><TableHead>Доставка</TableHead><TableHead>Логин оператора</TableHead><TableHead>Принял</TableHead><TableHead>Принятая сумма</TableHead></TableRow></TableHeader><TableBody>{rows.map(o=><TableRow key={o.id}><TableCell>{stamp(o.paymentReceivedAt!)}</TableCell><TableCell>{o.id}</TableCell><TableCell>{deliveryLabels[o.paymentReceipt?.delivery||o.delivery||""]}</TableCell><TableCell>{o.paymentReceipt?.operatorLogin||"Не зафиксирован"}</TableCell><TableCell>{o.paymentReceipt?.receivedByName||"Не зафиксирован"}</TableCell><TableCell>{o.paymentReceipt?money(o.paymentReceipt.amount):"Не зафиксирована"}</TableCell></TableRow>)}</TableBody></Table>{!rows.length&&<div className="empty"><h3>Приёмов денег пока нет</h3><p>Здесь появятся принятые оплаты за выбранный период.</p></div>}</div>
  {rows.some(o=>!o.paymentReceipt)&&<p className="notice">В старых отметках приёма денег сумма не фиксировалась. Такие строки не включены в итог; сумма заказа не подставляется вместо фактически принятой суммы.</p>}
 </div>;
}

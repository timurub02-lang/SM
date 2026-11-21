'use client';
import {useState} from 'react';
import './confirmation-review.css';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {money,statuses,total,type Order,type Status} from '@/lib/crm';
import {isBasketTotal} from '@/lib/basket-total';
import {hasIncompleteName,needsNameExplanation} from '@/lib/incomplete-name';

type Props={
 order:Order; name:string; to:Status; head?:boolean; busy:boolean;
 onCancel:()=>void; onSubmit:(fields:Record<string,unknown>)=>Promise<boolean>;
};
export function ConfirmationReview({order,name,to,head,busy,onCancel,onSubmit}:Props){
 const [amountOk,setAmountOk]=useState(false),[nameOk,setNameOk]=useState(false);
 const [agreed,setAgreed]=useState(false),[corrected,setCorrected]=useState(false),[reason,setReason]=useState('');
 const incomplete=hasIncompleteName(name),returned=head&&order.status==='rework';
 const explain=returned&&needsNameExplanation(order.status,'confirm',name);
 const channel=order.delivery==='moscow_courier'?'Курьер Москва':order.delivery==='russian_post'?'Почта России':'СДЭК';
 const action=to==='check'?'Передать на проверку':to==='extra'?'Передать на повторное подтверждение':channel==='Курьер Москва'?'Передать в «Курьер Москва»':`На упаковку в «${channel}»`;
 const ready=amountOk&&(!incomplete||nameOk)&&(!head||agreed)&&(!returned||corrected)&&(!explain||reason.trim());
 const amount=money(total(order));
 const source=order.status==='extra'?'Повторное подтверждение':statuses[order.status];
 const destination=to==='packing'?`${channel} · ${channel==='Курьер Москва'?'Новый':'Упаковка'}`:statuses[to];
 const items=order.items.filter(item=>!isBasketTotal(item));
 const totalOnly=order.items.some(item=>isBasketTotal(item)&&item.price>0)&&items.every(item=>item.price===0);
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onCancel();}}>
  <DialogContent className="handoff-review">
   <DialogHeader>
    <small>Заказ {order.id}</small>
    <DialogTitle>Проверьте заказ перед передачей</DialogTitle>
    <DialogDescription>{source} → {destination}</DialogDescription>
   </DialogHeader>
   <div className="handoff-body">
    <div className="handoff-recipient"><small>Получатель</small><strong>{name||'ФИО не указано'}</strong></div>
    {incomplete&&<div className="handoff-warning">
     <b>Указано неполное ФИО</b>
     <label><input type="checkbox" checked={nameOk} onChange={e=>setNameOk(e.target.checked)}/>ФИО проверено. Заказ можно передать с указанным именем.</label>
     {explain&&<label className="field"><span>Причина передачи без полного ФИО</span><textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
    </div>}
    <div className="handoff-basket"><table><caption>Состав заказа</caption>
     <thead><tr><th scope="col">Товар</th><th scope="col">Кол-во</th><th scope="col">Цена</th><th scope="col">Сумма</th></tr></thead>
     <tbody>{items.map((item,i)=><tr key={i}><td>{item.name}</td><td>{item.quantity}</td><td>{totalOnly?'—':money(item.price)}</td><td>{totalOnly?'—':money(item.quantity*Math.round(item.price*100)/100)}</td></tr>)}</tbody>
     <tfoot><tr><th scope="row" colSpan={3}>Итого по заказу</th><td>{amount}</td></tr></tfoot>
    </table>{totalOnly&&<small>Цена указана за весь заказ.</small>}</div>
    <label><input type="checkbox" checked={amountOk} onChange={e=>setAmountOk(e.target.checked)}/>Корзину проверил(а). Сумма {amount} верна.</label>
    {returned&&<><p>Замечания логиста · {order.returnReason||order.reason||order.editRequest?.reason||'Не указаны'}</p><label><input type="checkbox" checked={corrected} onChange={e=>setCorrected(e.target.checked)}/>Замечания логиста исправлены</label></>}
    {head&&<label><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>Я связался с клиентом, клиент согласен выкупить заказ</label>}
   </div>
   <footer>
    <button type="button" disabled={busy} onClick={onCancel}>Вернуться к заказу</button>
    <button type="button" className="handoff-submit" disabled={busy||!ready} onClick={async()=>{
     if(await onSubmit({amountConfirmed:amountOk,reviewedRecipient:name,incompleteNameConfirmed:nameOk,...(head?{clientConfirmed:agreed,correctionsConfirmed:corrected}:{}),...(explain?{incompleteNameReason:reason.trim()}:{})}))onCancel();
    }}>{action}</button>
   </footer>
  </DialogContent>
 </Dialog>;
}

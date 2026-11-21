'use client';
import {useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {money,total,type Order,type Status} from '@/lib/crm';
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
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onCancel();}}><DialogContent className="form-dialog" style={{maxHeight:'90dvh',overflowY:'auto'}}>
  <DialogHeader><DialogTitle>Проверьте заказ перед передачей</DialogTitle><DialogDescription>Заказ {order.id} · {to==='packing'?`${channel} → Новый`:to==='check'?'Проверка':'Повторное подтверждение'}</DialogDescription></DialogHeader>
  <div className="stack">
   <p>Получатель · <strong>{name||'ФИО не указано'}</strong></p>
   {incomplete&&<div className="stack notice amber"><strong>Указано неполное ФИО</strong>
    <label><input type="checkbox" checked={nameOk} onChange={e=>setNameOk(e.target.checked)}/> ФИО проверено. Заказ можно передать с указанным именем.</label>
    {explain&&<label className="field"><span>Причина передачи без полного ФИО</span><textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
   </div>}
   <div style={{overflowX:'auto'}}><table style={{width:'100%'}}><caption style={{textAlign:'left'}}>Состав заказа</caption>
    <thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
    <tbody>{order.items.filter(item=>!isBasketTotal(item)).map((item,i)=><tr key={i}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.price)}</td><td>{money(item.quantity*Math.round(item.price*100)/100)}</td></tr>)}</tbody>
    <tfoot><tr><th colSpan={3}>Итого по заказу</th><td><strong>{amount}</strong></td></tr></tfoot>
   </table></div>
   <label><input type="checkbox" checked={amountOk} onChange={e=>setAmountOk(e.target.checked)}/> Корзину проверил(а). Сумма {amount} верна.</label>
   {returned&&<><p>Замечания логиста · {order.returnReason||order.reason||order.editRequest?.reason||'Не указаны'}</p><label><input type="checkbox" checked={corrected} onChange={e=>setCorrected(e.target.checked)}/> Замечания логиста исправлены</label></>}
   {head&&<label><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/> Я связался с клиентом, клиент согласен выкупить заказ</label>}
   <div className="action-buttons"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Вернуться к заказу</button>
    <button type="button" className="primary" disabled={busy||!ready} onClick={async()=>{
     if(await onSubmit({amountConfirmed:amountOk,reviewedRecipient:name,incompleteNameConfirmed:nameOk,...(head?{clientConfirmed:agreed,correctionsConfirmed:corrected}:{}),...(explain?{incompleteNameReason:reason.trim()}:{})}))onCancel();
    }}>{action}</button></div>
  </div>
 </DialogContent></Dialog>;
}

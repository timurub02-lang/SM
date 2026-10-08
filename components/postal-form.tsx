'use client';
import {useEffect,useState} from 'react';
import {ArrowDownToLine} from 'lucide-react';
import {toast} from 'sonner';
import {emptyPostalSender,postalMoneyPlaceholders,type PostalParty,type PostalFormData} from '@/lib/postal-form';
import type {Employee,Order} from '@/lib/crm';

export function PostalFormButton({order,actorId,disabled}:{order:Order;actorId:string;disabled:boolean}){
 const [loading,setLoading]=useState(false);
 async function download(){
  setLoading(true);
  try{
   const response=await fetch(`/api/postal-form?actorId=${encodeURIComponent(actorId)}&orderId=${encodeURIComponent(order.id)}&version=${order.version}`);
   const data=await response.json() as PostalFormData&{error?:string};if(!response.ok)throw Error(data.error||'Не удалось подготовить бланк');
   const {downloadPostalFormPdf}=await import('@/lib/postal-form-pdf');
   await downloadPostalFormPdf(data);
   toast.success('Почтовый бланк подготовлен. Статус заказа не изменён.');
  }catch(e){toast.error(e instanceof Error?e.message:'Не удалось скачать бланк');}
  finally{setLoading(false);}
 }
 return <section className="stack"><h3>Почта России · ф. 7-п</h3><p className="muted">Получатель и адрес — из сохранённых данных заказа и клиента. Отправителя администратор указывает в настройках раздела «Почта России».</p><button type="button" className="secondary" disabled={disabled||loading} onClick={()=>void download()}><ArrowDownToLine size={17}/>{loading?'Подготовка…':'Почтовый бланк PDF'}</button><small className="muted">Пока суммы уточняются: объявленная ценность — «{postalMoneyPlaceholders.declaredValue}», наложенный платёж — «{postalMoneyPlaceholders.cashOnDelivery}». Скачивание не переводит заказ на сборку или отправку.</small></section>;
}

export function PostalSenderSettings({actor}:{actor:Employee}){
 const [sender,setSender]=useState<PostalParty>(emptyPostalSender),[revision,setRevision]=useState('');
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;
  void (async()=>{try{
   const response=await fetch(`/api/postal-form?actorId=${encodeURIComponent(actor.id)}`);
   const data=await response.json() as {sender:PostalParty;revision:string;error?:string};if(!response.ok)throw Error(data.error||'Не удалось загрузить отправителя');
   if(live){setSender(data.sender);setRevision(data.revision);setReady(true);}
  }catch(e){if(live)setError(e instanceof Error?e.message:'Ошибка загрузки');}})();
  return()=>{live=false;};
 },[actor.id]);
 async function save(){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/postal-form',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actorId:actor.id,sender,revision})});
   const data=await response.json() as {sender:PostalParty;revision:string;error?:string};if(!response.ok)throw Error(data.error||'Не удалось сохранить отправителя');
   setSender(data.sender);setRevision(data.revision);toast.success('Отправитель почтового бланка сохранён');
  }catch(e){setError(e instanceof Error?e.message:'Ошибка сохранения');}
  finally{setBusy(false);}
 }
 return <section className="stack"><h3>Отправитель почтового бланка</h3><p className="muted">Общие реквизиты для бланков ф. 7-п. Укажите фактического отправителя; данные из примера автоматически не подставляются.</p>{error&&<p role="alert" className="orange">{error}</p>}<form className="stack" onSubmit={e=>{e.preventDefault();void save();}}><fieldset className="stack order-fields" disabled={!ready||busy||actor.role!=='admin'}><label className="field"><span>ФИО или название отправителя *</span><input required maxLength={250} value={sender.name} onChange={e=>setSender({...sender,name:e.target.value})}/></label><label className="field"><span>Адрес отправителя *</span><textarea required rows={2} maxLength={500} value={sender.address} onChange={e=>setSender({...sender,address:e.target.value})}/></label><div className="form-grid"><label className="field"><span>Индекс отправителя *</span><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={sender.postalCode} onChange={e=>setSender({...sender,postalCode:e.target.value})}/></label><label className="field"><span>Телефон отправителя</span><input type="tel" maxLength={30} value={sender.phone} onChange={e=>setSender({...sender,phone:e.target.value})}/></label></div>{actor.role==='admin'&&<button type="submit" className="primary">{busy?'Сохранение…':'Сохранить отправителя'}</button>}</fieldset></form>{actor.role!=='admin'&&<small className="muted">Изменить отправителя может администратор.</small>}<p className="notice">Уточнить у логистов: какие суммы и из каких данных подставлять в объявленную ценность («Уточнить_1») и наложенный платёж («Уточнить_2»). Пока в PDF печатаются эти обозначения.</p></section>;
}

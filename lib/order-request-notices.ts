import type {ActivityDb} from './activity-store.ts';
import type {Order,Event} from './crm.ts';
import {initReminderStore} from './reminder-store.ts';
export async function orderRequestNotices(d:ActivityDb,before:Order,after:Order,event:Event){
 const changes=[['editRequest','Редактирование заказа'],['shipmentReturn','Запрос возврата'],['shipmentChange','Изменение у перевозчика']] as const;
 const writes=[];
 for(const [key,label] of changes){
  const old=before[key],r=after[key];if(!old||!r||old.id!==r.id||old.status===r.status)continue;
  await initReminderStore(d);
  const notice={kind:'shipment-result',id:'order-request:'+event.id+':'+key,orderId:after.id,clientId:after.clientId,title:after.id+' · '+(key==='shipmentChange'?(r.status==='done'?'Изменения внесены':'Внести изменения не удалось'):label+' · '+({pending:'Ожидает решения',editing:'Передан на редактирование',completed:'Исправления сохранены',rejected:'Отклонён',done:'Запрос выполнен',failed:'Выполнить не удалось'}[r.status])),text:event.text,at:event.at,resolved:true};
  writes.push(d.prepare("INSERT OR IGNORE INTO reminders(employee_id,id,data,at) SELECT id,?,?,? FROM employees WHERE id IN (?,?) AND EXISTS(SELECT 1 FROM events WHERE id=?)").bind(notice.id,JSON.stringify(notice),event.at,r.by,after.manager,event.id));
 }
 return writes;
}
export async function incomingBuyoutNotices(d:ActivityDb,order:Order,event:Event,storageExtension:boolean){
 await initReminderStore(d);
 const notice={kind:'buyout-info',id:'buyout-info:'+event.id,orderId:order.id,clientId:order.clientId,title:(storageExtension?'СРОЧНО: требуется продление хранения · ':'Информация от клиента · ')+order.id,text:event.text,at:event.at,resolved:true};
 return [d.prepare("INSERT OR IGNORE INTO reminders(employee_id,id,data,at) SELECT id,?,?,? FROM employees WHERE json_extract(data,'$.role') IN ('admin','redemption') AND EXISTS(SELECT 1 FROM events WHERE id=?)").bind(notice.id,JSON.stringify(notice),event.at,event.id)];
}

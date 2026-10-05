import type {ActivityDb as Db} from './activity-store.ts';
import type {Order} from './crm.ts';
import type {Reminder} from './reminders.ts';
import {initReminderStore} from './reminder-store.ts';
import {shipmentDeletionResult,returnedFromCdek,cdekErrors,type Shipment} from './cdek-shipment.ts';

// Used by both the order card and the background worker; result and notifications commit together.
export async function applyCdekDeletion(d:Db,order:Order,stored:Shipment,previous:string,data:any,direct=false,httpStatus=200){
 if(stored.state!=='deleting'||!stored.deletion)throw Error('Удаление этого отправления не ожидается');
 if(data.entity?.uuid&&data.entity.uuid!==stored.uuid)throw Error('СДЭК вернул другой идентификатор отправления');
 if(data.entity?.number&&data.entity.number!==order.id)throw Error('Этот UUID относится к другому заказу');
 const shipment={...stored,deletion:{...stored.deletion}},key='cdek-shipment-'+order.id;
 const result=shipmentDeletionResult(data,shipment.deletion,direct);
 if(result.requestId)shipment.deletion.requestId=result.requestId;
 // CDEK stops returning a deleted entity. Only accept its specific GET error after an acknowledged DELETE for this exact UUID.
 const removed=!direct&&httpStatus===400&&!!stored.deletion.requestId&&!data.entity&&(data.requests||[]).some((r:any)=>r.type==='GET'&&r.state==='INVALID'&&r.errors?.length&&r.errors.every((e:any)=>e.code==='v2_entity_not_found'&&String(e.message).includes(stored.uuid||'missing-uuid')));
 if(!direct&&!removed){
  if(httpStatus>=400)throw Error(cdekErrors(data)||'СДЭК временно недоступен');
  if(data.entity?.uuid!==stored.uuid)throw Error('СДЭК не подтвердил идентификатор отправления');
 }
 const deleted=removed||result.state==='deleted'&&httpStatus<300;
 const rejected=result.state==='rejected'||direct&&httpStatus>=400&&httpStatus<500;
 if(!deleted&&!rejected){
  shipment.error=result.error||'СДЭК ещё не подтвердил удаление. Правки и повторная выгрузка временно недоступны.';
  const saved=await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=?').bind(JSON.stringify(shipment),key,previous).run();
  if(!saved.meta.changes)throw Error('Отправление изменилось. Обновите карточку');
  return {shipment,message:shipment.error};
 }
 const at=new Date().toISOString(),mutation=crypto.randomUUID();
 const reminder:Reminder={kind:'cdek-deletion',id:`cdek-delete:${shipment.attempt}:${shipment.deletion.at}`,clientId:order.clientId,orderId:order.id,at,
  title:deleted?`СДЭК подтвердил удаление заказа ${order.id}`:`СДЭК отклонил удаление заказа ${order.id}`,
  text:deleted?'Вернули на сборку. Можно внести правки и выгрузить заново. Старую накладную нужно заменить.':'Заказ остался на прежнем этапе. Причина: '+(result.error||'заказ нельзя удалить')};
 const next={...(deleted?returnedFromCdek(order,at):order),updatedAt:at,_mutation:mutation};
 const event={id:mutation,clientId:order.clientId,orderId:order.id,at,actor:shipment.deletion.actor,
  text:(deleted?'Вернули из СДЭК · удалена накладная № ':'Удаление из СДЭК отклонено · накладная № ')+(shipment.number||'—')+' · UUID '+shipment.uuid+' · '+shipment.account+' · Причина запроса: '+shipment.deletion.reason+(deleted?'':' · Ответ СДЭК: '+(result.error||'заказ нельзя удалить'))};
 const failed:Shipment={...shipment,state:'ready',deletion:undefined,error:'Удаление отклонено СДЭК: '+(result.error||'заказ нельзя удалить')};
 const changed="EXISTS(SELECT 1 FROM orders WHERE id=? AND json_extract(data,'$._mutation')=?)";
 await initReminderStore(d);
 const writes=[
  d.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)').bind(JSON.stringify(next),order.id,order.version,key,previous),
  ...(deleted?[
   d.prepare('INSERT INTO settings(id,data) SELECT ?,? WHERE '+changed).bind('cdek-archive-'+shipment.attempt,JSON.stringify({...shipment,state:'deleted',deletedAt:at}),order.id,mutation),
   d.prepare('DELETE FROM settings WHERE id=? AND data=? AND '+changed).bind(key,previous,order.id,mutation)
  ]:[d.prepare('UPDATE settings SET data=? WHERE id=? AND data=? AND '+changed).bind(JSON.stringify(failed),key,previous,order.id,mutation)]),
  d.prepare('INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE '+changed).bind(mutation,order.clientId,order.id,at,JSON.stringify(event),order.id,mutation),
  d.prepare("INSERT OR IGNORE INTO reminders(employee_id,id,data,at) SELECT e.id,?,?,? FROM employees e WHERE json_extract(e.data,'$.role') IN ('admin','chief_logistic') AND "+changed).bind(reminder.id,JSON.stringify(reminder),at,order.id,mutation)
 ];
 const saved=await d.batch(writes);
 if(!saved[0].meta.changes)throw Error('Заказ изменился. Повторите проверку результата удаления');
 return {shipment:deleted?null:failed,changed:true,message:reminder.text};
}
